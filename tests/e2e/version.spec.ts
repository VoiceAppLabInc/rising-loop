import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, nextFolder } from './helpers'

let app: ElectronApplication
let win: Page
let root: string

/** 版ごとの見本（tests/fixtures/versions/<版>/）を一時フォルダに写してプロジェクトにする */
async function open(ver: string): Promise<string> {
  const folder = join(root, 'proj-' + ver)
  cpSync(resolve('tests/fixtures/versions', ver), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: /フォルダを開く…|プロジェクトを追加/ }).first().click()
  return folder
}

/** 重ねているループの画面が見えているか、どこに置かれているか */
const loopsView = () =>
  app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL().includes('/loops/index.html')) as Electron.WebContentsView | undefined
    return v ? { visible: v.getVisible(), y: v.getBounds().y } : null
  })

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-version-'))
  app = await launch(root)
  win = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('古い形のプロジェクトを開くと最初にダイアログで知らせ、あとでを押すと帯が残る', async () => {
  await open('1.7.5')
  const dialog = win.getByRole('dialog')
  await expect(dialog).toContainText('画面が前の版の形です')
  await expect(dialog).toContainText('1.5〜1.7 の形')
  await expect(dialog).toContainText('いまの版は 2.0.0')
  // 古い形のままだと AI の作業が崩れうることを伝え、「使い続けられる」とは言わない
  await expect(dialog).toContainText('古い形のままだと、AI の作業（更新・指示など）がうまく動かず、画面や数字が崩れることがあります。')
  await expect(dialog).not.toContainText('使い続けられ')
  // ダイアログのあいだは、重ねた画面を隠す
  await expect.poll(async () => (await loopsView())?.visible).toBe(false)

  await dialog.getByRole('button', { name: 'あとで' }).click()
  await expect(dialog).toBeHidden()
  await expect(win.getByRole('status')).toContainText('この画面は前の版の形です（1.5〜1.7 の形）。AI の作業がうまく動かないことがあります。')
  // 帯の分だけ下げて、画面を出す
  await expect.poll(async () => await loopsView()).toEqual({ visible: true, y: 40 + 36 })
})

test('一度知らせた形は、開き直しても知らせず、帯だけ出す', async () => {
  await open('1.6.1')
  await win.getByRole('dialog').getByRole('button', { name: 'あとで' }).click()
  await app.close()
  app = await launch(root)
  win = await app.firstWindow()
  await expect(win.getByRole('status')).toContainText('1.6.1')
  await win.waitForTimeout(1000)
  await expect(win.getByRole('dialog')).toHaveCount(0)
})

test('いまの形のプロジェクトには、知らせも帯も出さない', async () => {
  await open('2.0.0')
  await expect.poll(async () => await loopsView()).toEqual({ visible: true, y: 40 })
  await expect(win.getByRole('dialog')).toHaveCount(0)
  await expect(win.getByRole('status')).toHaveCount(0)
})

test('版の表示がある古い形は、その版で知らせる', async () => {
  await open('1.4.0')
  await expect(win.getByRole('dialog')).toContainText('「proj-1.4.0」の画面は 1.4.0 です')
})

test('［新しい形にする］は、中身ができるまで押せない', async () => {
  await open('1.7.5')
  await expect(win.getByRole('dialog').getByRole('button', { name: '新しい形にする' })).toBeDisabled()
})
