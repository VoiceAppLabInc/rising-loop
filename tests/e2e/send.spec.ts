import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, CURRENT, dialogOf, inFrame, inLoops, later, launch, mainWindow, nextFolder, paneText, SAMPLE } from './helpers'

let app: ElectronApplication
let win: Page
let root: string
let folder: string

const received = (screen: string) => async () => ((await paneText(app, screen)) ?? '').split('\n').filter((l) => l.startsWith('受信: '))

async function start(extraEnv: Record<string, string> = {}): Promise<void> {
  app = await launch(root, extraEnv)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.upd[data-upd=all]")'))?.value).toBe(true)
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-send-'))
  folder = join(root, 'yoga app')
  cpSync(SAMPLE, folder, { recursive: true })
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('一覧のボタンを押すと、指示文が一覧のチャットに1回で届き、Enter まで押される', async () => {
  await start()
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list')).toHaveLength(1)
  const [line] = await received('s-list')()
  // 複数行の指示文が、途中の改行で切れずに1回で届く
  expect(line).toBe('受信: ---⏎loop: all⏎section: ALL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  loops/ の全ループを更新して⏎---')
})

test('ループの画面で押すと、そのループのチャットに届く', async () => {
  await start()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await expect.poll(async () => await paneText(app, 's-L01')).toContain('FAKE-AI {')
  await inFrame(app, '/L01.html', 'document.querySelector("button.upd[data-upd=L01]").click()')
  await expect.poll(received('s-L01')).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: GOAL')
  expect(await received('s-list')()).toHaveLength(0)
})

test('AI の画面が出る前に押しても、出終わってから届く', async () => {
  await start({ RLA_FAKE_DELAY_MS: '2500' })
  // まだ AI の画面が出ていない
  expect((await paneText(app, 's-list')) ?? '').not.toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-list')())[0]).toContain('loops/ の全ループを更新して')
})

test('続けて2回押すと、2回とも順に届く', async () => {
  await start()
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(2)
})

/** いまの版の見本で始める（2.3.0 からの殻は、入力の窓をアプリに頼み、指示文を直接渡す）。殻のクリップボードへの書き込みを数える */
async function startCurrent(): Promise<void> {
  rmSync(folder, { recursive: true, force: true })
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.cmt")'))?.value).toBe(true)
  await inLoops(app, folder, 'window.__clip = 0; var w = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = function (t) { window.__clip++; return w(t) }; 1')
  await expect.poll(async () => await paneText(app, 's-list')).toContain('FAKE-AI {')
}
const clipWrites = async () => (await inLoops(app, folder, 'window.__clip'))?.value

test('一覧の上の［カスタマイズ］を押すとアプリの入力の窓が出て、［送る］で HEADER あての指示文がチャットに届く（クリップボードは使わない）', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  const d = (await dialogOf(app))
  // 窓の上の小見出しは出さない
  await expect(d).not.toContainText('COMMENT')
  await expect(d.getByRole('heading')).toHaveText('ヘッダエリアをカスタマイズ')
  await expect(d).toContainText('ヘッダエリアの要素やレイアウトをカスタマイズします。')
  await expect(d.locator('.ask-chips')).toHaveCount(0)
  await d.getByRole('textbox').fill('もっと見やすくして')
  await d.getByRole('button', { name: '送る' }).click()
  await expect(d).toHaveCount(0)
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-list')())[0]).toBe('受信: ---⏎loop: ⏎section: HEADER⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎feedback: |⏎  もっと見やすくして⏎---')
  expect(await clipWrites()).toBe(0)
})

test('施策案の［AIに指示］では説明と札を出し、札は入力欄に入るだけで送らない（札は これは消して・この認識は違う・別案にして）', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.do")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.do").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('heading')).toHaveText('施策案 1について')
  await expect(d).toContainText('課金モーダルで、1枚で有料5本すべてが24時間遊べることを見せる')
  await expect(d.getByRole('textbox')).toHaveValue('')
  for (const name of ['これは消して', 'この認識は違う', '別案にして']) await expect(d.getByRole('button', { name })).toBeVisible()
  // 施策を次の段へ移す文は札にしない（［↓ 実行へ移動］のボタンが受け持つ）
  await expect(d.getByRole('button', { name: '施策を実行する' })).toHaveCount(0)
  await d.getByRole('button', { name: 'この認識は違う' }).click()
  // 入る文は札の文字のまま（句点を付けない）
  await expect(d.getByRole('textbox')).toHaveValue('この認識は違う')
  await d.getByRole('button', { name: '別案にして' }).click()
  await expect(d.getByRole('textbox')).toHaveValue('別案にして')
  await win.waitForTimeout(500)
  expect(await received('s-L01')()).toHaveLength(0)
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-L01'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: BOTTLENECK⏎target: 課金モーダルで')
})

