import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { BrowserWindow, WebContentsView, app, dialog, ipcMain, shell } from 'electron'
import { isUpdateRequest, screenOfUrl } from '@shared/intercept'
import { detectForm, formLabel, type LoopsForm } from '@shared/loopsForm'
import { changelogSummary, planMigration, readTemplates, reworkInstruction, stageOf, type LoopsFiles, type Templates } from '@shared/migrate'
import type { AiKind, AiStatus, FormInfo, PermMode, Project, ProjectsSnapshot, ProjectsState } from '@shared/types'
import { loadSettings, saveSettings } from './appSettings'
import { findOldSkills } from './oldSkills'
import { ToolRunner } from './tools'
import { Chats } from './chat'
import { childEnv, findCli, installCommand, loadShellEnv, loginArgs, parseLoggedIn, statusArgs, windowChrome } from './platform'
import { KICKOFF } from './launch'
import { parseLedger, pendingWork, type Ledger, type PendingWork } from './ledger'
import { applyPlan, backupLoops, pruneBackups, restoreLoops } from './migration'
import { addProject, loadState, markKickoff, markNotice, removeProject, saveState, selectProject, setMigration, updateProject } from './projects'
import { ProjectViews, TAB_H, hasLoops, type PaneOpen } from './views'

// テストでは、データ置き場を一時フォルダに変える
if (process.env.RISING_LOOP_APP_DATA_DIR) app.setPath('userData', process.env.RISING_LOOP_APP_DATA_DIR)

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

/** 殻から消えた独自の部品のうち、まだ新しい殻に移っていないもの（id で見る） */
const lostLeft = (p: Project, indexHtml: string) => (p.migration?.lost ?? []).filter((x) => x.startsWith('id="') && !indexHtml.includes(x))

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
  for (const p of state.projects) panes[p.id] = views?.paneOpen(p.id) ?? true
  return { ...state, hasLoops: hasLoopsMap, forms, panes, skillVersion: skillVersion(), appVersion: app.getVersion() }
}

/** いまのプロジェクトを出し、カードの層をループの画面のさらに上に置き直す */
function showCurrent(snap = snapshot()): ProjectsSnapshot {
  views?.show(current())
  layoutOverlay()
  return snap
}

/** 右の窓の幅（rising.css の --pane）。カードは右の窓を除いた幅の真ん中に置く */
const PANE_W = 360

/**
 * カードの層の置き場所。ループの画面があり、カードがあり、ダイアログや設定を出していないときだけ見せる。
 * ループの画面は後から足すと上に重なるので、そのたびにカードの層を足し直していちばん上にする
 */
function layoutOverlay(): void {
  if (!win || !overlay) return
  win.contentView.addChildView(overlay)
  const p = state && current()
  const show = !!p && hasLoops(p.folder) && !covered && overlaySize.w > 0 && overlaySize.h > 0
  overlay.setVisible(show)
  if (!show) return
  const [width] = win.getContentSize()
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
function kickoff(): void {
  const p = current()
  if (!p || p.kickoffAt || hasLoops(p.folder)) return
  state = markKickoff(state, p.id, new Date().toISOString())
  saveState(projectsFile(), state)
  chats.send(p, 's-list', aiOf(p), KICKOFF)
}

/**
 * ループが無いプロジェクトに loops/index.html ができたら、書き終わるのを待って通常の形に切り替える。
 * 見つけてから、もう一度見ても有るときに切り替える（その後の書き換えは自動の読み込み直しが受け持つ）
 */
/** 作り直しのあいだ、一覧のチャットの AI が作業中かどうかが変わったら、帯を出し直す */
let lastBusy: boolean | null = null
setInterval(() => {
  const p = state && current()
  const busy = !!p && !!chats?.busy(p.id, 's-list')
  if (busy !== lastBusy) {
    lastBusy = busy
    if (p?.migration) broadcast(showCurrent())
  }
}, 1000)

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
  const chrome = windowChrome(process.platform)
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Rising Loop App',
    titleBarStyle: chrome.titleBarStyle,
    ...(chrome.titleBarOverlay ? { titleBarOverlay: chrome.titleBarOverlay } : {}),
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
  views.onLoopsChanged(() => broadcast(showCurrent()))
  overlay = new WebContentsView({
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: !hidden }
  })
  overlay.setBackgroundColor('#00000000')
  overlay.setVisible(false)
  if (process.env.ELECTRON_RENDERER_URL) void overlay.webContents.loadURL(process.env.ELECTRON_RENDERER_URL + '?overlay=bar')
  else void overlay.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: 'bar' } })
  win.on('resize', layoutOverlay)
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
ipcMain.handle('projects:update', (_e, id: string, patch: { ai?: AiKind; perm?: PermMode }) => {
  const before = state.projects.find((x) => x.id === id)
  if (!before) return snapshot()
  commit(updateProject(state, id, patch))
  const after = state.projects.find((x) => x.id === id)!
  if (aiOf(after) !== aiOf(before) || (after.perm ?? 'ask') !== (before.perm ?? 'ask')) chats.restartProject(after, aiOf(after))
  return snapshot()
})

