// アプリの周り（main と画面）のあいだで受け渡す形。ループの中身はスキルと loops/ が持つので、ここには持たない。

export interface Project {
  id: string
  /** タブに出す名前。はじめはフォルダ名 */
  name: string
  /** プロジェクトのフォルダの絶対パス。loops/ はこの下にある */
  folder: string
  addedAt: string
  /** 右のチャットで動かす AI（無ければ claude） */
  ai?: AiKind
  /** コマンド実行の確認。ask: 確認する（使う人の claude / codex の設定のまま）／auto: すべて自動で許可（無ければ ask） */
  perm?: PermMode
  /** ループが無いときに、最初の依頼をチャットへ送った日時。プロジェクトごとに1回だけ送る */
  kickoffAt?: string
  /** 古い形を知らせた、その形（「1.5-1.7:1.6.1」など）。同じ形について知らせるのは1回だけ */
  noticedForm?: string
  /** 新しい形にしたときの記録。［元に戻す］に使う。元に戻したら消す */
  migration?: Migration
}

export interface Migration {
  at: string
  /** 控えのフォルダ（アプリのデータ置き場の backups/<プロジェクト>/<日時>）。中に loops/ がある */
  backup: string
  /** 新しくする前の形の呼び名 */
  from: string
  /** 新しくする前の版（台帳を数え始める版）。印の無い頁と一覧は、ここから数える */
  fromVersion?: string
  /** 入れ替えで殻から消えた独自の部品（AI が移し直す） */
  lost: string[]
  /** 帯の「新しい形にしました」を閉じた */
  closed?: boolean
}

export interface ProjectsState {
  projects: Project[]
  currentId: string | null
}

/** 画面に渡す、プロジェクトの loops/ の形 */
export interface FormInfo {
  /** いまの形か（読めないときも true） */
  current: boolean
  /**
   * unsupported: 1.5 より前の形（アプリでは新しい形にできない）／old: 前の版（アプリ以前の形か、殻の版がスキルの版より古い）／
   * rework: 殻は新しいが、台帳の項目を AI がまだ反映していない頁・一覧か、まだ移していない消えた部品がある／current: いまの形
   */
  stage: 'unsupported' | 'old' | 'rework' | 'current'
  /** rework のとき、まだ反映していない頁 */
  reworkPages: string[]
  /** rework のとき、一覧のチャットの AI が作業中か */
  aiWorking: boolean
  /** 殻に書いてある版（分からなければ null）。2.1.0 以降の殻なら、アプリのタブの列に使い方と右の窓の開閉を出す */
  shellVersion: string | null
  /** 画面に出す呼び名（「1.6.1」「1.5〜1.7 の形」など） */
  label: string
  /** 知らせを判定する鍵（era と版） */
  key: string
}

/** 画面に渡す一覧。loops/index.html があるか、loops/ の形、同梱のスキルの版を添える */
export interface ProjectsSnapshot extends ProjectsState {
  hasLoops: Record<string, boolean>
  forms: Record<string, FormInfo>
  /** 右の窓を開いているか（プロジェクトごと） */
  panes: Record<string, boolean>
  skillVersion: string
  appVersion: string
}

/** 右のチャットで動かす AI */
/**
 * 殻（2.3.0 から）が window.rlaApp.ask で頼む入力の窓の中身。何を聞くかは殻が決め、アプリは窓を出すだけ。
 * chips は［札の文字, 押したら入力欄に入れる文］の並び
 */
export interface AskRequest {
  kick: string
  title: string
  sub: string
  placeholder: string
  chips: [string, string][]
}

/** アプリの画面（タブの列）から、ダイアログの層に出してもらうダイアログ */
export type DialogRequest = { kind: 'howto' } | { kind: 'add'; folder: string; name: string }

export type AiKind = 'claude' | 'codex'

export type PermMode = 'ask' | 'auto'

/** claude / codex が使えるか。missing: 入っていない／login: ログインしていない／ready: 使える */
export interface AiStatus {
  ai: AiKind
  state: 'missing' | 'login' | 'ready'
  version: string | null
}
