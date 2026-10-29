import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, CURRENT, inLoops, launch, mainWindow, nextFolder, paneText } from './helpers'

// 全ループの自動更新：設定で、する・間隔・時刻を決める。アプリが開いているあいだ、時刻を過ぎていて、まだ送っていなければ、
// 一覧のチャットに［全ループ更新］と同じ指示文を送る
let app: ElectronApplication
let win: Page
let root: string
let folder: string

const projectsJson = () => JSON.parse(readFileSync(join(root, 'data', 'projects.json'), 'utf8'))
/** タブの列の札の層に、いま出ている文字（出ていなければ null） */
const tipShown = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents?.getURL().startsWith('data:text/html')) as
      | Electron.WebContentsView
      | undefined
    if (!v || !v.getVisible()) return null
    return (await v.webContents.executeJavaScript('document.getElementById("t").textContent')) as string
  })
const tipBounds = () =>
  app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents?.getURL().startsWith('data:text/html'))
    return v ? v.getBounds() : null
  })
const received = async () => ((await paneText(app, 's-list')) ?? '').split('\n').filter((l) => l.startsWith('受信: '))

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-auto-'))
  folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('設定で、する・間隔・時刻を決めて［OK］で覚える。「確認する」のままなら、途中で止まることを書き添える', async () => {
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await win.getByRole('button', { name: '設定' }).click()
  const dialog = (await cardPage(app)).getByRole('dialog', { name: '設定' })
  const on = dialog.getByRole('checkbox', { name: 'する' })
  const note = dialog.getByText('「コマンド実行の確認」が「確認する」のままだと')
  // はじめは、しない。間隔と時刻は選べない
  await expect(on).not.toBeChecked()
  await expect(dialog.getByRole('combobox', { name: '間隔' })).toBeDisabled()
  await expect(note).toHaveCount(0)
  await expect(win.getByRole('tab', { name: 'proj' }).locator('svg')).toHaveCount(0)
  await on.check()
  await expect(note).toBeVisible()
  await dialog.getByRole('combobox', { name: '間隔' }).selectOption({ label: '2日ごと' })
  await dialog.getByLabel('時刻').fill('07:30')
  // 「すべて自動で許可」にすると、書き添えは消える
  await dialog.getByRole('radio', { name: 'すべて自動で許可' }).check()
  await expect(note).toHaveCount(0)
  await dialog.getByRole('button', { name: 'OK' }).click()
  // はじめはタブに時計が無い。するにしたら、名前の右に時計を出し、札に間隔と時刻を出す
  const tab = win.getByRole('tab', { name: 'proj' })
  await expect(tab.locator('svg')).toHaveCount(1)
  // 時計に乗せたら、間隔と時刻の札がすぐ出る（ブラウザ標準の札ではなく、アプリの札の層）。タブの名前に乗せても出さない。離れたら消える
  await tab.hover()
  await expect.poll(tipShown, { timeout: 1000 }).toBeNull()
  await tab.locator('svg').hover()
  await expect.poll(tipShown, { timeout: 1000 }).toBe('全ループの自動更新：2日ごと 7:30')
  // 1文字ずつ折り返さず、1行のまま出す（2026-10-29 に、層の幅 0 に合わせて縦に細長く出た）
  expect((await tipBounds())!.height).toBeLessThan(60)
  await win.getByRole('button', { name: '設定' }).hover()
  await expect.poll(tipShown, { timeout: 1000 }).toBeNull()
  await expect.poll(() => projectsJson().projects[0].autoUpdate).toMatchObject({ on: true, every: 2, at: '07:30' })
  expect(Date.parse(projectsJson().projects[0].autoUpdate.since)).toBeGreaterThan(Date.now() - 60_000)
})

test('送る時刻を過ぎていれば（スリープや閉じていて逃していても）、開いたときに一覧のチャットへ1回だけ送り、送った日時を覚える', async () => {
  // 3日前にするにして、まだ一度も送っていない
  mkdirSync(join(root, 'data'), { recursive: true })
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
  writeFileSync(
    join(root, 'data', 'projects.json'),
    JSON.stringify({ projects: [{ id: 'p1', name: 'proj', folder, addedAt: since, autoUpdate: { on: true, every: 1, at: '00:00', since } }], currentId: 'p1' })
  )
  app = await launch(root)
  win = await mainWindow(app)
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  const [line] = await received()
  expect(line).toContain('loop: all⏎section: ALL')
  expect(line).toContain('loops/ の全ループを更新して⏎  （設定の「全ループの自動更新」で送りました）')
  expect(Date.parse(projectsJson().projects[0].autoUpdate.last)).toBeGreaterThan(Date.now() - 60_000)
  // 送ったら、次は翌日の時刻。もう一度確かめても（スリープから起きたときと同じ）送らない
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  await new Promise((r) => setTimeout(r, 2000))
  expect(await received()).toHaveLength(1)
})
