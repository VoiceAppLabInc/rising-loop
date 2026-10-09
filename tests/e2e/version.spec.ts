import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, CURRENT, dialogOf, inLoops, launch, mainWindow, nextFolder, paneText } from './helpers'
import { changelogSummary } from '../../src/shared/migrate'
import { HANDOFF_ASK } from '../../src/main/launch'

/** タブの列の高さ（src/main/views.ts の TAB_H と同じ） */
const TAB_H = 48

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

/** 透明な層（カードとダイアログ）の置き場所。full は窓いっぱいか */
const layerView = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const v = w.contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL().includes('overlay=bar')) as Electron.WebContentsView | undefined
    if (!v) return null
    const b = v.getBounds()
    const [width, height] = w.getContentSize()
    return { visible: v.getVisible(), x: b.x, y: b.y, full: b.width === width && b.height === height }
  })

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-version-'))
  app = await launch(root)
  win = await mainWindow(app)
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('古い形のプロジェクトを開くと最初にダイアログで知らせ、あとでを押すと帯が残る', async () => {
  await open('1.7.5')
  const dialog = (await dialogOf(app))
  await expect(dialog).toContainText('HTMLが前のバージョンです')
  await expect(dialog).toContainText('1.5〜1.7 の形')
  await expect(dialog).toContainText(`いまのバージョンは ${CURRENT}`)
  // 古い形のままだと AI の作業が崩れうることを伝え、「使い続けられる」とは言わない
  await expect(dialog).toContainText('前のバージョンのままだと、AI の作業（更新・指示など）がうまく動かず、画面や数字が崩れることがあります。')
  await expect(dialog).not.toContainText('使い続けられ')
  // ダイアログは窓いっぱいの透明な層に描き、後ろのループの画面は隠さない（層の薄暗い背景ごしに見せる）
  await expect.poll(layerView).toEqual({ visible: true, x: 0, y: 0, full: true })
  await expect.poll(async () => (await loopsView())?.visible).toBe(true)

  await dialog.getByRole('button', { name: 'あとで' }).click()
  await expect(dialog).toBeHidden()
  await expect((await cardPage(app)).getByRole('status')).toContainText('前のバージョンのHTMLです（1.5〜1.7 の形）')
  // カードはループの画面の上に浮かぶので、画面は下げない
  await expect.poll(async () => await loopsView()).toEqual({ visible: true, y: TAB_H })
})

test('一度知らせた形は、開き直しても知らせず、帯だけ出す', async () => {
  await open('1.6.1')
  await (await dialogOf(app)).getByRole('button', { name: 'あとで' }).click()
  await app.close()
  app = await launch(root)
  win = await mainWindow(app)
  await expect((await cardPage(app)).getByRole('status')).toContainText('1.6.1')
  await win.waitForTimeout(1000)
  await expect((await dialogOf(app))).toHaveCount(0)
})

test('いまの形のプロジェクトには、知らせも帯も出さない', async () => {
  await open(CURRENT)
  await expect.poll(async () => await loopsView()).toEqual({ visible: true, y: TAB_H })
  await expect((await dialogOf(app))).toHaveCount(0)
  await expect((await cardPage(app)).getByRole('status')).toHaveCount(0)
})

test('版の表示がある古い形は、その版で知らせる', async () => {
  await open('1.4.0')
  await expect((await dialogOf(app))).toContainText('「proj-1.4.0」のHTMLは 1.4.0 です')
})

/** フォルダの中身を「相対パス → 中身」にする */
function contents(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const p = join(dir, n)
    if (statSync(p).isFile()) out[n] = readFileSync(p, 'utf8')
  }
  return out
}

