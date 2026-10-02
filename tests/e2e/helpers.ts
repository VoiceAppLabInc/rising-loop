import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export const SAMPLE = resolve('tests/fixtures/sample-project')
export const FAKE_AI = resolve('tests/fixtures/fake-ai.mjs')
/** 同梱のスキルのいまの版 */
export const CURRENT = readFileSync(resolve('skill/skills/rising-loop/VERSION'), 'utf8').trim()

/** アプリを起動する。AI は本物の代わりにテスト用のスクリプトを使い、データ置き場と claude の設定は一時フォルダにする */
export function launch(root: string, extraEnv: Record<string, string> = {}, o: { firstRun?: boolean } = {}): Promise<ElectronApplication> {
  // 使い方は、いまの版の殻を初めて開いたときに自動で開く。その動きを見るテスト（firstRun）以外は、見たことにしておく
  if (!o.firstRun) {
    const app = join(root, 'data', 'app.json')
    if (!existsSync(app)) {
      mkdirSync(join(root, 'data'), { recursive: true })
      writeFileSync(app, JSON.stringify({ howtoSeen: true }))
    }
  }
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      // ウィンドウを出さず Dock にも出さない（操作中の画面を奪わない）
      RISING_LOOP_APP_HIDDEN: '1',
      // ログインシェルの環境変数は読まない（テスト用の AI は絶対パスで呼ぶ）
      RISING_LOOP_APP_SKIP_SHELL_ENV: '1',
      RISING_LOOP_APP_DATA_DIR: join(root, 'data'),
      RISING_LOOP_APP_CLAUDE_PATH: FAKE_AI,
      RISING_LOOP_APP_CODEX_PATH: FAKE_AI,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      // ほかの場所の rising-loop を探すホームと、ゴミ箱の代わり（本物のホームとゴミ箱には触れない）
      RISING_LOOP_APP_HOME: join(root, 'home'),
      RISING_LOOP_APP_TRASH_DIR: join(root, 'trash'),
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

/**
 * 古い形のプロジェクトを開くと出る知らせに「あとで」と答える。
 * 見本の loops/（スキル 1.7.6 の写し）は古い形なので、知らせとは関係の無いテストではこれで閉じる
 */
export async function later(win: Page): Promise<void> {
  const d = win.getByRole('dialog')
  await d.waitFor({ timeout: 5000 })
  await d.getByRole('button', { name: 'あとで' }).click()
  await d.waitFor({ state: 'hidden' })
}

/** ループの画面の上に重ねたカードの層（透明な層。アプリの画面とは別のページ） */
export async function cardPage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const p = app.windows().find((w) => w.url().includes('overlay=bar'))
    if (p) return p
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('カードの層が見つからない')
}
