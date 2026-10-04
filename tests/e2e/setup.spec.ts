import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { dialogOf, inLoops, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

const KICKOFF = '受信: rising-loop を始めます。まず /rising-loop を呼び出して最新の手順を読み、それに従ってください。'
const count = (text: string | null, s: string) => (text ?? '').split(s).length - 1

async function open(): Promise<void> {
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await (await dialogOf(app)).getByRole('button', { name: '追加する' }).click()
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-setup-'))
  folder = join(root, 'new-service')
  mkdirSync(folder)
  app = await launch(root)
  win = await mainWindow(app)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('ループが無いフォルダを開くと、全面のチャットで目標を決める依頼が自動で届く', async () => {
  await open()
  await expect(win.getByText('「new-service」をプロジェクトにしました。')).toBeVisible()
  await expect(win.getByText('まず、このプロジェクトの目標を決めましょう。')).toBeVisible()
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 15_000 }).toBe(1)
})

test('ループが無いフォルダは、新しいプロジェクトにしてよいかを聞き、［やめる］なら追加しない', async () => {
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  const d = (await dialogOf(app))
  await expect(d).toContainText('「new-service」にはループがありません。新しいプロジェクトとして追加しますか？')
  await d.getByRole('button', { name: 'やめる' }).click()
  await expect(d).toHaveCount(0)
  await expect(win.getByRole('tab')).toHaveCount(0)
})

test('loops/ ができると通常の形に切り替わり、同じ会話が一覧のチャットとして続く', async () => {
  await open()
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 15_000 }).toBe(1)

  // スキルが loops/ を作ったつもりで、見本を置く
  cpSync(join(SAMPLE, 'loops'), join(folder, 'loops'), { recursive: true })
  await expect(win.getByText('まず、このプロジェクトの目標を決めましょう。')).toBeHidden({ timeout: 10_000 })
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
  // 一覧の右のチャットに、目標を決めたときの会話がそのまま出る（AI は1つのまま）
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF)).toBe(1)
  expect(count(await paneText(app, 's-list'), 'FAKE-AI {')).toBe(1)
})

test('最初の依頼はプロジェクトごとに1回だけ。開き直しても二度送らない', async () => {
  await open()
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 15_000 }).toBe(1)
  await app.close()

  app = await launch(root)
  win = await mainWindow(app)
  await expect(win.getByText('まず、このプロジェクトの目標を決めましょう。')).toBeVisible()
  await expect.poll(async () => count(await paneText(app, 's-list'), 'FAKE-AI {')).toBe(1)
  await win.waitForTimeout(2500)
  expect(count(await paneText(app, 's-list'), KICKOFF)).toBe(0)
})

/** 設定の［OK］と同じ（AI を切り替える） */
type Rla = { getProjects: () => Promise<{ currentId: string | null; projects: { kickoffAt?: string }[] }>; updateProject: (id: string, p: { ai: string }) => Promise<unknown> }
const switchAi = (ai: 'claude' | 'codex') =>
  win.evaluate(async (ai) => {
    const rla = (window as unknown as { rla: Rla }).rla
    const s = await rla.getProjects()
    await rla.updateProject(s.currentId!, { ai })
  }, ai)
const kickoffAt = () => win.evaluate(async () => (await (window as unknown as { rla: Rla }).rla.getProjects()).projects[0].kickoffAt ?? null)

test('ループがまだ無いあいだに AI を切り替えると、切り替えた先のチャットにも最初の依頼を送る', async () => {
  await open()
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 15_000 }).toBe(1)
  await switchAi('codex')
  // codex で起動し直している（codex にだけ渡す起動時の指示がある。画面は消してから始まる）
  await expect.poll(async () => (await paneText(app, 's-list')) ?? '', { timeout: 20_000 }).toContain('developer_instructions')
  // 新しい AI のチャットにも、もう一度届く
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 20_000 }).toBe(1)
})

test('AI が動かず届かなかった最初の依頼は「送った」ことにせず、AI を切り替えたらそちらへ届ける', async () => {
  await app.close()
  // claude が無い状態で始める
  app = await launch(root, { RISING_LOOP_APP_CLAUDE_PATH: join(root, 'no-such-claude') })
  win = await mainWindow(app)
  await open()
  await expect.poll(async () => (await paneText(app, 's-list')) ?? '', { timeout: 15_000 }).toContain('Claude Code が使えません')
  // まだ「送った」と記録しない
  expect(await kickoffAt()).toBeNull()
  await switchAi('codex')
  await expect.poll(async () => count(await paneText(app, 's-list'), KICKOFF), { timeout: 20_000 }).toBe(1)
  await expect.poll(kickoffAt).not.toBeNull()
})
