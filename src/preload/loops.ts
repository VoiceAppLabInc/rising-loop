// ループの画面（スキルの HTML）と、その中の右の窓に差し込む。画面のファイルは書き換えない。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { PANE_PORT, isInstruction } from '@shared/intercept'
import { rightClickClipboard, termKeyAction, type KeyLike } from '@shared/termKeys'
import { swipeStep, type SwipeState } from '@shared/swipe'
import type { AskRequest } from '@shared/types'

/** キーの決まりに使う OS。main に聞く（sandbox の preload には process.env が無い。テストでは main が Windows のふりをする） */
const PLATFORM = String(ipcRenderer.sendSync('app:platform') || process.platform)

if (location.protocol === 'http:' && location.port === PANE_PORT) {
  // 右の窓（アプリが localhost:7681 として出すページ）。ターミナルの入出力を main とやり取りする
  contextBridge.exposeInMainWorld('rlaPane', {
    attach: (screen: string, cols: number, rows: number) => ipcRenderer.send('pane:attach', { screen, cols, rows }),
    input: (screen: string, data: string) => ipcRenderer.send('pane:input', { screen, data }),
    resize: (screen: string, cols: number, rows: number) => ipcRenderer.send('pane:resize', { screen, cols, rows }),
    onData: (cb: (d: string) => void) => {
      ipcRenderer.on('pane:data', (_e: IpcRendererEvent, d: string) => cb(d))
    },
    /** 右の窓の幅（左端のドラッグ）。start・move・end と、つかんだ所から広げた px。reset は元の幅に戻す（ダブルクリック） */
    paneWidth: (phase: string, grow: number) => ipcRenderer.send('pane:width', { phase: String(phase), grow: Number(grow) || 0 }),
    // コピーと貼り付け（Windows・Linux のキーと右クリック。どうするかは shared/termKeys.ts が決める）
    // ★shared/termKeys を import する preload はここだけにする（2つで読むと別のファイルに切り出され、sandbox で読めずに止まる）
    clip: {
      action: (e: KeyLike, hasSelection: boolean) => termKeyAction(e, hasSelection, PLATFORM),
      rightClick: rightClickClipboard(PLATFORM),
      copy: (t: string) => ipcRenderer.send('clip:write', String(t)),
      paste: (): Promise<string> => ipcRenderer.invoke('clip:read')
    }
  })
} else {
  // 2本指の横スクロール（Mac のトラックパッドの「ページ間をスワイプ」）を、戻る・進むの合図にして main に送る。
  // 戻る・進むの判断は main（3本指のスワイプ・マウスの戻る/進むボタンと同じ所）
  let swipe: SwipeState = { sum: 0, last: -Infinity, fired: false }
  /** 払った向きに、まだ横スクロールできる場所の中か（表や図の中で端まで来ていない） */
  const canScrollX = (target: EventTarget | null, dx: number): boolean => {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue
      const ox = getComputedStyle(el).overflowX
      if (ox !== 'auto' && ox !== 'scroll' && el !== document.scrollingElement) continue
      if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
    }
    return false
  }
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.deltaX) return
      const r = swipeStep(swipe, e.deltaX, e.deltaY, e.timeStamp, canScrollX(e.target, e.deltaX))
      swipe = r.state
      if (r.dir) ipcRenderer.send('nav:swipe', r.dir)
    },
    { passive: true, capture: true }
  )

  // アプリとの約束（2.3.0 からの殻）。入力の窓はアプリが出し、指示文はクリップボードを通さず直接受け取る。
  // それより前の殻は、下のクリップボードの横取りで受け取る
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  contextBridge.exposeInMainWorld('rlaApp', {
    ask: (cfg: Partial<AskRequest>): Promise<string | null> => {
      const req: AskRequest = {
        kick: text(cfg?.kick),
        title: text(cfg?.title),
        sub: text(cfg?.sub),
        placeholder: text(cfg?.placeholder),
        chips: Array.isArray(cfg?.chips) ? cfg.chips.filter((c) => Array.isArray(c)).map((c) => [text(c[0]), text(c[1]), c[2] === true] as [string, string, boolean]) : [],
        value: text(cfg?.value)
      }
      return ipcRenderer.invoke('loops:ask', req)
    },
    send: (t: unknown): void => {
      const s = text(t)
      if (isInstruction(s)) ipcRenderer.send('loops:instruction', s)
    }
  })

  // スキルの画面のボタンは指示文をクリップボードに書くだけなので、その書き込みを受けてアプリに渡す。
  // 指示文でないコピー（💡 のコマンドなど）は、普通のコピーとして通す。
  contextBridge.exposeInMainWorld('__rlaInstruction', (text: unknown) => {
    const t = String(text)
    if (!isInstruction(t)) return false
    ipcRenderer.send('loops:instruction', t)
    return true
  })

  // 画面の中（main world）の関数を差し替える。rising.js は押したときに navigator.clipboard.writeText を呼び、
  // 使えない環境では textarea を選んで document.execCommand('copy') を呼ぶ
  contextBridge.executeInMainWorld({
    func: () => {
      const take = (window as unknown as { __rlaInstruction: (t: string) => boolean }).__rlaInstruction
      const clip = navigator.clipboard
      if (clip) {
        const write = clip.writeText.bind(clip)
        clip.writeText = (t: string) => (take(t) ? Promise.resolve() : write(t))
      }
      const exec = document.execCommand.bind(document)
      document.execCommand = (cmd: string, ...rest: unknown[]) => {
        if (String(cmd).toLowerCase() === 'copy') {
          const el = document.activeElement as HTMLTextAreaElement | null
          if (el && typeof el.value === 'string' && take(el.value)) return true
        }
        return exec(cmd, ...(rest as [boolean?, string?]))
      }
    }
  })
}
