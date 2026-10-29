// 全ループの自動更新（プロジェクトごと）。アプリが開いているあいだ、決めた時刻と間隔で、一覧のチャットに［全ループ更新］と同じ指示文を送る。
// 時刻を過ぎていて、まだ送っていなければ送る。スリープや閉じていて時刻を逃したら、起きた・開いたときに1回だけ送る

/** 間隔（日）。毎日・2日ごと・3日ごと・毎週 */
export type AutoEvery = 1 | 2 | 3 | 7
export const AUTO_EVERY: { days: AutoEvery; label: string }[] = [
  { days: 1, label: '毎日' },
  { days: 2, label: '2日ごと' },
  { days: 3, label: '3日ごと' },
  { days: 7, label: '毎週' }
]

/** 設定で決めるもの */
export interface AutoUpdateSetting {
  on: boolean
  every: AutoEvery
  /** 送る時刻（その PC の時計で HH:MM） */
  at: string
}

export interface AutoUpdate extends AutoUpdateSetting {
  /** するにした日時。まだ送っていないときは、これより後の最初の時刻に送る */
  since?: string
  /** 最後に自動で送った日時 */
  last?: string
}

export const AUTO_UPDATE_DEFAULT: AutoUpdateSetting = { on: false, every: 1, at: '08:00' }

/**
 * 一覧の［全ループ更新］で送るのと同じ形の指示文（スキルの assets/rising.js の block('all', 'ALL', '', TASK.all, 'task')）。
 * 自動で送ったことが会話で分かるよう、task の2行目に書き添える
 */
export const AUTO_UPDATE_TEXT = `---
loop: all
section: ALL
rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと
task: |
  loops/ の全ループを更新して
  （設定の「全ループの自動更新」で送りました）
---`

/** 「毎日 8:00」のような、間隔と時刻の言い方 */
export function autoUpdateLabel(a: AutoUpdateSetting): string {
  const every = AUTO_EVERY.find((x) => x.days === a.every)?.label ?? `${a.every}日ごと`
  return `${every} ${a.at.replace(/^0(\d)/, '$1')}`
}

/** day の日付で、時刻 at（HH:MM）にした日時 */
function onDay(day: Date, at: string): Date {
  const [h, m] = at.split(':').map((x) => parseInt(x, 10) || 0)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
}

/**
 * 次に送る日時。しないなら null。
 * 送ったことがあれば、送った日から間隔の日数後の時刻（遅れて送っても、次は時刻どおり）。
 * まだ送っていなければ、するにした時より後の最初の時刻（時刻を過ぎてからするにしたら翌日。すぐには送らない）
 */
export function nextAutoUpdate(a: AutoUpdate | undefined): Date | null {
  if (!a?.on) return null
  if (a.last) {
    const d = new Date(a.last)
    return onDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + a.every), a.at)
  }
  const since = a.since ? new Date(a.since) : null
  if (!since || isNaN(since.getTime())) return null
  const t = onDay(since, a.at)
  return t >= since ? t : onDay(new Date(since.getFullYear(), since.getMonth(), since.getDate() + 1), a.at)
}

/** いま送るか（次に送る日時を過ぎているか） */
export function autoUpdateDue(a: AutoUpdate | undefined, now: Date): boolean {
  const next = nextAutoUpdate(a)
  return !!next && now >= next
}
