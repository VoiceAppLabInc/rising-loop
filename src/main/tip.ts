// タブの列の札（マウスを乗せるとすぐ出る）。ブラウザ標準の札（title）は出るまで待たされ、
// タブの列（高さ TAB_H）の中に描いた札はループの画面の層に隠れるので、札だけを描く小さな層をいちばん上に重ねる。
// 層の中身はアプリが持つ小さな HTML（ループの画面・スキルには触れない）
import { WebContentsView, type BrowserWindow } from 'electron'

/** 札の影を層の中に収めるための余白（px）。札の幅は層の幅ではなく中身の幅で測る（層は測る前は幅 0 で、合わせると1文字ずつ折り返す） */
const PAD = 6

const HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
html, body { margin: 0; background: transparent; overflow: hidden; }
#t { position: absolute; left: ${PAD}px; top: ${PAD}px; width: max-content; max-width: 420px; padding: 6px 9px; border-radius: 6px;
  background: #1c1c1b; color: #fff; font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
  white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
</style></head><body><div id="t"></div><script>
window.show = (text) => { const t = document.getElementById('t'); t.textContent = text; const r = t.getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) } }
</script></body></html>`

export interface Tip {
  /** 窓の中の (x, y) を左上にして札を出す。窓の右端からはみ出すときは左へずらす */
  show(text: string, x: number, y: number): void
  hide(): void
}

export function createTip(win: BrowserWindow): Tip {
  let view: WebContentsView | null = null
  let ready: Promise<unknown> | null = null
  /** 最後に頼まれた札の番号。文字を測っているあいだに隠す・別の札を出すと、古い頼みは捨てる */
  let seq = 0
  const ensure = () => {
    if (!view) {
      view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } })
      view.setBackgroundColor('#00000000')
      view.setVisible(false)
      ready = view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML))
    }
    return view
  }
  return {
    show(text, x, y) {
      const v = ensure()
      const n = ++seq
      void ready!
        .then(() => v.webContents.executeJavaScript(`show(${JSON.stringify(text)})`) as Promise<{ w: number; h: number }>)
        .then(({ w, h }) => {
          if (n !== seq || win.isDestroyed()) return
          const [width] = win.getContentSize()
          const vw = w + PAD * 2
          const vh = h + PAD * 2
          // いちばん上に重ね直す（ループの画面やカードの層は、あとから足すと上に来る）
          win.contentView.addChildView(v)
          v.setBounds({ x: Math.max(0, Math.min(Math.round(x) - PAD, width - vw)), y: Math.round(y) - PAD + 4, width: vw, height: vh })
          v.setVisible(true)
        })
        .catch(() => {})
    },
    hide() {
      seq++
      view?.setVisible(false)
    }
  }
}
