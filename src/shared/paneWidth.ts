// 右のチャットの窓の幅（main の views.ts が使う。決まりだけをここに置き、単体テストする）

/** 右のチャットの窓の幅の初めの値。殻が窓を持っていた頃（2.2.0 より前）の殻の --pane と同じ。左端のドラッグで変えられる（0.2.7） */
export const PANE_W = 360
/** ドラッグで変えられる幅の範囲：狭くても PANE_MIN、広くてもウィンドウの PANE_MAX_RATIO まで */
export const PANE_MIN = 280
export const PANE_MAX_RATIO = 0.6
/** 決めた幅を、いまのウィンドウの幅に収める（ウィンドウが狭いときは最小より狭くなることもある） */
export function clampPaneWidth(w: number, windowWidth: number): number {
  const max = Math.floor(windowWidth * PANE_MAX_RATIO)
  const v = Number.isFinite(w) ? Math.round(w) : PANE_W
  return Math.max(Math.min(PANE_MIN, max), Math.min(Math.max(v, PANE_MIN), max))
}