/** AI が台帳の項目を反映し終えたつもりで、頁と一覧に版の印を書く */
function stampAll(folder: string, ver: string): void {
  const loops = join(folder, 'loops')
  for (const n of readdirSync(loops).filter((x) => /^L.*\.html$/.test(x))) {
    const p = join(loops, n)
    writeFileSync(p, readFileSync(p, 'utf8').replace(/<html([^>]*?)( data-loop-ver="[^"]*")?>/, `<html$1 data-loop-ver="${ver}">`))
  }
  const idx = join(loops, 'index.html')
  writeFileSync(idx, readFileSync(idx, 'utf8').replace('<!-- LOOPS:BEGIN -->\n', `<!-- LOOPS:BEGIN -->\n<!-- list-ver: ${ver} -->\n`))
}

const received = async () => ((await paneText(app, 's-list')) ?? '').split('\n').filter((l) => l.startsWith('受信: '))
const backups = () => {
  const d = join(root, 'data', 'backups', 'p1')
  return existsSync(d) ? readdirSync(d).sort() : []
}

test('［新しい形にする］で、控えを取り、殻と共通の部品を入れ替える', async () => {
  const folder = await open('1.7.5')
  const before = contents(join(folder, 'loops'))
  await (await dialogOf(app)).getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect((await dialogOf(app))).toBeHidden()

  const index = readFileSync(join(folder, 'loops', 'index.html'), 'utf8')
  expect(index).toMatch(new RegExp(`<span class="ver"[^>]*>v${CURRENT.replace(/\./g, '\\.')}</span>`))
  expect(index).not.toContain('id="cc-ask"')
  expect(readFileSync(join(folder, 'loops', 'rising.js'), 'utf8')).toBe(readFileSync(resolve('skill/skills/rising-loop/assets/rising.js'), 'utf8'))
  // 控えは loops/ の外（アプリのデータ置き場）に、元のまま
  expect(backups()).toHaveLength(1)
  expect(contents(join(root, 'data', 'backups', 'p1', backups()[0], 'loops'))).toEqual(before)
  expect(existsSync(join(folder, 'loops', '.tmp'))).toBe(false)
  // 台帳の項目（2.0.0 の印など）がまだの頁と一覧があるので、AI に作業を送る。AI が作業中のあいだは、そう出す
  await expect((await cardPage(app)).getByRole('status')).toContainText('新しいバージョンに直しています（AI が作業中）')
  // AI の手が止まっても直っていなければ、どこが残っているかと［続きを AI に頼む］を出す
  await expect((await cardPage(app)).getByRole('status')).toContainText('直っていないループがあります（L01）', { timeout: 15_000 })
  await expect((await cardPage(app)).getByRole('status').getByRole('button', { name: '続きを AI に頼む' })).toBeVisible()
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  const [line] = await received()
  // 見本の殻の版の表示は v0.0.0（1.7.1〜1.7.6 のどれか分からない）なので、1.7.0 より後の項目をすべて送る
  expect(line).toContain('- L01.html（1.7.0 から）：1.7.1-goal-bullet、1.7.1-chart-refs、1.7.2-tid-pill、1.7.2-tid-ref、1.7.2-no-done-tag、1.7.2-status-words、1.7.4-trial-anchor、2.0.0-page-ver、2.3.1-back-link、2.3.4-log-link、2.3.5-back-label')
  expect(line).toContain('一覧（1.7.0 から）：1.7.4-list-rows、1.7.4-list-note、2.0.0-list-ver、2.0.0-const-note')
  expect(line).toContain('migrations.json')
  // AI が反映し終えたつもりで印を書く → 帯が「新しい形にしました」に変わる
  stampAll(folder, CURRENT)
  await expect((await cardPage(app)).getByRole('status')).toContainText(`HTMLを最新版にしました（1.5〜1.7 の形 → ${CURRENT}）`, { timeout: 10_000 })
  await expect((await cardPage(app)).getByRole('status').getByRole('button', { name: '元に戻す' })).toBeVisible()
})

test('前の版からの台帳の項目を、漏らさず古い順に送る（1.6.1 の頁）', async () => {
  await open('1.6.1')
  await (await dialogOf(app)).getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  const [line] = await received()
  expect(line).toContain('- L01.html（1.6.1 から）：1.7.0-chart-parts、1.7.1-goal-bullet、1.7.1-chart-refs、1.7.2-tid-pill、1.7.2-tid-ref、1.7.2-no-done-tag、1.7.2-status-words、1.7.4-trial-anchor、2.0.0-page-ver、2.3.1-back-link、2.3.4-log-link、2.3.5-back-label')
  expect(line).toContain('一覧（1.6.1 から）：1.7.4-list-rows、1.7.4-list-note、2.0.0-list-ver、2.0.0-const-note')
  // 手が止まったあと、続きを頼める（もう動いている AI には貼り付けで送る）
  await (await cardPage(app)).getByRole('status').getByRole('button', { name: '続きを AI に頼む' }).click({ timeout: 15_000 })
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(2)
})

test('2.0 以降の画面は、殻の版がスキルの版より古ければ知らせ、入れ替えると版がそろう', async () => {
  const folder = join(root, 'proj-old20')
  cpSync(resolve('tests/fixtures/versions/2.0.0'), folder, { recursive: true })
  const p = join(folder, 'loops', 'index.html')
  writeFileSync(p, readFileSync(p, 'utf8').replace('<span class="ver">v2.0.0</span>', '<span class="ver">v1.9.9</span>'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  const d = (await dialogOf(app))
  await expect(d).toContainText(`「proj-old20」のHTMLは 1.9.9 です。いまのバージョンは ${CURRENT} です。`)
  await d.getByRole('button', { name: 'HTMLを最新版にする' }).click()
  // 頁は 2.0.0 の作りなので、その後の台帳の頁の項目を AI が反映したつもりで印を書く
  await expect((await cardPage(app)).getByRole('status')).toContainText('新しいバージョンに直しています（AI が作業中）')
  stampAll(folder, CURRENT)
  await expect((await cardPage(app)).getByRole('status')).toContainText(`HTMLを最新版にしました（1.9.9 → ${CURRENT}）`, { timeout: 15_000 })
  expect(readFileSync(p, 'utf8')).toMatch(new RegExp(`<span class="ver"[^>]*>v${CURRENT.replace(/\./g, '\\.')}</span>`))
})

test('頁の書き方が雛形と違っても、前の版とは言わない', async () => {
  const folder = join(root, 'proj-free')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  const l01 = join(folder, 'loops', 'L01.html')
  writeFileSync(l01, readFileSync(l01, 'utf8').replace(/tid-pill/g, 'my-pill').replace(/data-rl/g, 'data-x'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => await loopsView()).toEqual({ visible: true, y: TAB_H })
  await expect((await dialogOf(app))).toHaveCount(0)
  await expect((await cardPage(app)).getByRole('status')).toHaveCount(0)
})

test('殻から消える独自の部品は、控えの殻の場所と一緒に AI に送り、移るまで帯を残す', async () => {
  const folder = await open('1.7.5')
  const p = join(folder, 'loops', 'index.html')
  writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', '<div id="my-own-panel">独自</div></body>'))
  await (await dialogOf(app)).getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  const [line] = await received()
  expect(line).toContain('殻から消えたもの：id="my-own-panel"')
  expect(line).toContain(`元の殻：${join(root, 'data', 'backups', 'p1', backups()[0], 'loops', 'index.html')}`)
  // 頁と一覧の印を書いても、消えた部品がまだ移っていなければ帯は残る
  stampAll(folder, CURRENT)
  await expect((await cardPage(app)).getByRole('status')).toContainText('直っていないところがあります', { timeout: 15_000 })
  // AI が移し直したつもりで、新しい殻に足す → 帯が「新しい形にしました」に変わる
  writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', '<div id="my-own-panel">独自</div></body>'))
  await expect((await cardPage(app)).getByRole('status')).toContainText('HTMLを最新版にしました', { timeout: 10_000 })
  // 一度移し終えたら、あとでユーザーの判断で外しても「直っていない」に戻さない
  writeFileSync(p, readFileSync(p, 'utf8').replace('<div id="my-own-panel">独自</div>', ''))
  await win.waitForTimeout(3000)
  await expect((await cardPage(app)).getByRole('status')).toContainText('HTMLを最新版にしました')
})

test('［元に戻す］で、確認してから、新しい形にする前のとおりに戻す', async () => {
  const folder = await open('1.6.1')
  const before = contents(join(folder, 'loops'))
  await (await dialogOf(app)).getByRole('button', { name: 'HTMLを最新版にする' }).click()
  // AI の作業中は［元に戻す］を出さない（書いている途中で戻すと画面が壊れる）
  await expect((await cardPage(app)).getByRole('status')).toContainText('新しいバージョンに直しています（AI が作業中）')
  await expect((await cardPage(app)).getByRole('status').getByRole('button', { name: '元に戻す' })).toHaveCount(0)
  await expect((await cardPage(app)).getByRole('status')).toContainText('直っていないループがあります', { timeout: 15_000 })
  // 新しい形にしたあとに、AI が頁を書き換えたつもり
  writeFileSync(join(folder, 'loops', 'L02.html'), '<html>あとから増えた頁</html>')

  await (await cardPage(app)).getByRole('status').getByRole('button', { name: '元に戻す' }).click()
  const d = (await dialogOf(app))
  await expect(d).toContainText('そのあとに増えた数字や記録も、その時点に戻ります。')
  await d.getByRole('button', { name: '元に戻す' }).click()
  // 元に戻したあとは、前の版の知らせをもう一度は出さない（帯だけ）
  await expect((await dialogOf(app))).toHaveCount(0)
  expect(contents(join(folder, 'loops'))).toEqual(before)
  // 戻す前の loops/ も控えに取ってある
  expect(backups()).toHaveLength(2)
  await expect((await cardPage(app)).getByRole('status')).toContainText('前のバージョンのHTMLです（1.6.1）')
})

test('前の版の画面の「⬆ アップデート」は、AI に送らずに知らせを開く', async () => {
  const folder = await open('1.7.5')
  await (await dialogOf(app)).getByRole('button', { name: 'あとで' }).click()
  await expect((await dialogOf(app))).toBeHidden()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.getElementById("rl-update")'))?.value).toBe(true)
  await inLoops(app, folder, 'document.getElementById("rl-update").click(); 1')
  await expect((await dialogOf(app))).toContainText('HTMLが前のバージョンです')
  await win.waitForTimeout(1500)
  expect(await received()).toHaveLength(0)
})

test('1.5 より前の形は、新しい形にできないと知らせる', async () => {
  await open('1.4.0')
  const d = (await dialogOf(app))
  await expect(d).toContainText('このバージョン（1.5 より前）は、アプリでは最新版にできません。')
  await expect(d.getByRole('button', { name: 'HTMLを最新版にする' })).toHaveCount(0)
  await d.getByRole('button', { name: '閉じる' }).click()
  await expect((await cardPage(app)).getByRole('status')).toContainText('アプリでは最新版にできません')
  await expect((await cardPage(app)).getByRole('status').getByRole('button')).toHaveCount(0)
})

/** AI の返事が入った会話の記録（claude の形）。返事の無い会話は「直前の会話」にしない */
const REPLY = '{"type":"user","message":{"role":"user","content":"前の会話"}}\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"前の返事"}]}}\n'

/** 右の窓のテスト用の AI が受け取った会話の ID（最後に起動したもの） */
async function lastSessionId(): Promise<string | null> {
  const text = (await paneText(app, 's-list')) ?? ''
  const i = text.lastIndexOf('FAKE-AI {')
  if (i < 0) return null
  const json = text.slice(i + 8)
  return JSON.parse(json.slice(0, json.indexOf('}') + 1)).argv[1]
}

test('［新しい形にする］で、そのプロジェクトのチャットを新しい会話にしてから作業を送る', async () => {
  const folder = await open('1.7.5')
  const p = join(folder, 'loops', 'index.html')
  writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', '<div id="my-own-panel">独自</div></body>'))
  await (await dialogOf(app)).getByRole('button', { name: 'あとで' }).click()
  await expect.poll(lastSessionId).not.toBeNull()
  const before = await lastSessionId()
  await (await cardPage(app)).getByRole('status').getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect.poll(lastSessionId, { timeout: 15_000 }).not.toBe(before)
  const text = (await paneText(app, 's-list')) ?? ''
  expect(text).toContain(`新しい会話を始めます（スキル ${CURRENT}）`)
  expect(text).not.toContain('終了しました')
  // 作業は新しい会話が受け取る
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  expect((await received())[0]).toContain('新しい形への作り直し')
})

test('記録した会話のスキルの版がいまと違えば、新しい会話にする', async () => {
  const folder = join(root, 'proj-now')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  const oldId = '11111111-1111-1111-1111-111111111111'
  // 前の版のアプリが記録した会話（版 1.9.0）があるつもり
  await app.close()
  writeFileSync(join(root, 'data', 'sessions.json'), JSON.stringify({ [folder]: { screens: { 's-list': { claude: { id: oldId, skill: '1.9.0' } } } } }))
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: /フォルダを開く…|プロジェクトを追加/ }).first().click()
  await expect.poll(lastSessionId).not.toBeNull()
  expect(await lastSessionId()).not.toBe(oldId)
  const text = (await paneText(app, 's-list')) ?? ''
  // 何が変わったかを、新しい会話の前に出す
  expect(text).toContain(`スキルが ${CURRENT} になりました。`)
  const first = changelogSummary(readFileSync(resolve('skill/skills/rising-loop/CHANGELOG.md'), 'utf8'), CURRENT)[0]
  expect(text.replace(/\n/g, '')).toContain('・' + first.slice(0, 20))
  expect(text).toContain(`新しい会話を始めます（スキル ${CURRENT}）`)
  // 直前の会話の記録が無いので、読ませる指示は足さない
  expect(text).not.toContain('直前の会話の記録を読んで')
  expect(readFileSync(join(root, 'data', 'claude-prompt-s-list.md'), 'utf8')).not.toContain('直前の')
})

test('新しい会話にするとき、直前の会話の記録があれば、読んで現在地を確かめるよう起動時の指示に足す', async () => {
  const folder = join(root, 'proj-now')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  const oldId = '22222222-2222-2222-2222-222222222222'
  await app.close()
  writeFileSync(join(root, 'data', 'sessions.json'), JSON.stringify({ [folder]: { screens: { 's-list': { claude: { id: oldId, skill: '1.9.0' } } } } }))
  // 前の会話の記録（claude の置き場所）
  const dir = join(root, 'claude-config', 'projects', 'proj-now')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, oldId + '.jsonl')
  writeFileSync(file, REPLY)
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: /フォルダを開く…|プロジェクトを追加/ }).first().click()
  await expect.poll(lastSessionId).not.toBeNull()
  expect(await lastSessionId()).not.toBe(oldId)
  expect((await paneText(app, 's-list')) ?? '').toContain('直前の会話の記録を読んで、続きから始めます')
  const prompt = readFileSync(join(root, 'data', 'claude-prompt-s-list.md'), 'utf8')
  expect(prompt).toContain(file)
  expect(prompt).toContain(`いまのスキル（${CURRENT}）に従う`)
  // ほかに送る文が無いので、現在地をひとこと話させる一文を自動で送る（会話に中身が残る）
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  expect((await received())[0]).toContain(HANDOFF_ASK)
})

