import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { dialogOf, inLoops, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

// 見本の loops/（スキル 1.7.6 の写し）を、同梱のスキルの「合わせて」（shell-update.py）で新しい形にしても、
// アプリとのつながり（右の窓・指示文の送信）が切れないことを確かめる
const SHELL_UPDATE = resolve('skill/skills/rising-loop/assets/shell-update.py')

let app: ElectronApplication
let win: Page
let root: string
let folder: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-migrate-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
  execFileSync('python3', [SHELL_UPDATE, join(folder, 'loops')], { stdio: 'pipe' })
  app = await launch(root)
  win = await mainWindow(app)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('合わせたあとの画面には ttyd の説明・アップデート・コピーの知らせが無い', () => {
  const html = readFileSync(join(folder, 'loops', 'index.html'), 'utf8')
  expect(html).not.toContain('15秒たっても')
  expect(html).not.toContain('cc-help')
  expect(html).not.toContain('COPIED')
  expect(html).not.toContain('upd-btn')
  // 既存の loops/chat-pane.sh は消さない（見本には無いので、新しく置かれないことだけ見る）
  expect(existsSync(join(folder, 'loops', 'chat-pane.sh'))).toBe(false)
})

test('合わせたあとも、右の窓にチャットが出て、ボタンの指示文が届く', async () => {
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  // 2.3.3 からの殻は、更新の文を入れた入力の窓を開き、［送る］で送る
  await (await dialogOf(app)).getByRole('button', { name: '送る' }).click()
  await expect.poll(async () => await paneText(app, 's-list')).toContain('受信: ---⏎loop: all⏎')
})
