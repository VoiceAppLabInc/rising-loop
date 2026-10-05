import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { BrowserWindow, Menu, WebContentsView, app, dialog, ipcMain, net, shell } from 'electron'
import { isUpdateRequest, screenOfUrl } from '@shared/intercept'
import { detectForm, formLabel, type LoopsForm } from '@shared/loopsForm'
import { changelogSummary, planMigration, readTemplates, reworkInstruction, stageOf, type LoopsFiles, type Templates } from '@shared/migrate'
import type { AiKind, AiStatus, AppUpdate, AskRequest, DialogRequest, FormInfo, PermMode, Project, ProjectsSnapshot, ProjectsState } from '@shared/types'
import { dataDirOf, loadSettings, saveSettings } from './appSettings'
import { findOldSkills } from './oldSkills'
import { ToolRunner } from './tools'
import { Chats } from './chat'
import { childEnv, installCommand, loadShellEnv, loginArgs, navKeyDir, parseLoggedIn, setBundledPython, statusArgs, windowChrome } from './platform'
import { forgetCli, resolveCli, runProbe } from './aiCli'
import { KICKOFF } from './launch'
import { parseLedger, pendingWork, type Ledger, type PendingWork } from './ledger'
import { applyPlan, backupLoops, pruneBackups, restoreLoops } from './migration'
import { addProject, clearKickoff, loadState, markKickoff, markNotice, removeProject, saveState, selectProject, setMigration, updateProject } from './projects'
import { PANE_W, ProjectViews, TAB_H, hasLoops, type PaneOpen } from './views'
import { LSREGISTER, MAC_SWAP_SH, UPDATE_EVERY_MS, UPDATE_URL, bundleOf, checkUpdateNow, needsIconRefresh, readWithProgress, type UpdateCheck } from './update'

// データ置き場。テストでは一時フォルダ、開発版は Rising Loop Dev（普段使いのアプリと混ぜない）。前の名前の置き場があれば写して引き継ぐ
const data = dataDirOf({ packaged: app.isPackaged, override: process.env.RISING_LOOP_APP_DATA_DIR, appData: app.getPath('appData'), exists: existsSync })
if (data.copyFrom) cpSync(data.copyFrom, data.dir, { recursive: true })
app.setPath('userData', data.dir)

/** テストでは、ウィンドウを出さず Dock にも出さない（操作中の画面を奪わない） */
const hidden = process.env.RISING_LOOP_APP_HIDDEN === '1'

const projectsFile = () => join(app.getPath('userData'), 'projects.json')
const settingsFile = () => join(app.getPath('userData'), 'app.json')
/** ほかの場所の rising-loop を探すホーム（テストでは一時フォルダ） */
const homeDir = () => process.env.RISING_LOOP_APP_HOME || homedir()
/** プロジェクトで動かす AI（無ければ claude） */
const aiOf = (p: Project): AiKind => p.ai ?? 'claude'

let state: ProjectsState
let win: BrowserWindow | null = null
let views: ProjectViews | null = null
/** ループの画面の上に浮かぶカードの層（透明。カードの大きさだけ）。ダイアログや設定のあいだは隠す */
let overlay: WebContentsView | null = null
let overlaySize = { w: 0, h: 0 }
let covered = false
/** 戻る・進むのスワイプは1回で続けて何回も届くので、このあいだに来た分は1回とみなす */
const SWIPE_QUIET_MS = 400
/** 層がダイアログを出しているか（そのあいだは層を窓いっぱいに広げる） */
let overlayDialog = false
let chats: Chats

/** 同梱のスキルと、右の窓の動き。開発中はリポジトリの中、配るときはアプリの Resources の中 */
const resourceRoot = () => (app.isPackaged ? process.resourcesPath : app.getAppPath())
const pluginDir = () => join(resourceRoot(), 'skill')
const skillDir = () => join(pluginDir(), 'skills', 'rising-loop')
/** 新しい形にするときの雛形（同梱のスキルの assets/）。起動したときに読む */
let tpl: Templates
/** 既存のループの HTML に要る変化の台帳（同梱のスキルの migrations.json） */
let ledger: Ledger
const ledgerPath = () => join(skillDir(), 'migrations.json')
/** 移行の控えの置き場（loops/ の外）。プロジェクトごとに直近3回ぶん */
const backupsOf = (id: string) => join(app.getPath('userData'), 'backups', id)
const KEEP_BACKUPS = 3
const paneDir = () => join(resourceRoot(), 'resources', 'pane')
/** 同梱の Python（python3 が無い人のため）。配るときは Resources/python、開発中は scripts/fetch-python.mjs が落とした vendor/ の中 */
const pythonDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'python') : join(app.getAppPath(), 'vendor', 'python', `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`, 'python')