test('施策案の［↓ 実行へ移動］は、文を書き込んだ窓を札なしで開き、送ると BOTTLENECK の指示になる', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.mv-do")')).toBe(true)
  // ［AIに指示］の左にある（同じ箱の先頭）
  expect(await inFrame(app, '/L01.html', 'document.querySelector("button.mv-do").nextElementSibling.classList.contains("do")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.mv-do").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('heading')).toHaveText('施策案 1について')
  await expect(d.getByRole('textbox')).toHaveValue('施策を実行したい。TRIALに移動してTODOを見せて')
  await expect(d.getByRole('button', { name: 'これは消して' })).toHaveCount(0)
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-L01'), { timeout: 15_000 }).toHaveLength(1)
  const got = (await received('s-L01')())[0]
  expect(got).toContain('loop: L01⏎section: BOTTLENECK⏎target: 課金モーダルで')
  expect(got).toContain('施策を実行したい。TRIALに移動してTODOを見せて')
})

test('TRIAL の［AIに指示］は 次に進んで・TODOを見直したい などの札、［↓ 評価へ移動］は「完了にして評価に移動して」を書き込んで札なし', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.mv-ins")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.ins").click()')
  let d = (await dialogOf(app))
  await expect(d.getByRole('heading')).toHaveText('施策について')
  await expect(d.getByRole('textbox')).not.toHaveAttribute('placeholder', /TRIAL に移して/)
  for (const name of ['これは消して', 'この認識は違う', '次に進んで', 'TODOを見直したい']) await expect(d.getByRole('button', { name })).toBeVisible()
  await expect(d.getByRole('button', { name: /完了にして/ })).toHaveCount(0)
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await inFrame(app, '/L01.html', 'document.querySelector("button.mv-ins").click()')
  d = (await dialogOf(app))
  await expect(d.getByRole('textbox')).toHaveValue('完了にして評価に移動して')
  await expect(d.getByRole('button', { name: '次に進んで' })).toHaveCount(0)
})

test('セクションは［カスタマイズ］、項目は［AIに指示］と出し、白地・細い実線・頭に吹き出し。施策の実行・評価のセクションのボタンは出さず、評価の［AIに指示］は題の右、TRIAL の状態は題の下（頁の HTML は書き換えない）', async () => {
  await startCurrent()
  // ボタンの [文字, 地の色, 線の種類, 頭のアイコンがあるか]
  const look = (sel: string) =>
    `(function(){ var b = document.querySelector(${JSON.stringify(sel)}), cs = getComputedStyle(b), be = getComputedStyle(b, '::before'); return [b.textContent.trim(), cs.backgroundColor, cs.borderTopStyle, /svg/.test(be.webkitMaskImage || be.maskImage || '')] })()`
  await expect.poll(async () => (await inLoops(app, folder, look('#s-list button.cmt')))?.value).toEqual(['カスタマイズ', 'rgb(255, 255, 255)', 'solid', true])
  expect((await inLoops(app, folder, look('#s-list button.upd')))?.value).toEqual(['全ループ更新', 'rgb(255, 255, 255)', 'solid', true])
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.cmt")')).toBe(true)
  await expect.poll(() => inFrame(app, '/L01.html', look('.section.t-goal button.cmt'))).toEqual(['カスタマイズ', 'rgb(255, 255, 255)', 'solid', true])
  expect(await inFrame(app, '/L01.html', look('.section.t-bottleneck button.cmt'))).toEqual(['カスタマイズ', 'rgb(255, 255, 255)', 'solid', true])
  expect(await inFrame(app, '/L01.html', look('button.do'))).toEqual(['AIに指示', 'rgb(255, 255, 255)', 'solid', true])
  // 施策案の［AIに指示］は、マウスを乗せなくても常に見えている
  expect(await inFrame(app, '/L01.html', 'getComputedStyle(document.querySelector("button.do")).opacity')).toBe('1')
  expect(await inFrame(app, '/L01.html', look('button.ins'))).toEqual(['AIに指示', 'rgb(255, 255, 255)', 'solid', true])
  expect(await inFrame(app, '/L01.html', look('button.record-comment'))).toEqual(['AIに指示', 'rgb(255, 255, 255)', 'solid', true])
  // 施策の実行・施策の評価のセクションのボタンは出さない
  expect(await inFrame(app, '/L01.html', 'document.querySelectorAll(".section.t-trial > .sec-right button.cmt, .section.t-record > .sec-right button.cmt").length')).toBe(0)
  // 評価の［AIに指示］は題の右（.record-top の中）、TRIAL の状態の一文は題の下の段（.trial-top の外）
  expect(await inFrame(app, '/L01.html', '!!document.querySelector(".record-top > button.record-comment")')).toBe(true)
  expect(await inFrame(app, '/L01.html', 'document.querySelectorAll(".trial-top .trial-status").length + ":" + document.querySelectorAll(".trial > .trial-status").length')).toBe('0:2')
  // 頁の HTML の文字はそのまま（画面で置き換えているだけ）
  expect(readFileSync(join(folder, 'loops', 'L01.html'), 'utf8')).toContain('>コメント</button>')
  expect(readFileSync(join(folder, 'loops', 'L01.html'), 'utf8')).toContain('>この施策にコメント</button>')
})

