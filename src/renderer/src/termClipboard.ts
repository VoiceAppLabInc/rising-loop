// ターミナル（xterm.js）にコピーと貼り付けを付ける。どのキーで何をするかは shared/termKeys.ts（preload の clip.action）が決める。
// 右の窓の resources/pane/pane.js にも同じつなぎがある（あちらは素の JS。変えるときは両方そろえる）
import type { Terminal } from '@xterm/xterm'
import { rightClickClipboard, termKeyAction } from '@shared/termKeys'

/** preload（window.rla.clip）が渡すもの：OS と、main を通したクリップボードの読み書き */
export interface TermClip {
  platform: string
  copy: (t: string) => void
  paste: () => Promise<string>
}

/** キーと右クリックを付ける。外す関数を返す */
export function attachClipboard(term: Terminal, el: HTMLElement, clip: TermClip): () => void {
  const copy = () => {
    clip.copy(term.getSelection())
    term.clearSelection()
  }
  const paste = () => void clip.paste().then((t) => t && term.paste(t))
  term.attachCustomKeyEventHandler((e) => {
    const a = termKeyAction({ type: e.type, key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }, term.hasSelection(), clip.platform)
    if (a === 'pass') return true
    // ブラウザの貼り付けも止める（止めないと二重に貼られる）
    e.preventDefault()
    if (a === 'copy') copy()
    if (a === 'paste') paste()
    return false
  })
  const onMenu = (e: MouseEvent) => {
    if (!rightClickClipboard(clip.platform)) return
    e.preventDefault()
    if (term.hasSelection()) copy()
    else paste()
  }
  el.addEventListener('contextmenu', onMenu)
  return () => el.removeEventListener('contextmenu', onMenu)
}
