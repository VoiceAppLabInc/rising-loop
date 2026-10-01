// アプリの周り（main と画面）のあいだで受け渡す形。ループの中身はスキルと loops/ が持つので、ここには持たない。

export interface Project {
  id: string
  /** タブに出す名前。はじめはフォルダ名 */
  name: string
  /** プロジェクトのフォルダの絶対パス。loops/ はこの下にある */
  folder: string
  addedAt: string
}

export interface ProjectsState {
  projects: Project[]
  currentId: string | null
}

/** 画面に渡す一覧。loops/index.html があるかを添える */
export interface ProjectsSnapshot extends ProjectsState {
  hasLoops: Record<string, boolean>
}

/** 右のチャットで動かす AI */
export type AiKind = 'claude' | 'codex'
