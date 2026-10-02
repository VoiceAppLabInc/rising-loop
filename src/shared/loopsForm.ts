// プロジェクトの loops/ が、どの版の形かを見分ける。
// 殻の版の表示（<span class="ver">）は目安にしかならない（1.7.1 から雛形が v0.0.0 のまま、1.7.0 の雛形は v1.6.1 と書いてある）。
// 新しくする必要があるかは、版ごとの形の印で決める。

export type Era =
  /** 殻が1ファイル（rising.js と CONST の印が無い） */
  | '1.2'
  /** 頁が値を LXX.md に持つ形（data-page-schema が 2 でない） */
  | '1.3-1.4'
  /** 右のチャットが ttyd の形（💡・⬆ アップデート・ttyd の説明がある） */
  | '1.5-1.7'
  | 'current'
  /** 殻が読めない */
  | 'unknown'

export interface LoopsForm {
  era: Era
  /** 殻に書いてある版（v0.0.0 や表示が無いときは null） */
  shown: string | null
  /** いまの形か。読めないときも true（何も変えない） */
  current: boolean
}

/** 古い順に見る。いちばん古い印で決める */
const TTYD_MARKS = ['id="cc-ask"', 'id="cc-help"', 'id="rl-update"']

export function detectForm(o: { indexHtml: string | null; pages: string[] }): LoopsForm {
  if (o.indexHtml == null) return { era: 'unknown', shown: null, current: true }
  const m = /<span class="ver"[^>]*>v?([0-9][0-9.]*)<\/span>/.exec(o.indexHtml)
  const shown = m && m[1] !== '0.0.0' ? m[1] : null
  const era: Era = !o.indexHtml.includes('CONST:BEGIN')
    ? '1.2'
    : o.pages.some((p) => !/<html[^>]*\bdata-page-schema="2"/.test(p))
      ? '1.3-1.4'
      : TTYD_MARKS.some((k) => o.indexHtml!.includes(k))
        ? '1.5-1.7'
        : 'current'
  return { era, shown, current: era === 'current' }
}

/** 画面に出す呼び名 */
export function formLabel(f: LoopsForm): string {
  if (f.shown) return f.shown
  return f.era === '1.2' ? '1.2 以前の形' : f.era === '1.3-1.4' ? '1.3〜1.4 の形' : f.era === '1.5-1.7' ? '1.5〜1.7 の形' : 'バージョンの分からない形'
}
