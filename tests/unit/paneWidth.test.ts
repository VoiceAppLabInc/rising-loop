import { describe, expect, it } from 'vitest'
import { PANE_W, clampPaneWidth } from '../../src/shared/paneWidth'

describe('clampPaneWidth（右のチャットの窓の幅をウィンドウに収める）', () => {
  it('280px からウィンドウの 6 割までに収める', () => {
    expect(clampPaneWidth(500, 1200)).toBe(500)
    expect(clampPaneWidth(100, 1200)).toBe(280)
    expect(clampPaneWidth(1000, 1200)).toBe(720)
  })
  it('ウィンドウが狭くて 6 割が 280px に届かないときは、6 割まで', () => {
    expect(clampPaneWidth(360, 400)).toBe(240)
  })
  it('数でないときは初めの値', () => {
    expect(clampPaneWidth(Number.NaN, 1200)).toBe(PANE_W)
  })
})
