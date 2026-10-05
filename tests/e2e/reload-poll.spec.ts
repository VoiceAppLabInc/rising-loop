import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inFrame, inLoops, later, launch, mainWindow, nextFolder, SAMPLE } from './helpers'

// OS の「ファイルが変わった」知らせが届かない場所（Windows から WSL の中 \\wsl.localhost\… を開いたとき）でも、
// 更新日時の見比べで画面を新しくする。テストでは fs.watch を止めて（RISING_LOOP_NO_FSWATCH=1）その場所を作る
let app: ElectronApplication
let win: Page
let root: string
let folder: string

function addMark(file: string, id: string): void {
  const p = join(folder, 'loops', file)
  writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', `<p id="${id}">新しい</p></body>`))
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-reload-poll-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
  app = await launch(root, { RISING_LOOP_NO_FSWATCH: '1' })
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('OS の知らせが来なくても、ループの頁が書き換わればその頁を読み込み直す（殻はそのまま）', async () => {
  await inLoops(app, folder, `window.__mark = '殻はそのまま'; document.querySelector('[data-go="s-L01"]').click()`)
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  addMark('L01.html', 'rla-mark')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.getElementById("rla-mark")'), { timeout: 10_000 }).toBe(true)
  expect((await inLoops(app, folder, 'window.__mark'))?.value).toBe('殻はそのまま')
})

test('OS の知らせが来なくても、殻（index.html・js）が書き換われば画面全体を読み込み直す', async () => {
  await inLoops(app, folder, `window.__mark = 1; 1`)
  addMark('index.html', 'rla-shell-mark')
  await expect.poll(async () => (await inLoops(app, folder, '!!document.getElementById("rla-shell-mark") && window.__mark === undefined'))?.value, { timeout: 10_000 }).toBe(true)
})

test('F5・Ctrl+R（Mac は ⌘R）で、自分で画面を読み込み直せる', async () => {
  const pressAndReloaded = async (input: { keyCode: string; modifiers?: ('meta' | 'control')[] }) => {
    await inLoops(app, folder, `window.__mark = 1; 1`)
    await app.evaluate(({ webContents }, { url, input }) => {
      const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!
      w.sendInputEvent({ type: 'keyDown', ...input })
      w.sendInputEvent({ type: 'keyUp', ...input })
    }, { url: 'file://' + encodeURI(join(folder, 'loops', 'index.html')), input })
    await expect.poll(async () => (await inLoops(app, folder, 'window.__mark === undefined && !!document.querySelector("button.upd[data-upd=all]")'))?.value, { timeout: 10_000 }).toBe(true)
  }
  await pressAndReloaded({ keyCode: 'F5' })
  await pressAndReloaded({ keyCode: 'R', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
})
