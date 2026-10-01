import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

export const SAMPLE = resolve('tests/fixtures/sample-project')
export const FAKE_AI = resolve('tests/fixtures/fake-ai.mjs')

/** アプリを起動する。AI は本物の代わりにテスト用のスクリプトを使い、データ置き場と claude の設定は一時フォルダにする */
export function launch(root: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      // ウィンドウを出さず Dock にも出さない（操作中の画面を奪わない）
      RISING_LOOP_APP_HIDDEN: '1',
      RISING_LOOP_APP_DATA_DIR: join(root, 'data'),
      RISING_LOOP_APP_CLAUDE_PATH: FAKE_AI,
      RISING_LOOP_APP_CODEX_PATH: FAKE_AI,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      ...extraEnv
    }
  })
}

/** OS のフォルダ選択の代わりに、決まったフォルダを返す */
export const nextFolder = (app: ElectronApplication, folder: string) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog
  }, folder)

/** ループの画面（WebContentsView）の中で JavaScript を動かす。まだ開いていなければ null（expect.poll は投げると待たないため） */
export const inLoops = (app: ElectronApplication, folder: string, code: string) =>
  app.evaluate(
    async ({ webContents }, { url, code }) => {
      const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))
      if (!w) return null
      return { id: w.id, value: await w.executeJavaScript(code) }
    },
    { url: 'file://' + encodeURI(join(folder, 'loops', 'index.html')), code }
  )

/** 殻の中の iframe（ループの頁・右の窓）で JavaScript を動かす。まだ開いていなければ null */
export const inFrame = (app: ElectronApplication, match: string, code: string) =>
  app.evaluate(
    async ({ webContents }, { match, code }) => {
      for (const w of webContents.getAllWebContents()) {
        const f = w.mainFrame.framesInSubtree.find((x) => x.url.includes(match))
        if (f) return f.executeJavaScript(code)
      }
      return null
    },
    { match, code }
  )

/** 右の窓のターミナルの文字。折り返した行はつなげる */
export const paneText = (app: ElectronApplication, screen: string): Promise<string | null> =>
  inFrame(
    app,
    '&arg=' + screen,
    `(function(){
      var t = window.__rlaTerm; if (!t) return null
      var b = t.buffer.active, out = ''
      for (var i = 0; i < b.length; i++) { var l = b.getLine(i); if (!l) continue; out += (l.isWrapped ? '' : '\\n') + l.translateToString(true) }
      return out
    })()`
  ) as Promise<string | null>