/** 受け取ったものの記録（画面の流れのテストで読む） */
const received = { panes: [] as PaneOpen[], instructions: [] as { projectId: string | null; text: string }[] }
;(globalThis as { __rla?: typeof received }).__rla = received

const readText = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

/** loops/ の殻と各ループの頁を読む */
function loopsFiles(folder: string): LoopsFiles & { indexHtml: string | null } {
  const dir = join(folder, 'loops')
  let names: string[] = []
  try {
    names = readdirSync(dir)
      .filter((n) => /^L.*\.html$/.test(n))
      .sort()
  } catch {
    // loops/ が無い
  }
  return {
    indexHtml: readText(join(dir, 'index.html')) as string,
    pages: names.map((name) => ({ name, html: readText(join(dir, name)) ?? '' })),
    projectCss: readText(join(dir, 'project.css'))
  }
}

/** 殻から消えた独自の部品のうち、まだ新しい殻に移っていないもの（id で見る）。一度すべて移し終えたら見ない */
const lostLeft = (p: Project, indexHtml: string) =>
  p.migration?.lostDone ? [] : (p.migration?.lost ?? []).filter((x) => x.startsWith('id="') && !indexHtml.includes(x))

/**
 * 消えた部品がすべて新しい殻に移ったら、そのことを記録する（これ以降は見ない）。
 * 移したあとでユーザーが「外して」と言って外しても、「直っていない」に戻さないため
 */
function settleLost(): void {
  let next = state
  for (const p of state.projects) {
    const m = p.migration
    if (!m || m.lostDone || !m.lost.some((x) => x.startsWith('id="'))) continue
    const index = loopsFiles(p.folder).indexHtml
    if (index != null && lostLeft(p, index).length === 0) next = setMigration(next, p.id, { ...m, lostDone: true })
  }
  if (next !== state) {
    state = next
    saveState(projectsFile(), state)
  }
}

/**
 * 台帳を数え始める版。新しい形にしたことがあれば、そのとき記録した版。無ければ殻の版の表示。
 * アプリ以前の殻で版の表示が v0.0.0 のもの（1.7.1〜1.7.6）は 1.7.0 から数える（台帳の項目は、反映済みなら何もしない作り）
 */
function baselineOf(p: Project, f: LoopsForm): string {
  const m = p.migration
  if (m?.fromVersion) return m.fromVersion
  if (m && /^[0-9]/.test(m.from)) return m.from
  return f.shown ?? '1.7.0'
}

/** 台帳の項目のうち、まだ反映していない頁と一覧 */
function workOf(p: Project, files: ReturnType<typeof loopsFiles>, f: LoopsForm): PendingWork {
  if (files.indexHtml == null) return { pages: [], list: null }
  return pendingWork({ ledger, current: tpl.version, baseline: baselineOf(p, f), indexHtml: files.indexHtml, pages: files.pages })
}

/** loops/ の形（殻と各ループの頁を読んで見分ける）。殻が新しくても、台帳の項目や消えた部品が残っていれば rework */
function formOf(p: Project): FormInfo {
  const files = loopsFiles(p.folder)
  const f = detectForm({ indexHtml: files.indexHtml, pages: files.pages.map((x) => x.html) })
  let stage: FormInfo['stage'] = files.indexHtml == null ? 'current' : stageOf(f, tpl.version)
  let reworkPages: string[] = []
  if (stage === 'current' && files.indexHtml) {
    const w = workOf(p, files, f)
    reworkPages = w.pages.map((x) => x.name)
    if (w.pages.length || w.list || lostLeft(p, files.indexHtml).length) stage = 'rework'
  }
  // 一覧のチャットの AI が作業中か（作り直しのあいだ、帯の出し方を変える）
  const aiWorking = stage === 'rework' && !!chats?.busy(p.id, 's-list')
  return { current: stage === 'current', stage, reworkPages, aiWorking, label: formLabel(f), key: `${f.era}:${f.shown ?? ''}`, shellVersion: f.shown }
}

/** 作り直しの作業の指示文。台帳の項目も消えた部品も無ければ null（送らない） */
function reworkText(p: Project): string | null {
  const files = loopsFiles(p.folder)
  if (files.indexHtml == null) return null
  const f = detectForm({ indexHtml: files.indexHtml, pages: files.pages.map((x) => x.html) })
  const work = workOf(p, files, f)
  const lost = lostLeft(p, files.indexHtml)
  if (!work.pages.length && !work.list && !lost.length) return null
  return reworkInstruction({ version: tpl.version, ledgerPath: ledgerPath(), work, lost, backupIndex: join(p.migration?.backup ?? '', 'loops', 'index.html') })
}

const skillVersion = () => (readText(join(pluginDir(), 'skills', 'rising-loop', 'VERSION')) ?? '').trim()

