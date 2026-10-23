import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { CURRENT, inFrame, inLoops, launch, mainWindow, nextFolder } from './helpers'

// 右の窓の上の帯に、いまのセッションの ID を出し、［ログのパス］でその記録（jsonl）のパスをコピーする（2026-10-23）。
// 困ったときに、どのセッションかを伝え、記録を別のセッションに読ませるため
let app: ElectronApplication
let root: string

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('右の窓の上にセッションの ID が出て、［ログのパス］で記録のパスをコピーできる', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-sid-'))
  const folder = join(root, 'my proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)

  // 帯の ID は、アプリが記録したその画面のセッション
  const bookId = () => {
    try {
      return JSON.parse(readFileSync(join(root, 'data', 'sessions.json'), 'utf8'))[folder].screens['s-list'].claude.id as string
    } catch {
      return null
    }
  }
  await expect.poll(bookId).not.toBeNull()
  const id = bookId()!
  await expect.poll(() => inFrame(app, '&arg=s-list', 'document.querySelector("#sid .id").textContent')).toBe(id)

  // 押すと、記録のパス（claude の置き場所：フォルダのパスの英数字以外を - にした名前）がクリップボードへ
  const file = join(root, 'claude-config', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'), id + '.jsonl')
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await inFrame(app, '&arg=s-list', 'document.querySelector("#sid button").click(); 1')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(file)
  expect(await inFrame(app, '&arg=s-list', 'document.querySelector("#sid button").textContent')).toBe('コピーしました')
  // しばらくすると元の文字に戻る
  await expect.poll(() => inFrame(app, '&arg=s-list', 'document.querySelector("#sid button").textContent')).toBe('ログのパス')
})
