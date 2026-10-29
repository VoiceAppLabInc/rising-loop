import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { CURRENT, cardPage, inLoops, launch, mainWindow, nextFolder } from './helpers'
import { FEEDBACK_ENTRY, FEEDBACK_FORM, FEEDBACK_URL_MAX } from '../../src/shared/feedback'

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
  // いつものブラウザで開く代わりに、開こうとした URL・ファイルをためる
  await app.evaluate(({ shell }) => {
    ;(globalThis as { opened?: string[] }).opened = []
    shell.openExternal = (async (url: string) => void (globalThis as { opened?: string[] }).opened!.push(url)) as typeof shell.openExternal
    shell.openPath = (async (p: string) => {
      ;(globalThis as { opened?: string[] }).opened!.push(p)
      return ''
    }) as typeof shell.openPath
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
/** フォームは、長い URL へ移るだけの PC の中のページ（.html）を経由して開く。そのページが移る先の URL */
const formUrl = (page: string) => {
  expect(page).toMatch(/rising-loop-feedback-\d+\.html$/)
  const m = /location\.replace\((".*?")\)/.exec(readFileSync(page, 'utf8'))
  return JSON.parse(m![1]) as string
}
const field = (u: string, k: keyof typeof FEEDBACK_ENTRY) => new URL(u).searchParams.get(`entry.${FEEDBACK_ENTRY[k]}`)

test('設定の［フィードバックを送る］を押すと、環境（版・OS・AI）を入れたお問い合わせのフォームを開く', async () => {
  // タブの列には出さない（設定のダイアログに置く）
  await expect(win.getByRole('button', { name: 'フィードバック' })).toHaveCount(0)
  await win.getByRole('button', { name: '設定' }).click()
  const layer = await cardPage(app)
  await layer.getByRole('dialog', { name: '設定' }).getByRole('button', { name: 'フィードバックを送る' }).click()
  await expect.poll(async () => (await opened()).length).toBe(1)
  const u = formUrl((await opened())[0])
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
  const u = formUrl((await opened())[0])
  expect(field(u, 'kind')).toBe('Rising Loopを商用で使いたい／相談したい')
  expect(field(u, 'body')).toBe('何が起きたか：「ボタンが小さい」\nどうなってほしいか：大きく')
  expect(field(u, 'env')).toMatch(/^アプリ v/)
  expect(existsSync(f)).toBe(false)
  // もう一度見比べても、開き直さない
  await new Promise((r) => setTimeout(r, 2500))
  expect((await opened()).length).toBe(1)
})

/** AI の報告を loops/.feedback/ に置き、書き終わってから少したったことにする */
const putReport = (text: string) => {
  const dir = join(folder, 'loops', '.feedback')
  mkdirSync(dir, { recursive: true })
  const f = join(dir, '261028-0130.md')
  writeFileSync(f, text)
  const past = new Date(Date.now() - 5000)
  utimesSync(f, past, past)
}

test('長い報告（日本語とパスまじりで約 1000 字）も、切らずに全部フォームに入れる', async () => {
  // 2026-10-28 に Windows から届いた報告は、URL を直接渡していたため 170 字ほどで切れた。同じくらいの長さで確かめる
  const body = ('何が起きたか：「一つ前の話のチャット履歴が引き継がれない」。C:\\Users\\someone\\.claude\\projects\\--wsl-localhost-Ubuntu-24-04-home-someone-projects-app\\2955c68d-25f4-4f33-a383-fa6ff2873a73.jsonl に残っています。\n').repeat(6).trim()
  putReport(`種類: Rising Loopへのフィードバック\n---\n${body}\n`)
  await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(1)
  const u = formUrl((await opened())[0])
  expect(u.length).toBeGreaterThan(FEEDBACK_URL_MAX)
  expect(field(u, 'body')).toBe(body)
})

test('PC の中のページを開けないときは、短い URL をいつものブラウザに直接渡す', async () => {
  await app.evaluate(({ shell }) => {
    shell.openPath = (async () => 'No application is associated') as typeof shell.openPath
  })
  putReport('種類: その他\n---\nボタンを大きく\n')
  await expect.poll(async () => (await opened()).length, { timeout: 10_000 }).toBe(1)
  const [u] = await opened()
  expect(u.startsWith(FEEDBACK_FORM + '?')).toBe(true)
  expect(field(u, 'body')).toBe('ボタンを大きく')
})
