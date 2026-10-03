// アプリの周りの画面（タブ・設定）用
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiKind, AiStatus, AskRequest, DialogRequest, FoundSkill, PermMode, ProjectsSnapshot } from '@shared/types'

const api = {
  /** ウィンドウのボタンがタブの列のどちら側に来るか（main/platform.ts の windowChrome と合わせる） */
  controls: process.platform === 'darwin' ? 'left' : process.platform === 'win32' ? 'right' : 'none',
  getProjects: (): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:get'),
  /** フォルダを選ぶ。ループが無い新しいフォルダなら ask を返す（追加は addProject で） */
  pickNewProject: (): Promise<{ snap: ProjectsSnapshot; ask?: { folder: string; name: string } }> => ipcRenderer.invoke('projects:pick-new'),
  addProject: (folder: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:add', folder),
  selectProject: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:select', id),
  noticed: (id: string, formKey: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:noticed', id, formKey),
  setCovered: (on: boolean): void => ipcRenderer.send('ui:covered', on),
  migrate: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:migrate', id),
  rework: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:rework', id),
  undo: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:undo', id),
  closeMigrated: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:close-migrated', id),
  updateProject: (id: string, patch: { folder?: string; ai?: AiKind; perm?: PermMode }): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:update', id, patch),
  /** フォルダを選ぶだけ（選ばなければ null）。切り替えは updateProject で */
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('projects:choose-folder'),
  removeProject: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:remove', id),
  setPane: (id: string, on: boolean): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:pane', id, on),
  /** そのタブのループの画面で、戻る（-1）・進む（1） */
  go: (id: string, dir: -1 | 1): Promise<void> => ipcRenderer.invoke('loops:go', id, dir),
  aiStatus: (): Promise<AiStatus[]> => ipcRenderer.invoke('ai:status'),
  runTool: (ai: AiKind, kind: 'install' | 'login', cols: number, rows: number): Promise<boolean> => ipcRenderer.invoke('ai:run', ai, kind, cols, rows),
  toolInput: (d: string): void => ipcRenderer.send('tool:input', d),
  toolResize: (cols: number, rows: number): void => ipcRenderer.send('tool:resize', cols, rows),
  toolStop: (): void => ipcRenderer.send('tool:stop'),
  onToolData: (cb: (d: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, d: string) => cb(d)
    ipcRenderer.on('tool:data', h)
    return () => ipcRenderer.removeListener('tool:data', h)
  },
  onToolExit: (cb: (code: number) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, c: number) => cb(c)
    ipcRenderer.on('tool:exit', h)
    return () => ipcRenderer.removeListener('tool:exit', h)
  },
  settings: (): Promise<{ keepOldSkills?: boolean; howtoSeen?: boolean; updateSeen?: string }> => ipcRenderer.invoke('app:settings'),
  howtoSeen: (): Promise<void> => ipcRenderer.invoke('app:howto-seen'),
  updateSeen: (version: string): Promise<void> => ipcRenderer.invoke('app:update-seen', version),
  installUpdate: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('app:install-update'),
  oldSkills: (): Promise<FoundSkill[]> => ipcRenderer.invoke('skills:old'),
  trashOldSkills: (): Promise<FoundSkill[]> => ipcRenderer.invoke('skills:trash'),
  keepOldSkills: (): Promise<void> => ipcRenderer.invoke('skills:keep'),
  /** ループの画面の上のカード（透明な層）の大きさを伝える */
  overlaySize: (w: number, h: number): void => ipcRenderer.send('overlay:size', w, h),
  /** 層がダイアログを出しているか（main が層を窓いっぱいに広げ、入力を層に向ける） */
  overlayDialog: (on: boolean): void => ipcRenderer.send('overlay:dialog', on),
  /** アプリの画面から、層にダイアログを出してもらう */
  openDialog: (req: DialogRequest): void => ipcRenderer.send('ui:open-dialog', req),
  onOpenDialog: (cb: (req: DialogRequest) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, req: DialogRequest) => cb(req)
    ipcRenderer.on('ui:open-dialog', h)
    return () => ipcRenderer.removeListener('ui:open-dialog', h)
  },
  /** ループの画面（2.3.0 からの殻）が頼んだ入力の窓。答えは askReply で返す（キャンセルは null） */
  onAsk: (cb: (req: AskRequest & { id: number }) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, req: AskRequest & { id: number }) => cb(req)
    ipcRenderer.on('ui:ask', h)
    return () => ipcRenderer.removeListener('ui:ask', h)
  },
  askReply: (id: number, value: string | null): void => ipcRenderer.send('ui:ask-reply', id, value),
  /** 前の版の画面の「⬆ アップデート」を押したとき（main が横取りして知らせる） */
  onOpenNotice: (cb: (id: string) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, id: string) => cb(id)
    ipcRenderer.on('projects:open-notice', h)
    return () => ipcRenderer.removeListener('projects:open-notice', h)
  },
  onProjects: (cb: (s: ProjectsSnapshot) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, s: ProjectsSnapshot) => cb(s)
    ipcRenderer.on('projects:changed', h)
    return () => ipcRenderer.removeListener('projects:changed', h)
  }
}

export type RlaApi = typeof api

contextBridge.exposeInMainWorld('rla', api)
