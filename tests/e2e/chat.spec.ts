import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { SAMPLE, inFrame, inLoops, later, launch, nextFolder, paneText } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

/** テスト用の AI が最初に出す「FAKE-AI {引数・作業フォルダ}」を読む */
async function fakeStart(screen: string): Promise<{ argv: string[]; cwd: string; claudecode: string | null }> {
  let text = ''
  await expect.poll(async () => (text = (await paneText(app, screen)) ?? '')).toContain('FAKE-AI {')
  const json = text.slice(text.indexOf('FAKE-AI {') + 'FAKE-AI '.length)
  return JSON.parse(json.slice(0, json.indexOf('}') + 1))
}

const typeInPane = (screen: string, data: string) => inFrame(app, '&arg=' + screen, `window.__rlaTerm.input(${JSON.stringify(data)}, true); 1`)

async function open(): Promise<void> {
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(win)
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-chat-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
  app = await launch(root)
  win = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('右の窓で AI がプロジェクトのフォルダで起動し、同梱のスキルを渡される', async () => {
  await open()
  const s = await fakeStart('s-list')
  // Mac の一時フォルダは /var → /private/var の別名なので、実体のパスで比べる
  expect(realpathSync(s.cwd)).toBe(realpathSync(folder))
  expect(s.argv[0]).toBe('--session-id')
  expect(s.argv[1]).toMatch(/^[0-9a-f-]{36}$/)
  expect(s.argv).toContain('--plugin-dir')
  expect(s.argv[s.argv.indexOf('--plugin-dir') + 1]).toBe(resolve('skill'))
  const promptFile = s.argv[s.argv.indexOf('--append-system-prompt-file') + 1]
  expect(readFileSync(promptFile, 'utf8')).toContain('rising-loop:rising-loop')
  // Claude Code の中から起動しても、その目印は渡さない
  expect(s.claudecode).toBeNull()
})

test('打った文字が AI に届く', async () => {
  await open()
  await fakeStart('s-list')
  await typeInPane('s-list', 'こんにちは\r')
  await expect.poll(async () => await paneText(app, 's-list')).toContain('受信: こんにちは')
})

test('画面ごとに別の会話になり、開き直すと同じ会話の続きになる', async () => {
  await open()
  const list = await fakeStart('s-list')
  await inLoops(app, folder, `document.querySelector('[data-go="s-L01"]').click()`)
  const l01 = await fakeStart('s-L01')
  expect(l01.argv[1]).not.toBe(list.argv[1])

  // 会話のファイルができた状態にして開き直すと、--resume で続きから開く
  mkdirSync(join(root, 'claude-config', 'projects', 'x'), { recursive: true })
  writeFileSync(join(root, 'claude-config', 'projects', 'x', list.argv[1] + '.jsonl'), '')
  await app.close()
  app = await launch(root)
  win = await app.firstWindow()
  const again = await fakeStart('s-list')
  expect(again.argv.slice(0, 2)).toEqual(['--resume', list.argv[1]])
})

test('既存の loops/.chat-sessions の会話を引き継ぎ、そのファイルは書き換えない', async () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const file = join(folder, 'loops', '.chat-sessions')
  writeFileSync(file, `s-list claude ${id}\n`)
  await open()
  const s = await fakeStart('s-list')
  expect(s.argv.slice(0, 2)).toEqual(['--session-id', id])
  expect(readFileSync(file, 'utf8')).toBe(`s-list claude ${id}\n`)
})

test('AI が終わったら、Enter で開き直す', async () => {
  await open()
  const first = await fakeStart('s-list')
  await typeInPane('s-list', 'exit\r')
  await expect.poll(async () => await paneText(app, 's-list')).toContain('終了しました。Enter で開き直します。')
  await typeInPane('s-list', '\r')
  await expect.poll(async () => ((await paneText(app, 's-list')) ?? '').split('FAKE-AI {').length - 1).toBe(2)
  // 開き直しても同じ会話
  const text = (await paneText(app, 's-list')) ?? ''
  expect(text.lastIndexOf(first.argv[1])).toBeGreaterThan(text.indexOf(first.argv[1]))
})