function snapshot(): ProjectsSnapshot {
  const hasLoopsMap: Record<string, boolean> = {}
  const forms: Record<string, FormInfo> = {}
  for (const p of state.projects) {
    hasLoopsMap[p.id] = hasLoops(p.folder)
    forms[p.id] = formOf(p)
  }
  const panes: Record<string, boolean> = {}
  const nav: ProjectsSnapshot['nav'] = {}
  for (const p of state.projects) {
    panes[p.id] = views?.paneOpen(p.id) ?? true
    nav[p.id] = views?.navState(p.id) ?? { back: false, forward: false }
  }
  return { ...state, hasLoops: hasLoopsMap, forms, panes, nav, skillVersion: skillVersion(), appVersion: app.getVersion(), dev: !app.isPackaged, update }
}

/** 新しい版のアプリ（見つけたら一覧に添えて、タブの列とお知らせに出す） */
let update: AppUpdate | null = null
async function lookForUpdate(): Promise<UpdateCheck> {
  const url = process.env.RISING_LOOP_APP_UPDATE_URL || UPDATE_URL
  // テストは file:// の見本を読む（本物の GitHub には見に行かない）
  const fetcher = url.startsWith('file:') ? async (u: string) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(u), 'utf8')) }) : (u: string) => net.fetch(u)
  const r = await checkUpdateNow(url, app.getVersion(), process.platform, process.arch, fetcher)
  // 見に行けなかったときは、前に見つけた版をそのまま出しておく
  if (r.status === 'error') return r
  const found = r.status === 'new' ? r.update : null
  if (found?.version !== update?.version) {
    update = found
    if (state) broadcast(snapshot())
  }
  return r
}

/** いますぐ確かめる（Mac のメニュー）。新しい版があればお知らせを開き、無ければ・見に行けなければ小さな窓で知らせる */
async function checkUpdateFromMenu(): Promise<void> {
  const r = await lookForUpdate()
  if (r.status === 'new') return void overlay?.webContents.send('ui:open-dialog', { kind: 'update' } satisfies DialogRequest)
  if (!win) return
  void dialog.showMessageBox(win, {
    message: r.status === 'latest' ? '最新です' : '確かめられませんでした',
    detail: r.status === 'latest' ? `Rising Loop v${app.getVersion()} は最新の版です。` : 'ネットにつながっているか確かめて、もう一度やってください。'
  })
}

/**
 * 版が変わって初めて開いたら、Mac にアイコンを覚え直させる（同じ場所で入れ替えても、Mac は古い絵を覚えたままのため）。
 * 配ったアプリ（Mac）だけ。いま開いている Dock の絵は、次に開いたときに変わることがある
 */
function refreshIconOnce(): void {
  const bundle = app.isPackaged ? bundleOf(app.getPath('exe'), process.platform) : null
  if (!bundle) return
  const settings = loadSettings(settingsFile())
  if (!needsIconRefresh(settings.lastVersion, app.getVersion())) return
  saveSettings(settingsFile(), { ...settings, lastVersion: app.getVersion() })
  execFile('/usr/bin/touch', [bundle], () => execFile(LSREGISTER, ['-f', bundle], () => undefined))
}

