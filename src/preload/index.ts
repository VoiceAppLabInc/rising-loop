// アプリの周りの画面（タブ・設定）用
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ProjectsSnapshot } from '@shared/types'

const api = {
  /** ウィンドウのボタンがタブの列のどちら側に来るか（main/platform.ts の windowChrome と合わせる） */
  controls: process.platform === 'darwin' ? 'left' : process.platform === 'win32' ? 'right' : 'none',
  getProjects: (): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:get'),
  addProject: (): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:add'),
  selectProject: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:select', id),
  noticed: (id: string, formKey: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('projects:noticed', id, formKey),
  setCovered: (on: boolean): void => ipcRenderer.send('ui:covered', on),
  migrate: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:migrate', id),
  rework: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:rework', id),
  undo: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:undo', id),
  closeMigrated: (id: string): Promise<ProjectsSnapshot> => ipcRenderer.invoke('loops:close-migrated', id),
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
