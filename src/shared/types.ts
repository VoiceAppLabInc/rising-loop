// アプリの周り（main と画面）のあいだで受け渡す形。ループの中身はスキルと loops/ が持つので、ここには持たない。

export interface Project {
  id: string
  /** タブに出す名前。はじめはフォルダ名 */
  name: string
  /** プロジェクトのフォルダの絶対パス。loops/ はこの下にある */
  folder: string
  addedAt: string
  /** ループが無いときに、最初の依頼をチャットへ送った日時。プロジェクトごとに1回だけ送る */
  kickoffAt?: string
  /** 古い形を知らせた、その形（「1.5-1.7:1.6.1」など）。同じ形について知らせるのは1回だけ */
  noticedForm?: string
}

export interface ProjectsState {
  projects: Project[]
  currentId: string | null
}

/** 画面に渡す、プロジェクトの loops/ の形 */
export interface FormInfo {
  /** いまの形か（読めないときも true） */
  current: boolean
  /** 画面に出す呼び名（「1.6.1」「1.5〜1.7 の形」など） */
  label: string
  /** 知らせを判定する鍵（era と版） */
  key: string
}

/** 画面に渡す一覧。loops/index.html があるか、loops/ の形、同梱のスキルの版を添える */
export interface ProjectsSnapshot extends ProjectsState {
  hasLoops: Record<string, boolean>
  forms: Record<string, FormInfo>
  skillVersion: string
}

/** 右のチャットで動かす AI */
export type AiKind = 'claude' | 'codex'