/** Mac のメニュー。いつものメニューに「アップデートを確認…」を足す（「Rising Loop について」の下） */
function setMacMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { label: 'アップデートを確認…', click: () => void checkUpdateFromMenu() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

/** いまのプロジェクトを出し、カードの層をループの画面のさらに上に置き直す */
function showCurrent(snap = snapshot()): ProjectsSnapshot {
  views?.show(current())
  layoutOverlay()
  return snap
}

/**
 * カードの層の置き場所。ループの画面があり、カードがあり、ダイアログや設定を出していないときだけ見せる。
 * ループの画面は後から足すと上に重なるので、そのたびにカードの層を足し直していちばん上にする
 */
function layoutOverlay(): void {
  if (!win || !overlay) return
  win.contentView.addChildView(overlay)
  // ダイアログのあいだは窓いっぱい（後ろのループの画面とチャットは隠さず、層の薄暗い背景ごしに見せる）
  if (overlayDialog) {
    const [width, height] = win.getContentSize()
    overlay.setBounds({ x: 0, y: 0, width, height })
    overlay.setVisible(true)
    return
  }
  const p = state && current()
  const show = !!p && hasLoops(p.folder) && !covered && overlaySize.w > 0 && overlaySize.h > 0
  overlay.setVisible(show)
  if (!show) return
  const [width] = win.getContentSize()
  // カードは右の窓を除いた幅の真ん中に置く
  const area = width - (views?.paneOpen(p!.id) ? PANE_W : 0)
  const w = Math.min(overlaySize.w, width)
  overlay.setBounds({ x: Math.max(0, Math.round((area - w) / 2)), y: TAB_H, width: w, height: overlaySize.h })
}

/** 画面とカードの層の両方に、新しい一覧を送る */
function broadcast(snap: ProjectsSnapshot): void {
  win?.webContents.send('projects:changed', snap)
  if (overlay && !overlay.webContents.isDestroyed()) overlay.webContents.send('projects:changed', snap)
}

const current = () => state.projects.find((p) => p.id === state.currentId) ?? null

function commit(next: ProjectsState): void {
  state = next
  saveState(projectsFile(), state)
  broadcast(showCurrent())
  kickoff()
}

/** ループが無いプロジェクトを初めて開いたら、全面のチャットに最初の依頼を送る（プロジェクトごとに1回だけ） */
/** 最初の依頼を送っている途中のプロジェクト（届くまで二重に送らない） */
const kickoffPending = new Set<string>()
function kickoff(p = current()): void {
  if (!p || p.kickoffAt || hasLoops(p.folder) || kickoffPending.has(p.id)) return
  kickoffPending.add(p.id)
  // 「送った」と記録するのは、AI に届いたとき。AI が動かず届かなかったら記録しない（次の機会に送り直す）
  chats.send(p, 's-list', aiOf(p), KICKOFF, {
    sent: () => {
      kickoffPending.delete(p.id)
      state = markKickoff(state, p.id, new Date().toISOString())
      saveState(projectsFile(), state)
    },
    dropped: () => kickoffPending.delete(p.id)
  })
}

/**
 * ループが無いプロジェクトに loops/index.html ができたら、書き終わるのを待って通常の形に切り替える。
 * 見つけてから、もう一度見ても有るときに切り替える（その後の書き換えは自動の読み込み直しが受け持つ）
 */
/** 作り直しのあいだ、一覧のチャットの AI が作業中かどうかが変わったら、帯を出し直す */
let lastBusy: boolean | null = null
/** プロジェクトごとの、AI が作業中の画面（変わったら殻に知らせ、一覧に札を出してもらう） */
const lastScreens = new Map<string, string>()
setInterval(() => {
  const p = state && current()
  const busy = !!p && !!chats?.busy(p.id, 's-list')
  if (busy !== lastBusy) {
    lastBusy = busy
    if (p?.migration) broadcast(showCurrent())
  }
  for (const q of state?.projects ?? []) {
    const screens = chats?.busyScreens(q.id) ?? []
    const key = screens.join(',')
    if (lastScreens.get(q.id) === key) continue
    lastScreens.set(q.id, key)
    views?.setBusy(q.id, screens)
  }
}, 500)

const seen = new Map<string, number>()
setInterval(() => {
  if (!state) return
  let changed = false
  for (const p of state.projects) {
    if (!views?.isSetup(p.id)) continue
    if (!hasLoops(p.folder)) {
      seen.delete(p.id)
      continue
    }
    const at = seen.get(p.id)
    if (at == null) seen.set(p.id, Date.now())
    else if (Date.now() - at >= 1500) {
      seen.delete(p.id)
      changed = true
    }
  }
  if (changed) commit(state)
}, 500)

function createWindow(): void {
  const chrome = windowChrome(process.platform, TAB_H)
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Rising Loop',
    titleBarStyle: chrome.titleBarStyle,
    ...(chrome.titleBarOverlay ? { titleBarOverlay: chrome.titleBarOverlay } : {}),
    ...(chrome.trafficLightPosition ? { trafficLightPosition: chrome.trafficLightPosition } : {}),
    backgroundColor: '#ffffff',
    show: !hidden,
    // 見えないウィンドウは描画が間引かれるので、隠して動かすときは間引かせない
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: !hidden }
  })
  views = new ProjectViews(win, join(__dirname, '../preload/loops.js'), paneDir(), !hidden, (p) => {
    received.panes.push(p)
    console.log('[pane]', p.projectId, p.screen)
  })
  // AI が loops/ を書き換えたら、形を見分け直す（作り直しが終われば帯が消える）
  views.onLoopsChanged(() => {
    settleLost()
    broadcast(showCurrent())
  })
  views.onViewAdded(() => layoutOverlay())
  // タブの列（アプリの画面）でも、Chrome・Safari と同じキーで、いまのタブを戻る・進む（ダイアログのあいだは効かない）
  win.webContents.on('before-input-event', (e, input) => {
    const dir = navKeyDir(input, process.platform)
    const p = current()
    if (!dir || !p || overlayDialog) return
    e.preventDefault()
    views?.go(p.id, dir)
  })
  // ループの画面で画面が移ったら、戻る・進むの状態を送り直す
  views.onNavigated(() => broadcast(snapshot()))
  overlay = new WebContentsView({
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: !hidden }
  })
  overlay.setBackgroundColor('#00000000')
  overlay.setVisible(false)
  if (process.env.ELECTRON_RENDERER_URL) void overlay.webContents.loadURL(process.env.ELECTRON_RENDERER_URL + '?overlay=bar')
  else void overlay.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: 'bar' } })
  win.on('resize', layoutOverlay)
  // Mac の「戻る・進むのスワイプ」。トラックパッドのほか、マウスの戻る・進むボタンもドライバーがこの合図に置き換えて送ってくる。
  // 左へで戻る、右へで進む。1回押すと続けて何回も届くので、少しのあいだに来た分は1回とみなす。ダイアログのあいだは効かない
  let lastSwipe = 0
  win.on('swipe', (_e, dir) => {
    const step = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
    const p = current()
    const now = Date.now()
    if (!step || !p || overlayDialog || now - lastSwipe < SWIPE_QUIET_MS) return
    lastSwipe = now
    views?.go(p.id, step)
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.webContents.once('did-finish-load', () => {
    showCurrent()
    kickoff()
  })
  win.on('closed', () => {
    views?.dispose()
    overlay = null
    win = null
    views = null
  })
}

ipcMain.handle('projects:get', () => snapshot())
/**
 * プロジェクトを追加するフォルダを選ぶ。ループがあるフォルダ・もう一覧にあるフォルダはそのまま開き、
 * ループが無いフォルダは、新しいプロジェクトにしてよいかを画面で確かめてから projects:add で足す
 */
ipcMain.handle('projects:pick-new', async (): Promise<{ snap: ProjectsSnapshot; ask?: { folder: string; name: string } }> => {
  if (!win) return { snap: snapshot() }
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  const folder = r.filePaths[0]
  if (r.canceled || !folder) return { snap: snapshot() }
  const { state: next, existed, project } = addProject(state, folder, new Date().toISOString())
  if (!existed && !hasLoops(folder)) return { snap: snapshot(), ask: { folder, name: project.name } }
  commit(next)
  return { snap: snapshot() }
})
ipcMain.handle('projects:add', (_e, folder: string) => {
  commit(addProject(state, folder, new Date().toISOString()).state)
  return snapshot()
})
ipcMain.handle('projects:select', (_e, id: string) => {
  commit(selectProject(state, id))
  return snapshot()
})
// 古い形を知らせたことを記録する（同じ形について知らせるのは1回だけ）
ipcMain.handle('projects:noticed', (_e, id: string, formKey: string) => {
  commit(markNotice(state, id, formKey))
  return snapshot()
})

/**
 * ［新しい形にする］。控えを取り、殻と共通の部品をアプリが入れ替え、AI が直す所があれば作業として一覧のチャットに送る。
 * 1.5 より前の形（CONST の印が無いなど）は扱わない
 */
ipcMain.handle('loops:migrate', (_e, id: string) => {
  const p = state.projects.find((x) => x.id === id)
  if (!p || formOf(p).stage !== 'old') return snapshot()
  const files = loopsFiles(p.folder)
  const plan = planMigration({ ...files, indexHtml: files.indexHtml ?? '' }, tpl)
  if ('error' in plan) return snapshot()
  const loops = join(p.folder, 'loops')
  const before = formOf(p)
  const f = detectForm({ indexHtml: files.indexHtml, pages: files.pages.map((x) => x.html) })
  const fromVersion = baselineOf(p, f)
  const backup = backupLoops(loops, backupsOf(p.id), new Date())
  applyPlan(loops, plan)
  pruneBackups(backupsOf(p.id), KEEP_BACKUPS)
  // 知らせには答えたことにする（元に戻したときに、同じ知らせをもう一度出さない）
  const noticed = markNotice(state, p.id, before.key)
  commit(setMigration(noticed, p.id, { at: new Date().toISOString(), backup, from: before.label, fromVersion, lost: plan.lost }))
  // 古い会話には前の版の決まりが残っているので、このプロジェクトのチャットを新しい会話にし、
  // 作り直しの作業は、その新しい会話を起動するときの引数で渡す（起動直後の貼り付けは捨てられる）
  const text = reworkText(state.projects.find((x) => x.id === p.id)!)
  chats.renewProject(p, aiOf(p), text ? { screen: 's-list', text } : undefined)
  return snapshot()
})

/** ［AI にもう一度頼む］。台帳の項目と消えた部品のうち、まだのものだけを、もう一度作業として送る */
ipcMain.handle('loops:rework', (_e, id: string) => {
  const p = state.projects.find((x) => x.id === id)
  const text = p && reworkText(p)
  if (p && text) chats.send(p, 's-list', aiOf(p), text)
  return snapshot()
})

/** ［元に戻す］。いまの loops/ も控えに取ってから、新しい形にする前の控えのとおりに戻す */
ipcMain.handle('loops:undo', (_e, id: string) => {
  const p = state.projects.find((x) => x.id === id)
  if (!p?.migration) return snapshot()
  const loops = join(p.folder, 'loops')
  backupLoops(loops, backupsOf(p.id), new Date())
  restoreLoops(join(p.migration.backup, 'loops'), loops)
  pruneBackups(backupsOf(p.id), KEEP_BACKUPS)
  commit(setMigration(state, p.id, undefined))
  return snapshot()
})

/** 帯の「新しい形にしました」を閉じる（控えは残す） */
ipcMain.handle('loops:close-migrated', (_e, id: string) => {
  const p = state.projects.find((x) => x.id === id)
  if (p?.migration) commit(setMigration(state, p.id, { ...p.migration, closed: true }))
  return snapshot()
})

// ── 設定画面 ──

/** AI・確認のモードを変える。AI かモードが変わったら、そのプロジェクトのチャットを起動し直す（会話は続ける） */
/**
 * 設定の［OK］で、変えた分をまとめて適用する。
 * フォルダが変われば名前もそのフォルダ名になり、前のフォルダの画面とチャットは捨てて新しいフォルダで開き直す。
 * フォルダはそのままで AI・確認のモードが変われば、同じ会話のままチャットを起動し直す
 */
ipcMain.handle('projects:update', (_e, id: string, patch: { folder?: string; ai?: AiKind; perm?: PermMode }) => {
  const before = state.projects.find((x) => x.id === id)
  if (!before) return snapshot()
  const moved = !!patch.folder && patch.folder.replace(/[\\/]+$/, '') !== before.folder
  if (moved) {
    views?.removeProject(id)
    chats.killProject(id)
  }
  commit(updateProject(state, id, moved ? patch : { ai: patch.ai, perm: patch.perm }))
  const after = state.projects.find((x) => x.id === id)!
  if (!moved && (aiOf(after) !== aiOf(before) || (after.perm ?? 'ask') !== (before.perm ?? 'ask'))) chats.restartProject(after, aiOf(after))
  // ループがまだ無いあいだに AI を切り替えたら、切り替えた先のチャットにも最初の依頼を送る（送っている途中なら、その文が新しい AI に届く）
  if (!moved && aiOf(after) !== aiOf(before) && !hasLoops(after.folder)) {
    state = clearKickoff(state, id)
    saveState(projectsFile(), state)
    kickoff(state.projects.find((x) => x.id === id))
  }
  return snapshot()
})

/** 設定の［選び直す…］。フォルダを選ぶだけで、切り替えは［OK］のとき（projects:update） */
ipcMain.handle('projects:choose-folder', async (): Promise<string | null> => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
})

