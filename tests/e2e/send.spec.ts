import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { SAMPLE, inFrame, inLoops, launch, nextFolder, paneText } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

const received = (screen: string) => async () => ((await paneText(app, screen)) ?? '').split('\n').filter((l) => l.startsWith('受信: '))

async function start(extraEnv: Record<string, string> = {}): Promise<void> {
  app = await launch(root, extraEnv)
  win = await app.firstWindow()
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
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
