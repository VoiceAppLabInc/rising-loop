import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { CURRENT, inLoops, later, launch, nextFolder, paneText } from './helpers'

let app: ElectronApplication
let win: Page
let root: string

async function start(extraEnv: Record<string, string> = {}, firstRun = false): Promise<void> {
  app = await launch(root, extraEnv, { firstRun })
  win = await app.firstWindow()
}

/** いまの版の見本を一時フォルダに写してプロジェクトにする */
async function openCurrent(name = 'proj'): Promise<string> {
  const folder = join(root, name)
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: /フォルダを開く…|プロジェクトを追加/ }).first().click()
  return folder
}

/** テスト用の AI が最後に起動したときの引数 */
async function lastArgv(): Promise<string[] | null> {
  const text = (await paneText(app, 's-list')) ?? ''
  const i = text.lastIndexOf('FAKE-AI {')
  if (i < 0) return null
  const json = text.slice(i + 8)
  return JSON.parse(json.slice(0, json.indexOf('}') + 1)).argv
}

const openSettings = () => win.getByRole('button', { name: '設定' }).click()

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-settings-'))
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('フォルダを選び直すと、タブの名前もそのフォルダ名になる', async () => {
  await start()
  await openCurrent()
  const other = join(root, 'other-service')
  cpSync(resolve('tests/fixtures/versions', CURRENT), other, { recursive: true })
  await openSettings()
  await nextFolder(app, other)
  await win.getByRole('button', { name: '選び直す…' }).click()
  await expect(win.getByRole('tab', { name: 'other-service' })).toBeVisible()
  await expect(win.getByRole('tab')).toHaveCount(1)
})

test('すべて自動で許可にすると、同じ会話のままチャットを起動し直す', async () => {
  await start()
  await openCurrent()
  await expect.poll(lastArgv).not.toBeNull()
  const before = (await lastArgv())!
  expect(before).not.toContain('--permission-mode')
  await openSettings()
  await win.getByRole('radio', { name: 'すべて自動で許可' }).check()
  await expect.poll(async () => (await lastArgv())?.includes('bypassPermissions')).toBe(true)
  // 会話は同じ
  expect((await lastArgv())![1]).toBe(before[1])
})

test('使う AI を Codex にすると、codex の会話で起動し直す', async () => {
  await start()
  await openCurrent()
  await expect.poll(lastArgv).not.toBeNull()
  await openSettings()
  await win.getByRole('radio', { name: 'Codex' }).check()
  await expect.poll(async () => (await lastArgv())?.includes('resume'), { timeout: 15_000 }).toBe(true)
  expect(await lastArgv()).toContain('fake-thread-1')
})

test('プロジェクトを外すと一覧から消え、フォルダには触れない', async () => {
  await start()
  const folder = await openCurrent('yoga')
  await openSettings()
  await win.getByRole('button', { name: '外す' }).click()
  await expect(win.getByRole('tab')).toHaveCount(0)
  expect(existsSync(join(folder, 'loops', 'index.html'))).toBe(true)
})

test('AI の状態を出し、ログインしていなければ［ログイン］で公式の手順を動かす', async () => {
  await start({ RLA_FAKE_LOGGED_OUT: '1' })
  await openSettings()
  const claude = win.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('ログインしていません')
  await expect(claude).toContainText('fake-ai 9.9.9')
  await claude.getByRole('button', { name: 'ログイン' }).click()
  await expect(win.locator('.tool-head')).toContainText('（終わりました）', { timeout: 10_000 })
  const out = await win.evaluate(() => {
    const t = (window as unknown as { __rlaToolTerm: { buffer: { active: { length: number; getLine: (i: number) => { translateToString: () => string } } } } }).__rlaToolTerm
    let s = ''
    for (let i = 0; i < t.buffer.active.length; i++) s += t.buffer.active.getLine(i).translateToString() + '\n'
    return s
  })
  expect(out).toContain('LOGIN-FLOW-OK')
})

test('ほかの場所の rising-loop を見つけたら聞き、ゴミ箱に入れる', async () => {
  const dir = join(root, 'home', '.claude', 'skills', 'rising-loop')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: rising-loop\n---\n')
  await start()
  const d = win.getByRole('dialog')
  await expect(d).toContainText('ほかの場所に rising-loop が入っています')
  await expect(d).toContainText(dir)
  await d.getByRole('button', { name: 'ゴミ箱に入れる' }).click()
  await expect(d).toHaveCount(0)
  expect(existsSync(dir)).toBe(false)
  expect(readdirSync(join(root, 'trash'))).toHaveLength(1)
})

test('［残す］と答えたら、次からは聞かない', async () => {
  const dir = join(root, 'home', '.agents', 'skills', 'old')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: loop-manager\n---\n')
  await start()
  await win.getByRole('dialog').getByRole('button', { name: '残す' }).click()
  await app.close()
  await start()
  await win.waitForTimeout(1500)
  await expect(win.getByRole('dialog')).toHaveCount(0)
  expect(existsSync(dir)).toBe(true)
})

test('いまの殻では、タブの列に使い方と AI の窓の開閉を出す（使い方は初回だけ自動で開く）', async () => {
  await start({}, true)
  const folder = await openCurrent()
  const howto = win.getByRole('dialog')
  await expect(howto).toContainText('ライジング・ループの使い方')
  await howto.getByRole('button', { name: 'わかった' }).click()
  // 殻には使い方と開閉のボタンを置かない
  expect((await inLoops(app, folder, '!!document.getElementById("howto") || !!document.getElementById("cc-toggle")'))?.value).toBe(false)
  // 開閉はアプリのボタンから
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("pane-on")'))?.value).toBe(true)
  await win.getByRole('button', { name: 'AI ▸' }).click()
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("pane-on")'))?.value).toBe(false)
  await win.getByRole('button', { name: 'AI ◂' }).click()
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("pane-on")'))?.value).toBe(true)
  // 使い方は、いつでも開ける（開き直しても自動では開かない）
  await win.getByRole('button', { name: '? 使い方' }).click()
  await expect(win.getByRole('dialog')).toContainText(`スキル v${CURRENT}`)
})

test('前の版の殻では、殻が自分のボタンを持つので、アプリは出さない', async () => {
  await start()
  const folder = join(root, 'old')
  cpSync(resolve('tests/fixtures/sample-project'), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win)
  await expect(win.getByRole('button', { name: '? 使い方' })).toHaveCount(0)
  await expect(win.getByRole('button', { name: /AI [▸◂]/ })).toHaveCount(0)
  await expect(win.getByRole('button', { name: '設定' })).toBeVisible()
})