/** アプリの一覧から外す（フォルダには触れない） */
ipcMain.handle('projects:remove', (_e, id: string) => {
  views?.removeProject(id)
  chats.killProject(id)
  commit(removeProject(state, id))
  return snapshot()
})

/** 右の窓の開閉（アプリのタブの列の［AI の窓］） */
ipcMain.handle('loops:go', (_e, id: string, dir: -1 | 1) => views?.go(id, dir))
ipcMain.handle('loops:pane', (_e, id: string, on: boolean) => {
  views?.setPane(id, on)
  layoutOverlay()
  return snapshot()
})

/** claude / codex が使えるか（動くもの・アプリが使う機能があるものを選んだうえで）・ログインしているか */
async function aiStatus(ai: AiKind): Promise<AiStatus> {
  const picked = await resolveCli(ai)
  if (!picked.cmd) return { ai, state: picked.state === 'old' || picked.state === 'broken' ? picked.state : 'missing', version: picked.version }
  const st = await runProbe(await childEnv())(picked.cmd.file, [...picked.cmd.args, ...statusArgs(ai)])
  // claude は普通の出力の JSON、codex は「Logged in」をエラー用の出力に出す
  const text = ai === 'codex' ? `${st.out}\n${st.err ?? ''}` : st.out
  return { ai, state: parseLoggedIn(ai, text, st.code) ? 'ready' : 'login', version: picked.version }
}
ipcMain.handle('ai:status', async () => {
  // 確かめ直すときは、覚えていた結果を捨てる（よそで入れ直した・消した、を拾う）
  forgetCli()
  return Promise.all((['claude', 'codex'] as AiKind[]).map(aiStatus))
})

