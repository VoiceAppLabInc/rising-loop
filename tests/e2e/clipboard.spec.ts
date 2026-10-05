import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { inFrame, inLoops, later, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

// Windows では、チャットのターミナルで Ctrl+C・Ctrl+V・右クリックがコピーと貼り付けになる（2026-10-05 の苦情：Windows でコピペできない）。
// Mac の上で Windows のふり（RISING_LOOP_TEST_PLATFORM=win32）をして確かめる
let app: ElectronApplication
let win: Page
let root: string
let folder: string

const PANE = '&arg=s-list'
const received = async () => ((await paneText(app, 's-list')) ?? '').split('\n').filter((l) => l.startsWith('受信: '))
const setClip = (t: string) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), t)
const getClip = () => app.evaluate(({ clipboard }) => clipboard.readText())

/**
 * 右の窓（一覧のチャット）のターミナルでキーを押す。ターミナルの入力の要素（xterm の textarea）に keydown・keyup を送る
 * （隠したウィンドウでは sendInputEvent が中の iframe まで届かないため。キーの扱いは本物と同じ xterm の処理を通る）
 */
async function press(key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): Promise<void> {
  // xterm は Enter などを keyCode で見る
  const keyCode = key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0)
  const o = JSON.stringify({ key, keyCode, bubbles: true, cancelable: true, ...mods })
  await inFrame(app, PANE, `(function(){ var t = window.__rlaTerm.textarea; t.focus(); t.dispatchEvent(new KeyboardEvent("keydown", ${o})); t.dispatchEvent(new KeyboardEvent("keyup", ${o})); return 1 })()`)
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-clip-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
  app = await launch(root, { RISING_LOOP_TEST_PLATFORM: 'win32' })
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('Windows：チャットで Ctrl+V を押すとクリップボードの文が AI に届く（1回だけ）', async () => {
  await setClip('貼り付けたい文')
  await press('v', { ctrlKey: true })
  await new Promise((r) => setTimeout(r, 500)) // 貼り付けはクリップボードを読んでから（非同期）なので、届いてから Enter
  await press('Enter')
  await expect.poll(received, { timeout: 10_000 }).toContain('受信: 貼り付けたい文')
  expect((await received()).filter((l) => l.includes('貼り付けたい文'))).toHaveLength(1)
})

test('Windows：文字を選んで Ctrl+C を押すとコピーされ、選んだところは外れる', async () => {
  await setClip('前の中身')
  await inFrame(app, PANE, 'window.__rlaTerm.selectAll(); 1')
  await press('c', { ctrlKey: true })
  await expect.poll(getClip).toContain('FAKE-AI')
  expect(await inFrame(app, PANE, 'window.__rlaTerm.hasSelection()')).toBe(false)
})

test('Windows：右クリックは、選んでいなければ貼り付け、選んでいればコピー', async () => {
  const rightClick = () => inFrame(app, PANE, 'document.getElementById("term").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); 1')
  await setClip('みぎクリックの文')
  await rightClick()
  await new Promise((r) => setTimeout(r, 500))
  await press('Enter')
  await expect.poll(received, { timeout: 10_000 }).toContain('受信: みぎクリックの文')
  await inFrame(app, PANE, 'window.__rlaTerm.selectAll(); 1')
  await rightClick()
  await expect.poll(getClip).toContain('FAKE-AI')
})