test('返事の無い会話（引き継ぎの途中で切り替えたなど）は飛ばし、その前の返事のある会話を読ませる', async () => {
  const folder = join(root, 'proj-now')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  const emptyId = '33333333-3333-3333-3333-333333333333'
  const realId = '44444444-4444-4444-4444-444444444444'
  await app.close()
  writeFileSync(
    join(root, 'data', 'sessions.json'),
    JSON.stringify({ [folder]: { screens: { 's-list': { claude: { id: emptyId, skill: '1.9.0' } } }, prev: { 's-list': { claude: { id: realId, skill: '1.9.0' } } } } })
  )
  const dir = join(root, 'claude-config', 'projects', 'proj-now')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, emptyId + '.jsonl'), '{"type":"user","message":{"role":"user","content":"直前の会話の記録を読んで"}}\n')
  const realFile = join(dir, realId + '.jsonl')
  writeFileSync(realFile, REPLY)
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: /フォルダを開く…|プロジェクトを追加/ }).first().click()
  await expect.poll(lastSessionId).not.toBeNull()
  const prompt = readFileSync(join(root, 'data', 'claude-prompt-s-list.md'), 'utf8')
  expect(prompt).toContain(realFile)
  expect(prompt).not.toContain(emptyId)
})

test('［新しい形にする］で直前の会話の記録を読ませるときは、作り直しの作業だけを送る（自動の一文は送らない）', async () => {
  const folder = await open('1.7.5')
  await (await dialogOf(app)).getByRole('button', { name: 'あとで' }).click()
  await expect.poll(lastSessionId).not.toBeNull()
  const before = (await lastSessionId()) as string
  const dir = join(root, 'claude-config', 'projects', 'proj-1.7.5')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, before + '.jsonl')
  writeFileSync(file, REPLY)
  await (await cardPage(app)).getByRole('status').getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect.poll(lastSessionId, { timeout: 15_000 }).not.toBe(before)
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  expect((await received())[0]).toContain('新しい形への作り直し')
  expect((await received())[0]).not.toContain(HANDOFF_ASK)
  expect(readFileSync(join(root, 'data', 'claude-prompt-s-list.md'), 'utf8')).toContain(file)
  void folder
})

test('起動直後に入力を捨てる AI にも、作り直しの作業が届く（起動時の引数で渡す）', async () => {
  await app.close()
  app = await launch(root, { RLA_FAKE_DEAF_MS: '3000' })
  win = await mainWindow(app)
  await open('1.7.5')
  await (await dialogOf(app)).getByRole('button', { name: 'HTMLを最新版にする' }).click()
  await expect.poll(received, { timeout: 15_000 }).toHaveLength(1)
  expect((await received())[0]).toContain('新しい形への作り直し')
})