/** ［入れる］［ログイン］。公式の手順をアプリの中のターミナルで動かす（1つずつ） */
const tools = new ToolRunner()
ipcMain.handle('ai:run', async (e, ai: AiKind, kind: 'install' | 'login', cols: number, rows: number) => {
  // テストでは、本物のインストーラーの代わりに決まったコマンドを動かす（引数に install と AI の名前）
  const testInstall = process.env.RISING_LOOP_APP_INSTALL_CMD
  let cmd = kind === 'install' ? (testInstall ? { file: testInstall, args: ['install', ai] } : installCommand(ai, process.platform)) : null
  if (kind === 'login') {
    const cli = (await resolveCli(ai)).cmd
    if (!cli) return false
    cmd = { file: cli.file, args: [...cli.args, ...loginArgs(ai)] }
  }
  if (!cmd) return false
  tools.run(cmd, {
    // 公式の手順はホームで動かす（ほかの場所の rising-loop を探すテスト用のホームとは別）
    cwd: homedir(),
    env: await childEnv(),
    cols,
    rows,
    // 出力は、ターミナルを出している画面（設定のダイアログ＝透明な層）に返す
    onData: (d) => !e.sender.isDestroyed() && e.sender.send('tool:data', d),
    onExit: (code) => {
      // 入れた・ログインした。次に使うときは確かめ直す
      forgetCli()
      if (!e.sender.isDestroyed()) e.sender.send('tool:exit', code)
    }
  })
  return true
})
ipcMain.on('tool:input', (_e, d: string) => tools.input(d))
ipcMain.on('tool:resize', (_e, cols: number, rows: number) => tools.resize(cols, rows))
ipcMain.on('tool:stop', () => tools.stop())

