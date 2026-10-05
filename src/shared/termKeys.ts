// チャット（右の窓・全面のチャット）とログインのターミナルでの、コピーと貼り付けのキー。
// Mac はアプリのメニュー（編集）の ⌘C・⌘V が効くので何もしない。Windows・Linux はメニューが無く、
// Ctrl+C は「止める」、Ctrl+V はただの制御文字として AI に送られていた（2026-10-05 の苦情）。Windows Terminal と同じ動きにする

export type TermKeyAction = 'copy' | 'paste' | 'none' | 'pass'

export interface KeyLike {
  type: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * キーを押したときにどうするか。copy＝選んだ文字をコピー、paste＝貼り付け、none＝何もしない（ターミナルにも送らない）、pass＝いままでどおりターミナルに送る。
 * Ctrl+C は、選んでいればコピー、選んでいなければ送る（AI を止める）
 */
export function termKeyAction(e: KeyLike, hasSelection: boolean, platform: string): TermKeyAction {
  if (platform === 'darwin' || e.altKey || e.metaKey) return 'pass'
  const k = e.key.toLowerCase()
  const hit =
    e.ctrlKey && k === 'c' ? (hasSelection ? 'copy' : e.shiftKey ? 'none' : 'pass')
    : e.ctrlKey && k === 'v' ? 'paste'
    : e.key === 'Insert' && e.shiftKey && !e.ctrlKey ? 'paste'
    : e.key === 'Insert' && e.ctrlKey && !e.shiftKey ? (hasSelection ? 'copy' : 'none')
    : 'pass'
  // 押したときだけ動く。同じキーを離したとき・押し続けたときの残りは、ターミナルに送らない
  if (e.type !== 'keydown') return hit === 'pass' ? 'pass' : 'none'
  return hit
}

/** 右クリックで、選んでいればコピー・選んでいなければ貼り付け（Windows Terminal と同じ）。Mac はしない */
export const rightClickClipboard = (platform: string): boolean => platform !== 'darwin'
