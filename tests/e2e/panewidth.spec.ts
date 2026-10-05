import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { CURRENT, inLoops, launch, mainWindow, nextFolder } from './helpers'

// 右のチャットの窓は、左端（#grip）をドラッグして幅を変えられる。決めた幅は覚え、ダブルクリックで元の幅（360px）に戻る
let app: ElectronApplication
let root: string
let folder: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-panew-'))
  folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

async function open(first: boolean): Promise<void> {
  app = await launch(root)
  const win = await mainWindow(app)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 800))
  if (first) {
    await nextFolder(app, folder)
    await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  }
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await expect.poll(async () => (await widths()).chat).toBeGreaterThan(0)
}

/** [右のチャットの窓の幅, ループの画面の幅] */
const widths = () =>
  app.evaluate(({ BrowserWindow }) => {
    const out = { chat: 0, loops: 0 }
    for (const c of BrowserWindow.getAllWindows()[0].contentView.children) {
      if (!('webContents' in c)) continue
      const url = (c as { webContents: Electron.WebContents }).webContents.getURL()
      if (url.includes('/_rla/chat.html')) out.chat = c.getBounds().width
      if (url.includes('/loops/index.html')) out.loops = c.getBounds().width
    }
    return out
  })

/** 窓の左端をつかんで dx だけ動かす（左へ動かすと広がる） */
const drag = (dx: number) =>
  app.evaluate(async ({ webContents }, dx) => {
    const w = webContents.getAllWebContents().find((c) => c.getURL().includes('/_rla/chat.html'))!
    await w.executeJavaScript(`(function(){
      var g = document.getElementById('grip'), o = { bubbles: true, pointerId: 1, button: 0 }
      g.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ screenX: 1000 }, o)))
      g.dispatchEvent(new PointerEvent('pointermove', Object.assign({ screenX: ${1000 + dx / 2} }, o)))
      g.dispatchEvent(new PointerEvent('pointermove', Object.assign({ screenX: ${1000 + dx} }, o)))
      g.dispatchEvent(new PointerEvent('pointerup', Object.assign({ screenX: ${1000 + dx} }, o)))
      return 1 })()`)
  }, dx)

test('チャットの窓の左端をドラッグすると幅が変わり（ループの画面はその分狭まる）、開き直しても覚えていて、ダブルクリックで元の幅に戻る', async () => {
  await open(true)
  expect(await widths()).toEqual({ chat: 360, loops: 840 })
  // 左へ 100px 動かすと 460px
  await drag(-100)
  await expect.poll(widths).toEqual({ chat: 460, loops: 740 })
  // 広げすぎてもウィンドウの 6 割（720px）まで、狭めすぎても 280px まで
  await drag(-1000)
  await expect.poll(async () => (await widths()).chat).toBe(720)
  await drag(2000)
  await expect.poll(async () => (await widths()).chat).toBe(280)
  await drag(-180)
  await expect.poll(async () => (await widths()).chat).toBe(460)
  // 開き直しても 460px
  await app.close()
  await open(false)
  await expect.poll(widths).toEqual({ chat: 460, loops: 740 })
  // ダブルクリックで 360px に戻る
  await app.evaluate(async ({ webContents }) => {
    const w = webContents.getAllWebContents().find((c) => c.getURL().includes('/_rla/chat.html'))!
    await w.executeJavaScript('document.getElementById("grip").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); 1')
  })
  await expect.poll(widths).toEqual({ chat: 360, loops: 840 })
})