// ── アプリ全体の記録・ほかの場所の rising-loop ──

ipcMain.handle('app:settings', () => loadSettings(settingsFile()))
ipcMain.handle('app:howto-seen', () => saveSettings(settingsFile(), { ...loadSettings(settingsFile()), howtoSeen: true }))
/** いますぐ確かめる（設定の［新しい版を確かめる］）。新しい版があれば、一覧を送り直してから返す */
ipcMain.handle('app:check-update', async (): Promise<{ status: UpdateCheck['status']; snap: ProjectsSnapshot }> => {
  const r = await lookForUpdate()
  return { status: r.status, snap: snapshot() }
})
/** 新しい版のお知らせを出した（その版については、もう自動では出さない） */
ipcMain.handle('app:update-seen', (_e, version: string) => saveSettings(settingsFile(), { ...loadSettings(settingsFile()), updateSeen: version }))
/**
 * 新しい版に入れ替える。Mac の配ったアプリは、アプリが自分で .dmg を落とし、終了してから入れ替えて開き直す（MAC_SWAP_SH）。
 * ブラウザで落とすと「ダウンロードしたもの」の印が付き、署名していないアプリは「壊れている」と言われて開けないため。
 * Windows・開発版・置き場所に書けない（.dmg から直接開いている など）ときは、ファイル（無ければリリースの頁）をいつものブラウザで開く
 */
