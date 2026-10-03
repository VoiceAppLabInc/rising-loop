import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, launch, mainWindow } from './helpers'

let app: ElectronApplication
let win: Page
let root: string

/** Releases の最新の見本を置いて、その file:// を見に行かせる */
function releaseOf(version: string): string {
  const file = join(root, 'latest.json')
  const asset = (name: string) => ({ name: `Rising-Loop-${version}-${name}`, browser_download_url: `https://example.com/${name}` })
  writeFileSync(
    file,
    JSON.stringify({
      tag_name: 'v' + version,
      body: '- 新しい版の説明',
      html_url: 'https://example.com/release',
      draft: false,
      prerelease: false,
      assets: [asset('mac-arm64.dmg'), asset('mac-x64.dmg'), asset('win-x64.exe')]
    })
  )
  return pathToFileURL(file).href
}

async function start(version: string): Promise<void> {
  app = await launch(root, { RISING_LOOP_APP_UPDATE_URL: releaseOf(version) })
  win = await mainWindow(app)
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-update-'))
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('新しい版があれば、起動したときに1回だけお知らせを出し、あとはタブの列から開ける', async () => {
  await start('99.0.0')
  const layer = await cardPage(app)
  const dlg = layer.getByRole('dialog', { name: '新しい版 v99.0.0 があります' })
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('- 新しい版の説明')
  await dlg.getByRole('button', { name: 'あとで' }).click()
  await expect(dlg).toBeHidden()

  // タブの列のボタンから開き直せる
  await win.getByRole('button', { name: '新しい版' }).click()
  await expect(dlg).toBeVisible()

  // 開発版（配ったアプリでない）では入れ替えられないので、［アップデート］（Windows は［ダウンロード］）は、この OS・CPU 向けのファイルをいつものブラウザで開く
  await app.evaluate(({ shell }) => {
    ;(globalThis as { opened?: string[] }).opened = []
    shell.openExternal = (async (url: string) => void (globalThis as { opened?: string[] }).opened!.push(url)) as typeof shell.openExternal
  })
  await dlg.getByRole('button', { name: process.platform === 'darwin' ? 'アップデート' : 'ダウンロード' }).click()
  await expect(dlg).toBeHidden()
  const want = process.platform === 'darwin' ? `https://example.com/mac-${process.arch}.dmg` : process.platform === 'win32' ? 'https://example.com/win-x64.exe' : 'https://example.com/release'
  await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([want])

  // 同じ版については、次に起動しても自動では出さない（ボタンは出たまま）
  await app.close()
  await start('99.0.0')
  await expect(win.getByRole('button', { name: '新しい版' })).toBeVisible()
  await expect((await cardPage(app)).getByRole('dialog')).toHaveCount(0)
})

test('いまの版より新しくなければ、何も出さない', async () => {
  await start('0.0.1')
  await expect(win.getByRole('button', { name: 'プロジェクトを追加' })).toBeVisible()
  // 見に行き終わるのを待ってから確かめる
  await win.waitForTimeout(1000)
  await expect(win.getByRole('button', { name: '新しい版' })).toHaveCount(0)
  await expect((await cardPage(app)).getByRole('dialog')).toHaveCount(0)
})

test('設定の［新しい版を確かめる］：最新なら「最新です」、新しい版が出ていれば設定を閉じてお知らせを開く', async () => {
  await start('0.0.1')
  await win.getByRole('button', { name: '設定' }).click()
  const layer = await cardPage(app)
  const settings = layer.getByRole('dialog', { name: '設定' })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '新しい版を確かめる' }).click()
  await expect(settings.locator('.app-version-row')).toContainText('最新です')

  // そのあと新しい版が出た
  releaseOf('99.0.0')
  await settings.getByRole('button', { name: '新しい版を確かめる' }).click()
  await expect(layer.getByRole('dialog', { name: '新しい版 v99.0.0 があります' })).toBeVisible()
  await expect(settings).toHaveCount(0)
  await expect(win.getByRole('button', { name: '新しい版' })).toBeVisible()
})
