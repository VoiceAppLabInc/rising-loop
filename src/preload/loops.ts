// ループの画面（スキルの HTML）と、その中の右の窓に差し込む。画面のファイルは書き換えない。
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { PANE_PORT, isInstruction } from '@shared/intercept'

if (location.protocol === 'http:' && location.port === PANE_PORT) {
  // 右の窓（アプリが localhost:7681 として出すページ）。ターミナルの入出力を main とやり取りする
  contextBridge.exposeInMainWorld('rlaPane', {
    attach: (screen: string, cols: number, rows: number) => ipcRenderer.send('pane:attach', { screen, cols, rows }),
    input: (screen: string, data: string) => ipcRenderer.send('pane:input', { screen, data }),
    resize: (screen: string, cols: number, rows: number) => ipcRenderer.send('pane:resize', { screen, cols, rows }),
    onData: (cb: (d: string) => void) => {
      ipcRenderer.on('pane:data', (_e: IpcRendererEvent, d: string) => cb(d))
    }
  })
} else {
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
