import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { screenOfUrl } from '@shared/intercept'
import { detectForm, formLabel } from '@shared/loopsForm'
import type { FormInfo, Project, ProjectsSnapshot, ProjectsState } from '@shared/types'
import { Chats } from './chat'
import { loadShellEnv, windowChrome } from './platform'
import { KICKOFF } from './launch'
import { addProject, loadState, markKickoff, markNotice, saveState, selectProject } from './projects'
import { BAR_H, ProjectViews, hasLoops, type PaneOpen } from './views'

// テストでは、データ置き場を一時フォルダに変える
if (process.env.RISING_LOOP_APP_DATA_DIR) app.setPath('userData', process.env.RISING_LOOP_APP_DATA_DIR)

/** テストでは、ウィンドウを出さず Dock にも出さない（操作中の画面を奪わない） */
const hidden = process.env.RISING_LOOP_APP_HIDDEN === '1'

const projectsFile = () => join(app.getPath('userData'), 'projects.json')

let state: ProjectsState
let win: BrowserWindow | null = null
let views: ProjectViews | null = null
let chats: Chats

/** 同梱のスキルと、右の窓の動き。開発中はリポジトリの中、配るときはアプリの Resources の中 */
const resourceRoot = () => (app.isPackaged ? process.resourcesPath : app.getAppPath())
const pluginDir = () => join(resourceRoot(), 'skill')
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

/** loops/ の形（殻と各ループの頁を読んで見分ける） */
function formOf(folder: string): FormInfo {
  const dir = join(folder, 'loops')
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => /^L\d+\.html$/.test(n))
  } catch {
    // loops/ が無い
  }
  const f = detectForm({ indexHtml: readText(join(dir, 'index.html')), pages: names.map((n) => readText(join(dir, n)) ?? '') })
  return { current: f.current, label: formLabel(f), key: `${f.era}:${f.shown ?? ''}` }
}

const skillVersion = () => (readText(join(pluginDir(), 'skills', 'rising-loop', 'VERSION')) ?? '').trim()

function snapshot(): ProjectsSnapshot {
  const hasLoopsMap: Record<string, boolean> = {}
  const forms: Record<string, FormInfo> = {}
  for (const p of state.projects) {
    hasLoopsMap[p.id] = hasLoops(p.folder)
    forms[p.id] = formOf(p.folder)
  }
  return { ...state, hasLoops: hasLoopsMap, forms, skillVersion: skillVersion() }
}

/** 古い形のプロジェクトでは、タブの下に帯を出す分だけループの画面を下げる */
function showCurrent(snap = snapshot()): ProjectsSnapshot {
  const p = current()
  views?.setBar(p && snap.hasLoops[p.id] && !snap.forms[p.id].current ? BAR_H : 0)
  views?.show(p)
  return snap
}

const current = () => state.projects.find((p) => p.id === state.currentId) ?? null

function commit(next: ProjectsState): void {
  state = next
  saveState(projectsFile(), state)
  win?.webContents.send('projects:changed', showCurrent())
  kickoff()
}

/** ループが無いプロジェクトを初めて開いたら、全面のチャットに最初の依頼を送る（プロジェクトごとに1回だけ） */
function kickoff(): void {
  const p = current()
  if (!p || p.kickoffAt || hasLoops(p.folder)) return
  state = markKickoff(state, p.id, new Date().toISOString())
  saveState(projectsFile(), state)
  chats.send(p, 's-list', 'claude', KICKOFF)
}

/**
 * ループが無いプロジェクトに loops/index.html ができたら、書き終わるのを待って通常の形に切り替える。
 * 見つけてから、もう一度見ても有るときに切り替える（その後の書き換えは自動の読み込み直しが受け持つ）
 */
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
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.webContents.once('did-finish-load', () => {
    showCurrent()
    kickoff()
  })
  win.on('closed', () => {
    views?.dispose()
    win = null
    views = null
  })
}

ipcMain.handle('projects:get', () => snapshot())
ipcMain.handle('projects:add', async () => {
  if (!win) return snapshot()
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled || !r.filePaths[0]) return snapshot()
  commit(addProject(state, r.filePaths[0], new Date().toISOString()).state)
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
// アプリのダイアログを出しているあいだは、重ねた画面を隠す
ipcMain.on('ui:covered', (_e, on: boolean) => views?.setCovered(!!on))

// ループの画面がクリップボードに書いた指示文（preload/loops.ts が --- で囲まれた文だけを送る）
// 送り先は、指示文を出したループの画面でいま見えている画面ID（#s-L01 など）のチャット
ipcMain.on('loops:instruction', (e, text: string) => {
  const p = paneProject(e.sender.id)
  received.instructions.push({ projectId: p?.id ?? null, text })
  if (p) chats.send(p, screenOfUrl(e.sender.getURL()), 'claude', text)
})

/** 右の窓（main は送ってきた画面の webContents からプロジェクトを決める） */
function paneProject(senderId: number): Project | null {
  const id = views?.projectOf(senderId)
  return state.projects.find((p) => p.id === id) ?? null
}
type PaneMsg = { screen: string; cols: number; rows: number; data: string }
ipcMain.on('pane:attach', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  if (p && e.senderFrame) chats.attach(p, m.screen, 'claude', e.senderFrame, m.cols, m.rows)
})
ipcMain.on('pane:input', (e, m: PaneMsg) => {
  const p = paneProject(e.sender.id)
  if (p) chats.input(p.id, m.screen, m.data, () => chats.restart(p, m.screen, 'claude'))
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
  const skill = pluginDir()
  chats = new Chats({ dataDir: app.getPath('userData'), pluginDir: skill, skillDir: join(skill, 'skills', 'rising-loop') })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => chats?.killAll())
app.on('window-all-closed', () => app.quit())
