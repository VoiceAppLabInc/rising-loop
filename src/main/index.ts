import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { screenOfUrl } from '@shared/intercept'
import type { Project, ProjectsSnapshot, ProjectsState } from '@shared/types'
import { Chats } from './chat'
import { windowChrome } from './platform'
import { addProject, loadState, saveState, selectProject } from './projects'
import { ProjectViews, hasLoops, type PaneOpen } from './views'

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

function snapshot(): ProjectsSnapshot {
  const hasLoopsMap: Record<string, boolean> = {}
  for (const p of state.projects) hasLoopsMap[p.id] = hasLoops(p.folder)
  return { ...state, hasLoops: hasLoopsMap }
}

function commit(next: ProjectsState): void {
  state = next
  saveState(projectsFile(), state)
  views?.show(state.projects.find((p) => p.id === state.currentId) ?? null)
  win?.webContents.send('projects:changed', snapshot())
}

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
  win.webContents.once('did-finish-load', () => views?.show(state.projects.find((p) => p.id === state.currentId) ?? null))
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
