import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, mainWindow } from './helpers'

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
  await expect(win.locator('.tool-head')).toContainText('（終わりました）', { timeout: 10_000 })
})
