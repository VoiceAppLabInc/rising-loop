import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { CURRENT, cardPage, inLoops, launch, mainWindow, nextFolder } from './helpers'
import { FEEDBACK_ENTRY, FEEDBACK_FORM } from '../../src/shared/feedback'

// お問い合わせ・フィードバック：設定の［フィードバックを送る］と、AI が書いた loops/.feedback/*.md から、
// 答えを入れた Google フォームをいつものブラウザで開く（送るかどうかはフォームで使う人が決める）
let app: ElectronApplication
let win: Page
let root: string
let folder: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-feedback-'))
  folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  win = await mainWindow(app)
  // いつものブラウザで開く代わりに、開こうとした URL をためる
  await app.evaluate(({ shell }) => {
    ;(globalThis as { opened?: string[] }).opened = []
    shell.openExternal = (async (url: string) => void (globalThis as { opened?: string[] }).opened!.push(url)) as typeof shell.openExternal
  })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])
const field = (u: string, k: keyof typeof FEEDBACK_ENTRY) => new URL(u).searchParams.get(`entry.${FEEDBACK_ENTRY[k]}`)

test('設定の［フィードバックを送る］を押すと、環境（版・OS・AI）を入れたお問い合わせのフォームを開く', async () => {
  // タブの列には出さない（設定のダイアログに置く）
  await expect(win.getByRole('button', { name: 'フィードバック' })).toHaveCount(0)
  await win.getByRole('button', { name: '設定' }).click()
  const layer = await cardPage(app)
  await layer.getByRole('dialog', { name: '設定' }).getByRole('button', { name: 'フィードバックを送る' }).click()
  await expect.poll(async () => (await opened()).length).toBe(1)
  const [u] = await opened()
  expect(u.startsWith(FEEDBACK_FORM + '?')).toBe(true)
  expect(field(u, 'env')).toMatch(new RegExp(`^アプリ v[\\d.]+ / スキル v${CURRENT.replace(/\./g, '\\.')} / ${process.platform}-${process.arch} / AI: claude / WSL: いいえ$`))
  expect(field(u, 'kind')).toBe('Rising Loopへのフィードバック')
})

test('設定の［利用規約］は LP の規約のページを、［ほかのソフトのライセンス］はアプリの中のライセンス表示を開く', async () => {
  await app.evaluate(({ shell }) => {
    shell.openPath = (async (p: string) => {
      ;(globalThis as { opened?: string[] }).opened!.push(p)
      return ''
    }) as typeof shell.openPath
  })
  await win.getByRole('button', { name: '設定' }).click()
  const dialog = (await cardPage(app)).getByRole('dialog', { name: '設定' })
  await dialog.getByRole('button', { name: '利用規約' }).click()
  await dialog.getByRole('button', { name: 'ほかのソフトのライセンス' }).click()
  await expect.poll(async () => (await opened()).length).toBe(2)
  const [terms, notices] = await opened()
  expect(terms).toBe('https://rising-loop.web.app/terms.html')
  expect(notices).toMatch(/resources[\\/]notices[\\/]THIRD_PARTY_NOTICES\.txt$/)
  expect(existsSync(notices)).toBe(true)
})

test('AI が loops/.feedback/ に書いた報告を拾って、種類と内容を入れたフォームを1回だけ開き、ファイルは消す', async () => {
  const dir = join(folder, 'loops', '.feedback')
  mkdirSync(dir, { recursive: true })
  const f = join(dir, '261007-1530.md')
  writeFileSync(f, '種類: Rising Loopを商用で使いたい／相談したい\n---\n何が起きたか：「ボタンが小さい」\nどうなってほしいか：大きく\n')
  // 書き終わってから少したったことにする（書きかけは拾わない）
  const past = new Date(Date.now() - 5000)
  utimesSync(f, past, past)
  await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(1)
  const [u] = await opened()
  expect(field(u, 'kind')).toBe('Rising Loopを商用で使いたい／相談したい')
  expect(field(u, 'body')).toBe('何が起きたか：「ボタンが小さい」\nどうなってほしいか：大きく')
  expect(field(u, 'env')).toMatch(/^アプリ v/)
  expect(existsSync(f)).toBe(false)
  // もう一度見比べても、開き直さない
  await new Promise((r) => setTimeout(r, 2500))
  expect((await opened()).length).toBe(1)
})
