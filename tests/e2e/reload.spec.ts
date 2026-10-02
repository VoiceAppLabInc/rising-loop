import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inFrame, inLoops, later, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

/** AI が書き換えたつもりで、loops/ のファイルの </body> の前に目印を足す */
function addMark(file: string, id: string): void {
  const p = join(folder, 'loops', file)
  writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', `<p id="${id}">新しい</p></body>`))
}

const fakeCount = async (screen: string) => ((await paneText(app, screen)) ?? '').split('FAKE-AI {').length - 1

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-reload-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
  await expect.poll(() => fakeCount('s-list')).toBe(1)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('ループの頁が書き換わると、その頁だけ読み込み直し、スクロールの位置とチャットはそのまま', async () => {
  await inLoops(app, folder, `window.__mark = '殻はそのまま'; document.querySelector('[data-go="s-L01"]').click()`)
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await expect.poll(() => fakeCount('s-L01')).toBe(1)
  await inFrame(app, '/L01.html', 'scrollTo(0, 300); 1')
  const before = (await inFrame(app, '/L01.html', 'scrollY')) as number
  expect(before).toBeGreaterThan(0)

  addMark('L01.html', 'rla-mark')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.getElementById("rla-mark")'), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => inFrame(app, '/L01.html', 'scrollY')).toBe(before)
  expect((await inLoops(app, folder, 'window.__mark'))?.value).toBe('殻はそのまま')
  expect(await fakeCount('s-L01')).toBe(1)
})

test('殻が書き換わると画面全体を読み込み直すが、チャットの AI は止めずに続きを出す', async () => {
  await inLoops(app, folder, `window.__mark = '前の殻'; 1`)
  addMark('index.html', 'rla-shell-mark')
  await expect.poll(async () => (await inLoops(app, folder, '!!document.getElementById("rla-shell-mark")'))?.value, { timeout: 10_000 }).toBe(true)
  expect((await inLoops(app, folder, 'window.__mark'))?.value).toBeUndefined()
  // 開き直された右の窓に、同じ AI の出力の続きが出る（AI は1つのまま）
  await expect.poll(() => fakeCount('s-list')).toBe(1)
  await inFrame(app, '&arg=s-list', `window.__rlaTerm.input('まだ動いている\\r', true); 1`)
  await expect.poll(async () => await paneText(app, 's-list')).toContain('受信: まだ動いている')
})

test('画面に関係しないファイルが変わっても、読み込み直さない', async () => {
  await inLoops(app, folder, `window.__mark = 'そのまま'; 1`)
  writeFileSync(join(folder, 'loops', 'README.md'), '# 数字の取り方\n')
  writeFileSync(join(folder, 'loops', '.chat-sessions'), 's-list claude x\n')
  await win.waitForTimeout(2500)
  expect((await inLoops(app, folder, 'window.__mark'))?.value).toBe('そのまま')
})
