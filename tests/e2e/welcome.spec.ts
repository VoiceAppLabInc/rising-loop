import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { FAKE_AI, launch, mainWindow } from './helpers'

let app: ElectronApplication
let win: Page
let root: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-welcome-'))
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('プロジェクトが無ければ、AI を使えるようにする → フォルダを開く、の順に案内する（AI が使えれば 1 に印）', async () => {
  app = await launch(root)
  win = await mainWindow(app)
  await expect(win.getByRole('heading', { name: 'ライジング・ループへようこそ' })).toBeVisible()
  await expect(win.locator('.ai-row[data-ai="claude"]')).toContainText('使えます')
  await expect(win.locator('.welcome-steps > li').first()).toHaveClass(/done/)
  await expect(win.getByRole('button', { name: 'フォルダを開く…' })).toBeVisible()
})

test('ログインしていなければ、その場で［ログイン］から公式の手順を動かせる', async () => {
  app = await launch(root, { RLA_FAKE_LOGGED_OUT: '1' })
  win = await mainWindow(app)
  const claude = win.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('ログインしていません')
  await expect(win.locator('.welcome-steps > li').first()).not.toHaveClass(/done/)
  await claude.getByRole('button', { name: 'ログイン' }).click()
  await expect(win.locator('.tool-head')).toContainText('ログインしました', { timeout: 10_000 })
})

test('入口だけあって動かない（nodenv などで本体が無い）ときは「動きません」と［入れ直す］。入れたら、そのままログインへ進む', async () => {
  const flag = join(root, 'installed')
  app = await launch(root, { RLA_FAKE_INSTALLED_FLAG: flag, RLA_FAKE_LOGGED_OUT: '1', RISING_LOOP_APP_INSTALL_CMD: FAKE_AI })
  win = await mainWindow(app)
  const claude = win.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('入っていますが動きません')
  // 中身（command not found など）は見せない
  await expect(win.locator('.welcome')).not.toContainText('command not found')
  await claude.getByRole('button', { name: '入れ直す' }).click()
  await expect(win.locator('.tool-head')).toContainText('Claude Codeを入れています')
  // 入れ終わったら、押さなくてもログインが始まる
  await expect(win.locator('.tool-head')).toContainText('ログインしました', { timeout: 15_000 })
  expect(existsSync(flag)).toBe(true)
})

test('アプリが使う機能が無い古い版は「古い版です」と［入れ直す］', async () => {
  app = await launch(root, { RLA_FAKE_OLD: '1' })
  win = await mainWindow(app)
  const claude = win.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('古い版です')
  await expect(claude.getByRole('button', { name: '入れ直す' })).toBeVisible()
  await expect(win.locator('.welcome-steps > li').first()).not.toHaveClass(/done/)
})

test('ようこその画面では Claude Code だけを出し、Codex は「Codex を使う場合」の中にしまう', async () => {
  app = await launch(root, { RLA_FAKE_LOGGED_OUT: '1' })
  win = await mainWindow(app)
  await expect(win.locator('.ai-row[data-ai="claude"]')).toBeVisible()
  await expect(win.locator('.ai-row[data-ai="codex"]')).toBeHidden()
  await win.getByText('Codex を使う場合').click()
  await expect(win.locator('.ai-row[data-ai="codex"]')).toBeVisible()
})

test('確かめているあいだも Claude Code の行を出しておき、状態だけを「確かめています…」にする（高さが変わらない）', async () => {
  app = await launch(root, { RLA_FAKE_STATUS_DELAY_MS: '1500' })
  win = await mainWindow(app)
  const claude = win.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('確かめています…')
  const h1 = await claude.evaluate((el) => el.getBoundingClientRect().height)
  await expect(claude).toContainText('使えます', { timeout: 10_000 })
  const h2 = await claude.evaluate((el) => el.getBoundingClientRect().height)
  expect(h2).toBe(h1)
})