ipcMain.handle('app:install-update', async (e): Promise<{ ok: boolean; message?: string }> => {
  if (!update) return { ok: false, message: '新しい版が見つかりません。' }
  const bundle = app.isPackaged ? bundleOf(app.getPath('exe'), process.platform) : null
  const canWrite = (dir: string) => {
    try {
      accessSync(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }
  if (!bundle || !update.download.endsWith('.dmg') || !canWrite(dirname(bundle))) {
    void shell.openExternal(update.download)
    return { ok: true }
  }
  try {
    const res = await net.fetch(update.download)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const dir = join(app.getPath('userData'), 'update')
    mkdirSync(dir, { recursive: true })
    const dmg = join(dir, `Rising-Loop-${update.version}.dmg`)
    // 何%まで落としたかを、押した画面（お知らせのダイアログ）に知らせる。落とし終わったら「入れ替えています」
    writeFileSync(dmg, await readWithProgress(res, (pct) => e.sender.send('update:progress', pct)))
    e.sender.send('update:progress', 'installing')
    // 入れ替えたあとで開き直す（テストでは開かない）
    const after = process.env.RISING_LOOP_APP_UPDATE_NO_OPEN === '1' ? 'no-open' : 'open'
    spawn('/bin/sh', ['-c', MAC_SWAP_SH, 'sh', String(process.pid), dmg, bundle, after], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: `新しい版を落とせませんでした（${(e as Error).message}）。ネットにつながっているか確かめて、もう一度押してください。` }
  }
})

/** ほかの場所に入っている rising-loop（見つけたら、版に関係なく［OK］だけでゴミ箱に入れる） */
ipcMain.handle('skills:old', () => findOldSkills(homeDir()))
/** ゴミ箱に入れる（見つけたものだけ）。テストでは本物のゴミ箱ではなく、決まったフォルダに移す */
ipcMain.handle('skills:trash', async () => {
  const testTrash = process.env.RISING_LOOP_APP_TRASH_DIR
  for (const dir of findOldSkills(homeDir())) {
    if (testTrash) {
      mkdirSync(testTrash, { recursive: true })
      renameSync(dir, join(testTrash, `${basename(dir)}-${Date.now()}`))
    } else await shell.trashItem(dir)
  }
  return findOldSkills(homeDir())
})

// アプリのダイアログを出しているあいだは、重ねた画面（ループの画面とカードの層）を隠す
ipcMain.on('ui:covered', (_e, on: boolean) => {
  covered = !!on
  views?.setCovered(covered)
  layoutOverlay()
})
// ループが無いときの見出しの高さ（画面が測って伝える）。全面のチャットをその下に置く
ipcMain.on('ui:setup-head', (_e, h: number) => views?.setSetupHead(h))
// カードの大きさ（カードの層が伝える）
ipcMain.on('overlay:size', (_e, w: number, h: number) => {
  overlaySize = { w, h }
  layoutOverlay()
})
// 層がダイアログを出した・閉じた。出すときは入力を層に向け、閉じたら見えている画面に戻す
ipcMain.on('overlay:dialog', (_e, on: boolean) => {
  overlayDialog = !!on
  layoutOverlay()
  if (overlayDialog) overlay?.webContents.focus()
  else views?.focusShown() ?? win?.webContents.focus()
})
// アプリの画面（タブの列）から頼まれたダイアログを、層に出させる
ipcMain.on('ui:open-dialog', (_e, req: DialogRequest) => overlay?.webContents.send('ui:open-dialog', req))

// ループの画面がクリップボードに書いた指示文（preload/loops.ts が --- で囲まれた文だけを送る）
// 送り先は、指示文を出したループの画面でいま見えている画面ID（#s-L01 など）のチャット
ipcMain.on('loops:instruction', (e, text: string) => {
  const p = paneProject(e.sender.id)
  received.instructions.push({ projectId: p?.id ?? null, text })
  if (!p) return
  // 前の版の画面の「⬆ アップデート」は AI に渡さず、［新しい形にする］のダイアログを開く
  if (isUpdateRequest(text)) {
    overlay?.webContents.send('projects:open-notice', p.id)
    return
  }
  // 2.2.0 からの殻は右の窓をアプリが持つので、閉じていればアプリが開く（それより前の殻は殻が開く）
  if (views?.isAppChat(p.id) && !views.paneOpen(p.id)) {
    views.setPane(p.id, true)
    layoutOverlay()
    broadcast(snapshot())
  }
  chats.send(p, screenOfUrl(e.sender.getURL()), aiOf(p), text)
})

// 殻（2.3.0 から）の入力の窓。ダイアログの層に出させ、答えを殻に返す（キャンセルは null）
let askSeq = 0
const asks = new Map<number, (v: string | null) => void>()
ipcMain.handle('loops:ask', (e, req: AskRequest) => {
  if (!overlay || !paneProject(e.sender.id)) return null
  const id = ++askSeq
  overlay.webContents.send('ui:ask', { ...req, id })
  return new Promise<string | null>((resolve) => asks.set(id, resolve))
})
ipcMain.on('ui:ask-reply', (_e, id: number, value: string | null) => {
  asks.get(id)?.(typeof value === 'string' ? value : null)
  asks.delete(id)
})

/** 右の窓（main は送ってきた画面の webContents からプロジェクトを決める） */
function paneProject(senderId: number): Project | null {
  const id = views?.projectOf(senderId)
  return state.projects.find((p) => p.id === id) ?? null
}
type PaneMsg = { screen: string; cols: number; rows: number; data: string }
ipcMain.on('pane:attach', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  if (p && e.senderFrame) chats.attach(p, m.screen, aiOf(p), e.senderFrame, m.cols, m.rows)
})
ipcMain.on('pane:input', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  // Enter で開き直したとき、ループがまだ無く最初の依頼が届いていなければ、ここで送る（AI を入れたあとなど）
  if (p)
    chats.input(p.id, m.screen, m.data, () => {
      chats.restart(p, m.screen, aiOf(p))
      if (m.screen === 's-list') kickoff(p)
    })
})
ipcMain.on('pane:resize', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  if (p) chats.resize(p.id, m.screen, m.cols, m.rows)
})

app.whenReady().then(() => {
  if (hidden && process.platform === 'darwin') app.setActivationPolicy('accessory')
  // ログインシェルの環境変数は読むのに数秒かかるので、起動してすぐ読み始める（最初のチャットを待たせない）
  void loadShellEnv()
  setBundledPython(pythonDir())
  state = loadState(projectsFile())
  // 前に起動していたあいだに、消えた部品を移し終えていれば記録する
  settleLost()
  tpl = readTemplates((rel) => readFileSync(join(skillDir(), rel), 'utf8'))
  ledger = parseLedger(readFileSync(ledgerPath(), 'utf8'))
  chats = new Chats({
    dataDir: app.getPath('userData'),
    pluginDir: pluginDir(),
    skillDir: skillDir(),
    skillVersion: tpl.version,
    // スキルの版が変わって新しい会話にしたとき、最初に出す要点
    changes: changelogSummary(readText(join(skillDir(), 'CHANGELOG.md')) ?? '', tpl.version)
  })
  setMacMenu()
  refreshIconOnce()
  createWindow()
  void lookForUpdate()
  setInterval(() => void lookForUpdate(), UPDATE_EVERY_MS)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  chats?.killAll()
  tools.stop()
})
app.on('window-all-closed', () => app.quit())
