import { describe, expect, it } from 'vitest'
import { SWIPE_GAP_MS, SWIPE_MIN_PX, swipeStep, type SwipeState } from '../../src/shared/swipe'

/** 横の量を順に流して、出た向きを集める（間隔は ms） */
function run(events: { dx: number; dy?: number; gap?: number; canScroll?: boolean }[]): number[] {
  let s: SwipeState = { sum: 0, last: -Infinity, fired: false }
  let now = 0
  const out: number[] = []
  for (const e of events) {
    now += e.gap ?? 16
    const r = swipeStep(s, e.dx, e.dy ?? 0, now, e.canScroll ?? false)
    s = r.state
    if (r.dir) out.push(r.dir)
  }
  return out
}
const many = (dx: number, n: number, extra: { gap?: number; canScroll?: boolean } = {}) => Array.from({ length: n }, () => ({ dx, ...extra }))

describe('swipeStep（2本指の横スクロールを、戻る・進むにする）', () => {
  it('右へ払う（横の量がマイナス）と戻る、左へ払う（プラス）と進む', () => {
    expect(run(many(-60, 8))).toEqual([-1])
    expect(run(many(60, 8))).toEqual([1])
  })

  it(`ひと払いの合計が ${SWIPE_MIN_PX}px に届かなければ何もしない`, () => {
    expect(run(many(-40, 5))).toEqual([])
  })

  it('ひと払いで1回だけ（合計が目安を何倍越えても1回）', () => {
    expect(run(many(-100, 40))).toEqual([-1])
  })

  it(`動きが ${SWIPE_GAP_MS}ms 止まったら次のひと払い。払ったあとの小さな反対向きの動きでは進まない`, () => {
    expect(run([...many(-100, 10), { dx: 30, gap: SWIPE_GAP_MS + 50 }, ...many(30, 5)])).toEqual([-1])
  })

  it('2回払えば2回', () => {
    expect(run([...many(-100, 10), { dx: -100, gap: SWIPE_GAP_MS + 50 }, ...many(-100, 9)])).toEqual([-1, -1])
  })

  it('縦の動きのほうが大きいときは数えない（ふつうのスクロール）', () => {
    expect(run(many(-60, 10).map((e) => ({ ...e, dy: 200 })))).toEqual([])
  })

  it('横にスクロールできる表や図の中で、端まで来ていないあいだは数えない', () => {
    expect(run(many(-100, 10, { canScroll: true }))).toEqual([])
  })
})
