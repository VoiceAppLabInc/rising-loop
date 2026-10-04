import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, CURRENT, dialogOf, inFrame, inLoops, later, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

const received = (screen: string) => async () => ((await paneText(app, screen)) ?? '').split('\n').filter((l) => l.startsWith('受信: '))

async function start(extraEnv: Record<string, string> = {}): Promise<void> {
  app = await launch(root, extraEnv)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-send-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('一覧のボタンを押すと、指示文が一覧のチャットに1回で届き、Enter まで押される', async () => {
  await start()
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list')).toHaveLength(1)
  const [line] = await received('s-list')()
  // 複数行の指示文が、途中の改行で切れずに1回で届く
  expect(line).toBe('受信: ---⏎loop: all⏎section: ALL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  loops/ の全ループを更新して⏎---')
})

test('ループの画面で押すと、そのループのチャットに届く', async () => {
  await start()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await expect.poll(async () => await paneText(app, 's-L01')).toContain('FAKE-AI {')
  await inFrame(app, '/L01.html', 'document.querySelector("button.upd[data-upd=L01]").click()')
  await expect.poll(received('s-L01')).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: GOAL')
  expect(await received('s-list')()).toHaveLength(0)
})

test('AI の画面が出る前に押しても、出終わってから届く', async () => {
  await start({ RLA_FAKE_DELAY_MS: '2500' })
  // まだ AI の画面が出ていない
  expect((await paneText(app, 's-list')) ?? '').not.toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-list')())[0]).toContain('loops/ の全ループを更新して')
})

test('続けて2回押すと、2回とも順に届く', async () => {
  await start()
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(2)
})

/** いまの版の見本で始める（2.3.0 からの殻は、入力の窓をアプリに頼み、指示文を直接渡す）。殻のクリップボードへの書き込みを数える */
async function startCurrent(): Promise<void> {
  rmSync(folder, { recursive: true, force: true })
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.cmt")'))?.value).toBe(true)
  await inLoops(app, folder, 'window.__clip = 0; var w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = function (t) { window.__clip++; return w(t) }; 1')
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
}
const clipWrites = async () => (await inLoops(app, folder, 'window.__clip'))?.value

test('コメントを押すとアプリの入力の窓が出て、［送る］で指示文がチャットに届く（クリップボードは使わない）', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  const d = (await dialogOf(app))
  await expect(d).toContainText('COMMENT')
  await expect(d.getByRole('heading')).toHaveText('ループ一覧について')
  await expect(d.locator('.ask-chips')).toHaveCount(0)
  await d.getByRole('textbox').fill('もっと見やすくして')
  await d.getByRole('button', { name: '送る' }).click()
  await expect(d).toHaveCount(0)
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-list')())[0]).toBe('受信: ---⏎loop: ⏎section: LOOPS⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎feedback: |⏎  もっと見やすくして⏎---')
  expect(await clipWrites()).toBe(0)
})

test('施策案の［指示する］では説明と札を出し、札は入力欄に入るだけで送らない', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.do")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.do").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('heading')).toHaveText('施策案 1について')
  await expect(d).toContainText('課金モーダルで、1枚で有料5本すべてが24時間遊べることを見せる')
  // いちばん勧める札［施策を実行する］は目立たせる
  await expect(d.getByRole('button', { name: '施策を実行する' })).toHaveClass(/btn-primary/)
  await expect(d.getByRole('button', { name: 'これは消して' })).not.toHaveClass(/btn-primary/)
  await d.getByRole('button', { name: '施策を実行する' }).click()
  await expect(d.getByRole('textbox')).toHaveValue('この施策を実行して（TRIAL に移して手順を出す。実装はまだしない）')
  await win.waitForTimeout(500)
  expect(await received('s-L01')()).toHaveLength(0)
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-L01'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: BOTTLENECK⏎target: 課金モーダルで')
})

test('TRIAL にいる施策の［指示する］は「TRIAL に移して」と書かず、［完了にして（評価に移す）］を目立たせる', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.ins")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.ins").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('heading')).toHaveText('施策について')
  await expect(d.getByRole('textbox')).toHaveAttribute('placeholder', /完了にして（評価に移す）/)
  await expect(d.getByRole('textbox')).not.toHaveAttribute('placeholder', /TRIAL に移して/)
  await expect(d.getByRole('button', { name: '完了にして（評価に移す）' })).toHaveClass(/btn-primary/)
})

test('入力の窓は、空のままでは送れず、Esc・［キャンセル］で閉じると何も送らない', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('button', { name: '送る' })).toBeDisabled()
  await (await cardPage(app)).keyboard.press('Escape')
  await expect(d).toHaveCount(0)
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  await d.getByRole('textbox').fill('送らない')
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await expect(d).toHaveCount(0)
  await win.waitForTimeout(800)
  expect(await received('s-list')()).toHaveLength(0)
})

test('［全ループ更新］［更新］は1回押しただけでは送らず、更新の文を入れた入力の窓を開き、［送る］で送る', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  const d = await dialogOf(app)
  await expect(d.getByRole('heading')).toHaveText('全ループを更新')
  await expect(d.getByRole('textbox')).toHaveValue('loops/ の全ループを更新して')
  await win.waitForTimeout(800)
  expect(await received('s-list')()).toHaveLength(0)
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  // 届く指示文の形は、1回で送っていた頃と同じ
  expect((await received('s-list')())[0]).toBe('受信: ---⏎loop: all⏎section: ALL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  loops/ の全ループを更新して⏎---')

  // ループの頁の［更新］も同じ。書き足した分も届く
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await expect.poll(async () => await paneText(app, 's-L01')).toContain('FAKE-AI {')
  await inFrame(app, '/L01.html', 'document.querySelector("button.upd[data-upd=L01]").click()')
  await expect(d.getByRole('heading')).toHaveText('このループを更新')
  await expect(d.getByRole('textbox')).toHaveValue('このループを更新して')
  await (await cardPage(app)).keyboard.type('。売上だけでいい')
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-L01'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: GOAL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  このループを更新して。売上だけでいい⏎---')
})