test('［ループを追加］の札は、殻の CONST の LOOP_IDEAS（このプロジェクトの候補）から出す。無ければ汎用の例', async () => {
  await startCurrent()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("button.add-loop")'))?.value).toBe(true)
  // まだ書かれていない：汎用の例
  await inLoops(app, folder, 'document.querySelector("button.add-loop").click(); 1')
  let d = await dialogOf(app)
  await expect(d.getByRole('heading')).toHaveText('ループを追加')
  await expect(d.getByRole('button', { name: '体重を落としたい' })).toBeVisible()
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await expect(d).toHaveCount(0)
  // AI が CONST に書いた：そのプロジェクトの候補だけ
  await inLoops(app, folder, "window.LOOP_IDEAS = ['配当を年10万円にしたい', '含み損の銘柄を減らしたい']; document.querySelector('button.add-loop').click(); 1")
  d = await dialogOf(app)
  await expect(d.locator('.ask-chips button')).toHaveText(['配当を年10万円にしたい', '含み損の銘柄を減らしたい'])
  await expect(d.getByRole('textbox')).toHaveAttribute('placeholder', '例: 配当を年10万円にしたい')
})

test('入力の窓は、空のままでは送れず、Esc・［キャンセル］で閉じると何も送らない', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  const d = (await dialogOf(app))
  await expect(d.getByRole('button', { name: '送る' })).toBeDisabled()
  await (await cardPage(app)).keyboard.press('Escape')
  await expect(d).toHaveCount(0)
  await inLoops(app, folder, 'document.querySelector("#s-list button.cmt").click()')
  await d.getByRole('textbox').fill('送らない')
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await expect(d).toHaveCount(0)
  await win.waitForTimeout(800)
  expect(await received('s-list')()).toHaveLength(0)
})

test('［全ループ更新］［更新］は1回押しただけでは送らず、更新の文を入れた入力の窓を開き、［送る］で送る', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector("button.upd[data-upd=all]").click()')
  const d = await dialogOf(app)
  await expect(d.getByRole('heading')).toHaveText('全ループを更新')
  await expect(d.getByRole('textbox')).toHaveValue('loops/ の全ループを更新して')
  await win.waitForTimeout(800)
  expect(await received('s-list')()).toHaveLength(0)
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-list'), { timeout: 15_000 }).toHaveLength(1)
  // 届く指示文の形は、1回で送っていた頃と同じ
  expect((await received('s-list')())[0]).toBe('受信: ---⏎loop: all⏎section: ALL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  loops/ の全ループを更新して⏎---')

  // ループの頁の［更新］も同じ。書き足した分も届く
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.upd[data-upd=L01]")')).toBe(true)
  await expect.poll(async () => await paneText(app, 's-L01')).toContain('FAKE-AI {')
  await inFrame(app, '/L01.html', 'document.querySelector("button.upd[data-upd=L01]").click()')
  await expect(d.getByRole('heading')).toHaveText('このループを更新')
  await expect(d.getByRole('textbox')).toHaveValue('このループを更新して')
  await (await cardPage(app)).keyboard.type('。売上だけでいい')
  await d.getByRole('button', { name: '送る' }).click()
  await expect.poll(received('s-L01'), { timeout: 15_000 }).toHaveLength(1)
  expect((await received('s-L01')())[0]).toContain('loop: L01⏎section: GOAL⏎rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと⏎task: |⏎  このループを更新して。売上だけでいい⏎---')
})

test('施策の評価の［AIに指示］は、頁の書き方が揺れても「評価中の施策について」の窓を出す（施策名は data-sec の「」→ data-text → 施策の題）', async () => {
  await startCurrent()
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click()')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".record-top > button.record-comment")')).toBe(true)
  const open = async (attrs: string) => {
    await inFrame(app, '/L01.html', `(function(){ var b = document.querySelector("button.record-comment"); ${attrs}; b.click(); return 1 })()`)
    const d = await dialogOf(app)
    await expect(d.getByRole('heading')).toHaveText('評価中の施策について')
    return d
  }
  // 施策名が data-text にある書き方（data-sec は「施策の評価」だけ）
  let d = await open('b.setAttribute("data-sec", "施策の評価"); b.setAttribute("data-text", "台本を1本書く")')
  await expect(d).toContainText('台本を1本書く')
  await expect(d.locator('.ask-chips button')).toHaveText(['評価を見直して', '判定を確定して', 'この認識は違う', 'これは消して'])
  // どの候補も黒く強調しない（2.5.9）
  await expect(d.locator('.ask-chips .btn-primary')).toHaveCount(0)
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await expect(d).toHaveCount(0)
  // どちらにも無ければ、その施策の題（番号の札は除く）
  d = await open('b.setAttribute("data-sec", "施策の評価"); b.removeAttribute("data-text")')
  await expect(d).toContainText('ゲーム枠の上にロック解除ボタンを置く')
  await d.getByRole('button', { name: 'キャンセル' }).click()
  await expect(d).toHaveCount(0)
})
