// 2本指の横スクロールを「戻る・進む」にする判定。Mac のトラックパッドの「ページ間をスワイプ（2本指）」は、
// Electron には戻る・進むの合図として届かず、ページにはただの横スクロール（wheel の deltaX）として来る。
// ひと払いの横の量を足していき、目安を越えたら1回だけ向きを返す。

/** 動きがこのあいだ止まったら、次のひと払いとみなす */
export const SWIPE_GAP_MS = 200
/** ひと払いの横の量の合計がこれを越えたら、戻る・進むにする（払ったあとの小さな反対向きの動きでは越えない） */
export const SWIPE_MIN_PX = 300

export interface SwipeState {
  /** いまのひと払いの横の量の合計 */
  sum: number
  /** 最後に横スクロールが来た時刻 */
  last: number
  /** いまのひと払いで、もう戻る・進むにしたか */
  fired: boolean
}

/**
 * 横スクロールを1つ足す。dir は -1（戻る）・1（進む）・0（まだ）。
 * 右へ払うと deltaX がマイナスで届くので戻る、左へ払うとプラスで進む（Safari・Chrome と同じ向き）。
 * canScroll：その場所が、払った向きにまだ横スクロールできる（表や図の中で端まで来ていない）。そのあいだは数えない
 */
export function swipeStep(s: SwipeState, dx: number, dy: number, now: number, canScroll: boolean): { state: SwipeState; dir: -1 | 0 | 1 } {
  const fresh = now - s.last > SWIPE_GAP_MS
  const base: SwipeState = fresh ? { sum: 0, last: now, fired: false } : { ...s, last: now }
  if (Math.abs(dy) >= Math.abs(dx) || canScroll || base.fired) return { state: canScroll ? { ...base, sum: 0 } : base, dir: 0 }
  const sum = base.sum + dx
  if (Math.abs(sum) < SWIPE_MIN_PX) return { state: { ...base, sum }, dir: 0 }
  return { state: { ...base, sum, fired: true }, dir: sum < 0 ? -1 : 1 }
}
