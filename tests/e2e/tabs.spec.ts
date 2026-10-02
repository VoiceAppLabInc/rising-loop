import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { SAMPLE, inFrame, inLoops as inLoopsOf, later, launch, nextFolder as nextFolderOf } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let withLoops: string
let noLoops: string

type Received = { panes: { projectId: string | null; screen: string }[]; instructions: { projectId: string | null; text: string }[] }
const received = () => app.evaluate(() => (globalThis as unknown as { __rla: Received }).__rla)
const nextFolder = (folder: string) => nextFolderOf(app, folder)
const inLoops = (folder: string, code: string) => inLoopsOf(app, folder, code)
const inLoopPage = (file: string, code: string) => inFrame(app, '/' + file, code)

/** フォルダの中身を、ファイルごとの「名前と更新時刻と大きさ」にする（アプリが何も書いていないことを確かめる） */
function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .sort()
    .map((n) => {
      const s = statSync(join(dir, n))
      return `${n} ${s.mtimeMs} ${s.size}`
    })
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-e2e-'))
  withLoops = join(root, 'yoga app')
  cpSync(SAMPLE, withLoops, { recursive: true })
  noLoops = join(root, 'new-service')
  mkdirSync(noLoops)
  app = await launch(root)
  win = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('フォルダを開くとタブができ、スキルの画面がそのまま出る', async () => {
  await expect(win.getByText('プロジェクトのフォルダを開きましょう')).toBeVisible()
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await expect(win.getByRole('tab', { name: 'yoga app' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => (await inLoops(withLoops, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
})

test('右の窓（localhost:7681）をアプリが受け、画面IDが分かる', async () => {
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await expect.poll(async () => (await received()).panes.map((p) => p.screen)).toContain('s-list')
  const p = (await received()).panes[0]
  expect(p.projectId).toBe('p1')
  // 右の窓には、アプリのページが出ている（ttyd に繋ぎに行かない）
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .flatMap((w) => w.mainFrame.framesInSubtree)
          .filter((f) => f.url.startsWith('http://localhost:7681/'))
          .length
      )
    )
    .toBeGreaterThan(0)
  // ループの画面へ移ると、その画面の ID で届く
  await inLoops(withLoops, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(async () => (await received()).panes.map((p) => p.screen)).toContain('s-L01')
})

test('指示文はアプリが受け取り、ほかのコピーは受け取らない', async () => {
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await expect.poll(async () => (await inLoops(withLoops, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)

  // 一覧の「全ループ更新」
  await inLoops(withLoops, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(async () => (await received()).instructions.length).toBe(1)
  const first = (await received()).instructions[0]
  expect(first.projectId).toBe('p1')
  expect(first.text).toMatch(/^---\nloop: all\n/)
  expect(first.text).toContain('task: |\n  loops/ の全ループを更新して')

  // ループの頁（iframe の中）の「更新」
  await inLoops(withLoops, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inLoopPage('L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await inLoopPage('L01.html', 'document.querySelector("button.upd[data-upd=L01]").click()')
  await expect.poll(async () => (await received()).instructions.length).toBe(2)
  expect((await received()).instructions[1].text).toContain('loop: L01')

  // 💡 のコマンドは指示文ではないので、アプリには来ない
  await inLoops(withLoops, 'document.querySelector(".h-cmd[data-cmd=claude]").click()')
  await win.waitForTimeout(500)
  expect((await received()).instructions).toHaveLength(2)
})

test('タブを切り替えても、ループの画面は読み込み直さない', async () => {
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await expect.poll(async () => (await inLoops(withLoops, '!!document.querySelector("button.upd")'))?.value).toBe(true)
  const before = (await inLoops(withLoops, 'window.__mark = "まだ同じ頁"; 1'))!

  await nextFolder(noLoops)
  await win.getByRole('button', { name: 'プロジェクトを追加' }).click()
  await win.getByRole('dialog').getByRole('button', { name: '追加する' }).click()
  await expect(win.getByRole('tab', { name: 'new-service' })).toHaveAttribute('aria-selected', 'true')
  await expect(win.getByText('まず、このプロジェクトの目標を決めましょう。')).toBeVisible()

  await win.getByRole('tab', { name: 'yoga app' }).click()
  await expect(win.getByRole('tab', { name: 'yoga app' })).toHaveAttribute('aria-selected', 'true')
  const after = (await inLoops(withLoops, 'window.__mark'))!
  expect(after.id).toBe(before.id)
  expect(after.value).toBe('まだ同じ頁')
})

test('同じフォルダを選んでもタブは増えず、開き直してもタブが残る', async () => {
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await nextFolder(noLoops)
  await win.getByRole('button', { name: 'プロジェクトを追加' }).click()
  await win.getByRole('dialog').getByRole('button', { name: '追加する' }).click()
  await nextFolder(withLoops + '/')
  await win.getByRole('button', { name: 'プロジェクトを追加' }).click()
  await expect(win.getByRole('tab')).toHaveCount(2)
  await expect(win.getByRole('tab', { name: 'yoga app' })).toHaveAttribute('aria-selected', 'true')

  await app.close()
  app = await launch(root)
  win = await app.firstWindow()
  await expect(win.getByRole('tab')).toHaveCount(2)
  await expect(win.getByRole('tab', { name: 'yoga app' })).toHaveAttribute('aria-selected', 'true')
})

test('アプリはプロジェクトのフォルダに何も書かない', async () => {
  const before = listing(withLoops)
  await nextFolder(withLoops)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win) // 見本は古い形なので、知らせに「あとで」と答える
  await expect.poll(async () => (await inLoops(withLoops, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
  await inLoops(withLoops, 'document.querySelector("button.upd[data-upd=all]").click()')
  await inLoops(withLoops, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(async () => (await received()).instructions.length).toBe(1)
  expect(listing(withLoops)).toEqual(before)
  expect(readFileSync(join(withLoops, 'loops', 'index.html'), 'utf8')).toBe(readFileSync(join(SAMPLE, 'loops', 'index.html'), 'utf8'))
})