/** フォルダを選び直す。名前もそのフォルダ名になる。前のフォルダの画面とチャットは捨て、新しいフォルダで開き直す */
ipcMain.handle('projects:pick-folder', async (_e, id: string) => {
  if (!win || !state.projects.some((x) => x.id === id)) return snapshot()
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return snapshot()
  views?.removeProject(id)
  chats.killProject(id)
  commit(updateProject(state, id, { folder: r.filePaths[0] }))
  return snapshot()
})

/** アプリの一覧から外す（フォルダには触れない） */
ipcMain.handle('projects:remove', (_e, id: string) => {
  views?.removeProject(id)
  chats.killProject(id)
  commit(removeProject(state, id))
  return snapshot()
})

/** 右の窓の開閉（アプリのタブの列の［AI の窓］） */
ipcMain.handle('loops:pane', (_e, id: string, on: boolean) => {
  views?.setPane(id, on)
  layoutOverlay()
  return snapshot()
})

/** claude / codex が入っているか・ログインしているか */
function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: 20_000, windowsHide: true }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0
      resolve({ out: String(stdout ?? ''), code })
    })
  })
}
async function aiStatus(ai: AiKind): Promise<AiStatus> {
  const cmd = await findCli(ai)
  if (!cmd) return { ai, state: 'missing', version: null }
  const env = await childEnv()
  const v = await run(cmd.file, [...cmd.args, '--version'], env)
  const st = await run(cmd.file, [...cmd.args, ...statusArgs(ai)], env)
  return { ai, state: parseLoggedIn(ai, st.out, st.code) ? 'ready' : 'login', version: v.out.trim().split('\n')[0] || null }
}
ipcMain.handle('ai:status', async () => Promise.all((['claude', 'codex'] as AiKind[]).map(aiStatus)))

/** ［入れる］［ログイン］。公式の手順をアプリの中のターミナルで動かす（1つずつ） */
const tools = new ToolRunner()
ipcMain.handle('ai:run', async (_e, ai: AiKind, kind: 'install' | 'login', cols: number, rows: number) => {
  let cmd = kind === 'install' ? installCommand(ai, process.platform) : null
  if (kind === 'login') {
    const cli = await findCli(ai)
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
    onData: (d) => win?.webContents.send('tool:data', d),
    onExit: (code) => win?.webContents.send('tool:exit', code)
  })
  return true
})
ipcMain.on('tool:input', (_e, d: string) => tools.input(d))
ipcMain.on('tool:resize', (_e, cols: number, rows: number) => tools.resize(cols, rows))
ipcMain.on('tool:stop', () => tools.stop())

// ── アプリ全体の記録・ほかの場所の rising-loop ──

ipcMain.handle('app:settings', () => loadSettings(settingsFile()))
ipcMain.handle('app:howto-seen', () => saveSettings(settingsFile(), { ...loadSettings(settingsFile()), howtoSeen: true }))

/** ほかの場所に入っている rising-loop。［残す］と答えていれば空 */
ipcMain.handle('skills:old', () => (loadSettings(settingsFile()).keepOldSkills ? [] : findOldSkills(homeDir())))
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
ipcMain.handle('skills:keep', () => saveSettings(settingsFile(), { ...loadSettings(settingsFile()), keepOldSkills: true }))

// アプリのダイアログを出しているあいだは、重ねた画面（ループの画面とカードの層）を隠す
ipcMain.on('ui:covered', (_e, on: boolean) => {
  covered = !!on
  views?.setCovered(covered)
  layoutOverlay()
})
// カードの大きさ（カードの層が伝える）
ipcMain.on('overlay:size', (_e, w: number, h: number) => {
  overlaySize = { w, h }
  layoutOverlay()
})
// カードの［元に戻す］。確認はアプリの画面で出す
ipcMain.on('ui:ask-undo', () => win?.webContents.send('ui:ask-undo'))

// ループの画面がクリップボードに書いた指示文（preload/loops.ts が --- で囲まれた文だけを送る）
// 送り先は、指示文を出したループの画面でいま見えている画面ID（#s-L01 など）のチャット
ipcMain.on('loops:instruction', (e, text: string) => {
  const p = paneProject(e.sender.id)
  received.instructions.push({ projectId: p?.id ?? null, text })
  if (!p) return
  // 前の版の画面の「⬆ アップデート」は AI に渡さず、［新しい形にする］のダイアログを開く
  if (isUpdateRequest(text)) {
    win?.webContents.send('projects:open-notice', p.id)
    return
  }
  chats.send(p, screenOfUrl(e.sender.getURL()), aiOf(p), text)
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
  if (p) chats.input(p.id, m.screen, m.data, () => chats.restart(p, m.screen, aiOf(p)))
})
ipcMain.on('pane:resize', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  if (p) chats.resize(p.id, m.screen, m.cols, m.rows)
})

app.whenReady().then(() => {
  if (hidden && process.platform === 'darwin') app.setActivationPolicy('accessory')
  // ログインシェルの環境変数は読むのに数秒かかるので、起動してすぐ読み始める（最初のチャットを待たせない）
  void loadShellEnv()
  state = loadState(projectsFile())
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  chats?.killAll()
  tools.stop()
})
app.on('window-all-closed', () => app.quit())
