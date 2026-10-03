import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cardPage, CURRENT, dialogOf, inFrame, inLoops, later, launch, mainWindow, nextFolder, paneText } from './helpers'

let app: ElectronApplication
let win: Page
let root: string

async function start(extraEnv: Record<string, string> = {}, firstRun = false): Promise<void> {
  app = await launch(root, extraEnv, { firstRun })
  win = await mainWindow(app)
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

/** 設定のダイアログを開く。設定はループの画面より上の透明な層に出るので、その層のページを返す */
async function openSettings(): Promise<Page> {
  await win.getByRole('button', { name: '設定' }).click()
  const layer = await cardPage(app)
  await expect(layer.getByRole('dialog', { name: '設定' })).toBeVisible()
  return layer
}

/** 重ねている画面の置き場所。ループの画面と、アプリが出す右のチャットの窓（2.2.0 からの殻） */
const layoutOf = () =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const find = (part: string) => w.contentView.children.find((c) => (c as Electron.WebContentsView).webContents?.getURL().includes(part)) as Electron.WebContentsView | undefined
    const at = (v?: Electron.WebContentsView) => (v ? { visible: v.getVisible(), x: v.getBounds().x, width: v.getBounds().width } : null)
    return { width: w.getContentSize()[0], loops: at(find('/loops/index.html')), chat: at(find('/_rla/chat.html')) }
  })

/** そのチャット（画面ID）が、アプリの右の窓の中にあるか */
const chatInAppPane = (screen: string) =>
  app.evaluate(({ webContents }, screen) => {
    for (const w of webContents.getAllWebContents()) {
      if (w.mainFrame.framesInSubtree.some((f) => f.url.includes('&arg=' + screen))) return w.getURL().includes('/_rla/chat.html')
    }
    return null
  }, screen)

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
  const s = await openSettings()
  await nextFolder(app, other)
  await s.getByRole('button', { name: '選び直す…' }).click()
  // 選んだだけでは切り替えない。［OK］で切り替える
  await expect(s.getByRole('dialog', { name: '設定' })).toContainText(other)
  await expect(win.getByRole('tab', { name: 'other-service' })).toHaveCount(0)
  await s.getByRole('button', { name: 'OK' }).click()
  await expect(win.getByRole('tab', { name: 'other-service' })).toBeVisible()
  await expect(win.getByRole('tab')).toHaveCount(1)
})

test('すべて自動で許可にすると、同じ会話のままチャットを起動し直す', async () => {
  await start()
  await openCurrent()
  await expect.poll(lastArgv).not.toBeNull()
  const before = (await lastArgv())!
  expect(before).not.toContain('--permission-mode')
  const s = await openSettings()
  await s.getByRole('radio', { name: 'すべて自動で許可' }).check()
  await s.getByRole('button', { name: 'OK' }).click()
  await expect.poll(async () => (await lastArgv())?.includes('bypassPermissions')).toBe(true)
  // 会話は同じ
  expect((await lastArgv())![1]).toBe(before[1])
})

test('設定で変えても、［キャンセル］なら何も変えない（チャットも起動し直さない）', async () => {
  await start()
  await openCurrent()
  await expect.poll(lastArgv).not.toBeNull()
  const before = await lastArgv()
  const other = join(root, 'other-service')
  cpSync(resolve('tests/fixtures/versions', CURRENT), other, { recursive: true })
  const s = await openSettings()
  await s.getByRole('radio', { name: 'すべて自動で許可' }).check()
  await s.getByRole('radio', { name: 'Codex' }).check()
  await nextFolder(app, other)
  await s.getByRole('button', { name: '選び直す…' }).click()
  await expect(s.getByRole('dialog', { name: '設定' })).toContainText(other)
  await s.getByRole('button', { name: 'キャンセル' }).click()
  await expect(s.getByRole('dialog', { name: '設定' })).toHaveCount(0)
  await win.waitForTimeout(1500)
  expect(await lastArgv()).toEqual(before)
  await expect(win.getByRole('tab', { name: 'proj' })).toBeVisible()
  // 開き直すと、元の設定のまま
  const s2 = await openSettings()
  await expect(s2.getByRole('radio', { name: '確認する（いつもの設定のまま）' })).toBeChecked()
  await expect(s2.getByRole('radio', { name: 'Claude Code' })).toBeChecked()
})

test('使う AI を Codex にすると、codex の会話で起動し直す', async () => {
  await start()
  await openCurrent()
  await expect.poll(lastArgv).not.toBeNull()
  const s = await openSettings()
  await s.getByRole('radio', { name: 'Codex' }).check()
  await s.getByRole('button', { name: 'OK' }).click()
  await expect.poll(async () => (await lastArgv())?.includes('resume'), { timeout: 15_000 }).toBe(true)
  expect(await lastArgv()).toContain('fake-thread-1')
})

test('プロジェクトを外すときは確認し、［外す］で一覧から消える。フォルダには触れない', async () => {
  await start()
  const folder = await openCurrent('yoga')
  const s = await openSettings()
  await s.getByRole('button', { name: '外す' }).click()
  const d = s.getByRole('dialog', { name: '「yoga」を外しますか？' })
  await expect(d).toContainText('アプリのタブから外すだけで、フォルダの中身には触れません。')
  await d.getByRole('button', { name: '外す' }).click()
  await expect(win.getByRole('tab')).toHaveCount(0)
  // 外したら設定も閉じる（対象のプロジェクトが無くなったので）
  await expect(s.getByRole('dialog', { name: '設定' })).toHaveCount(0)
  expect(existsSync(join(folder, 'loops', 'index.html'))).toBe(true)
})

test('外す確認で［やめる］なら外さない', async () => {
  await start()
  await openCurrent('yoga')
  const s = await openSettings()
  await s.getByRole('button', { name: '外す' }).click()
  await s.getByRole('dialog', { name: '「yoga」を外しますか？' }).getByRole('button', { name: 'やめる' }).click()
  await expect(s.getByRole('dialog', { name: '「yoga」を外しますか？' })).toHaveCount(0)
  // 設定のダイアログは開いたまま。Esc で閉じる
  await expect(s.getByRole('dialog', { name: '設定' })).toBeVisible()
  await s.keyboard.press('Escape')
  await expect(s.getByRole('dialog', { name: '設定' })).toHaveCount(0)
  await expect(win.getByRole('tab', { name: 'yoga' })).toBeVisible()
})

test('AI の状態を出し、ログインしていなければ［ログイン］で公式の手順を動かす', async () => {
  await start({ RLA_FAKE_LOGGED_OUT: '1' })
  const s = await openSettings()
  const claude = s.locator('.ai-row[data-ai="claude"]')
  await expect(claude).toContainText('ログインしていません')
  await expect(claude).toContainText('fake-ai 9.9.9')
  await claude.getByRole('button', { name: 'ログイン' }).click()
  await expect(s.locator('.tool-head')).toContainText('ログインしました', { timeout: 10_000 })
  const out = await s.evaluate(() => {
    const t = (window as unknown as { __rlaToolTerm: { buffer: { active: { length: number; getLine: (i: number) => { translateToString: () => string } } } } }).__rlaToolTerm
    let s = ''
    for (let i = 0; i < t.buffer.active.length; i++) s += t.buffer.active.getLine(i).translateToString() + '\n'
    return s
  })
  expect(out).toContain('LOGIN-FLOW-OK')
})

test('ほかの場所の rising-loop は、版に関係なく［OK］だけでゴミ箱に入れる（［残す］は出さない）', async () => {
  // 1.8 の案内のスキルと、古い名前の loop-manager
  const guide = join(root, 'home', '.claude', 'skills', 'rising-loop')
  mkdirSync(guide, { recursive: true })
  writeFileSync(join(guide, 'SKILL.md'), '---\nname: rising-loop\n---\n')
  writeFileSync(join(guide, 'VERSION'), '1.8.1\n')
  const old = join(root, 'home', '.agents', 'skills', 'old')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'SKILL.md'), '---\nname: loop-manager\n---\n')
  await start()
  const d = await dialogOf(app)
  await expect(d).toContainText('ほかの場所に rising-loop が入っています')
  await expect(d).toContainText(guide)
  await expect(d).toContainText(old)
  await expect(d.getByRole('button', { name: '残す' })).toHaveCount(0)
  await d.getByRole('button', { name: 'OK' }).click()
  await expect(d).toHaveCount(0)
  expect(existsSync(guide)).toBe(false)
  expect(existsSync(old)).toBe(false)
  expect(readdirSync(join(root, 'trash'))).toHaveLength(2)
})

test('前の版で［残す］と答えた記録があっても、また出す', async () => {
  const dir = join(root, 'home', '.claude', 'skills', 'rising-loop')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: rising-loop\n---\n')
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'data', 'app.json'), JSON.stringify({ howtoSeen: true, keepOldSkills: true }))
  await start()
  await expect(await dialogOf(app)).toContainText('ほかの場所に rising-loop が入っています')
})

test('いまの殻では、タブの列に使い方と AI の窓の開閉を出す（使い方は初回だけ自動で開く）', async () => {
  await start({}, true)
  const folder = await openCurrent()
  const howto = (await dialogOf(app))
  await expect(howto).toContainText('ライジング・ループの使い方')
  await howto.getByRole('button', { name: 'OK' }).click()
  // 殻には使い方・開閉のボタンも、右の窓も置かない
  await expect.poll(async () => (await inLoops(app, folder, '!!document.getElementById("howto") || !!document.getElementById("cc-toggle") || !!document.getElementById("cc")'))?.value).toBe(false)
  // 右の窓はアプリが出し、ループの画面はその幅だけ狭まる
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(true)
  let l = await layoutOf()
  expect(l.chat!.width).toBe(360)
  expect(l.chat!.x).toBe(l.width - 360)
  expect(l.loops!.width).toBe(l.width - 360)
  // 開閉はアプリのボタンから
  await win.getByRole('button', { name: 'AI', exact: true, pressed: true }).click()
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(false)
  l = await layoutOf()
  expect(l.loops!.width).toBe(l.width)
  await win.getByRole('button', { name: 'AI', exact: true, pressed: false }).click()
  await expect.poll(async () => (await layoutOf()).loops?.width).toBe(l.width - 360)
  // 使い方は、いつでも開ける（開き直しても自動では開かない）
  await win.getByRole('button', { name: '使い方' }).click()
  await expect((await dialogOf(app))).toContainText(`スキル v${CURRENT}`)
})

test('前の版の殻では、殻が自分のボタンを持つので、アプリは出さない', async () => {
  await start()
  const folder = join(root, 'old')
  cpSync(resolve('tests/fixtures/sample-project'), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect(win.getByRole('button', { name: '使い方' })).toHaveCount(0)
  await expect(win.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0)
  await expect(win.getByRole('button', { name: '設定' })).toBeVisible()
})

test('2.2.0 からの殻では、画面を切り替えると、アプリの右の窓がそのループのチャットになる', async () => {
  await start()
  const folder = await openCurrent()
  await expect.poll(() => paneText(app, 's-list')).not.toBeNull()
  expect(await chatInAppPane('s-list')).toBe(true)
  await inLoops(app, folder, 'location.hash = "#s-L01"; 1')
  await expect.poll(() => paneText(app, 's-L01'), { timeout: 15_000 }).not.toBeNull()
  expect(await chatInAppPane('s-L01')).toBe(true)
})

test('右の窓を閉じていても、指示文が届いたらアプリが開いて送る', async () => {
  await start()
  const folder = await openCurrent()
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(true)
  await win.getByRole('button', { name: 'AI', exact: true, pressed: true }).click()
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(false)
  await inLoops(app, folder, 'navigator.clipboard.writeText("---\\n受け取ってください\\n---"); 1')
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(true)
  await expect(win.getByRole('button', { name: 'AI', exact: true, pressed: true })).toBeVisible()
  await expect.poll(async () => (await paneText(app, 's-list')) ?? '', { timeout: 15_000 }).toContain('受け取ってください')
})

test('2.1.0 の殻は、新しい形にするまで殻の中の右の窓を使う', async () => {
  await start()
  const folder = join(root, 'v21')
  cpSync(resolve('tests/fixtures/versions/2.1.0'), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await later(app)
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("pane-on") && !!document.getElementById("cc")'))?.value).toBe(true)
  await expect.poll(() => paneText(app, 's-list')).not.toBeNull()
  expect(await chatInAppPane('s-list')).toBe(false)
  expect((await layoutOf()).chat).toBeNull()
  await win.getByRole('button', { name: 'AI', exact: true, pressed: true }).click()
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("pane-on")'))?.value).toBe(false)
})

test('2.1.0 から新しい形にすると、殻を入れ替え、台帳の頁の項目（← ループ一覧の行き先）だけを AI に送り、チャットはアプリの窓に移る', async () => {
  await start()
  const folder = join(root, 'v21')
  cpSync(resolve('tests/fixtures/versions/2.1.0'), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await (await dialogOf(app)).getByRole('button', { name: '新しい形にする' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.getElementById("cc")'))?.value).toBe(false)
  await expect.poll(() => chatInAppPane('s-list'), { timeout: 15_000 }).toBe(true)
  await expect.poll(async () => (await paneText(app, 's-list')) ?? '', { timeout: 15_000 }).toContain('新しい形への作り直し')
  const text = ((await paneText(app, 's-list')) ?? '').replace(/\n/g, '')
  expect(text).toContain('2.3.1-back-link')
  expect(text).not.toContain('2.0.0-page-ver')
})

test('ループの頁の「← ループ一覧」で戻ると、一覧はいちばん上から出て、読み込み直してもずれない', async () => {
  await start()
  const folder = join(root, 'tall')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  // 一覧を長くして、スクロールできるようにする
  const index = join(folder, 'loops', 'index.html')
  writeFileSync(index, readFileSync(index, 'utf8').replace('<!-- LOOPS:END -->', '<div style="height:3000px"></div><!-- LOOPS:END -->'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.back")')).toBe(true)
  await inFrame(app, '/L01.html', 'document.querySelector("button.back").click(); 1')
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("in-loop")'))?.value).toBe(false)
  expect((await inLoops(app, folder, '[location.hash, scrollY]'))?.value).toEqual(['', 0])
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((c) => c.getURL().includes('/tall/loops/index.html'))!.reload())
  await expect.poll(async () => (await inLoops(app, folder, 'document.readyState'))?.value).toBe('complete')
  await win.waitForTimeout(500)
  // 1px 未満の端数（表示の倍率による）は、ずれとみなさない
  expect((await inLoops(app, folder, 'scrollY'))?.value).toBeLessThan(1)
})

test('戻る・進むは、そのタブのループの画面の中だけで移る（履歴はタブごと）', async () => {
  await start()
  const a = await openCurrent('proj-a')
  const back = win.getByRole('button', { name: '戻る' })
  const forward = win.getByRole('button', { name: '進む' })
  const screen = async (f: string) => (await inLoops(app, f, 'document.body.classList.contains("in-loop") ? location.hash : "一覧"'))?.value
  await expect.poll(() => screen(a)).toBe('一覧')
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()
  // 人が押したときと同じく、押した操作として動かす（操作なしに積んだ履歴は、Chromium が戻るで飛ばす）
  await app.evaluate(async ({ webContents }, f) => {
    const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith('file://' + encodeURI(f)))!
    await w.executeJavaScript('document.querySelector(\'[data-go="s-L01"]\').click(); 1', true)
  }, join(a, 'loops', 'index.html'))
  await expect.poll(() => screen(a)).toBe('#s-L01')
  await expect(back).toBeEnabled()
  await back.click()
  await expect.poll(() => screen(a)).toBe('一覧')
  await expect(forward).toBeEnabled()
  // 別のタブは、自分の履歴だけを持つ
  await openCurrent('proj-b')
  await expect(win.getByRole('tab', { name: 'proj-b' })).toHaveAttribute('aria-selected', 'true')
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()
  // 元のタブに戻ると、そのタブの続きから進める
  await win.getByRole('tab', { name: 'proj-a' }).click()
  await expect(forward).toBeEnabled()
  await forward.click()
  await expect.poll(() => screen(a)).toBe('#s-L01')
  await expect(forward).toBeDisabled()
})

test('ループを行き来してから戻ると、来た順のとおりに画面が戻る（頁の枠が履歴で勝手に戻らない）', async () => {
  await start()
  const folder = join(root, 'proj-hist')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  cpSync(join(folder, 'loops', 'L01.html'), join(folder, 'loops', 'L02.html'))
  const index = join(folder, 'loops', 'index.html')
  // 一覧に L02 の行を足す（L01 の行を写して行き先だけ変える）
  writeFileSync(index, readFileSync(index, 'utf8').replace('<!-- LOOPS:END -->', '<button data-go="s-L02">L02</button><!-- LOOPS:END -->'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L02"]\')'))?.value).toBe(true)
  // 人が押したときと同じく、押した操作として動かす（殻の行・頁の「← ループ一覧」）
  const press = (code: string, inPage: boolean) =>
    app.evaluate(
      async ({ webContents }, { url, code, inPage }) => {
        const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!
        const f = inPage ? w.mainFrame.framesInSubtree.find((x) => x !== w.mainFrame && x.url.startsWith('file:'))! : w.mainFrame
        await f.executeJavaScript(code, true)
      },
      { url: 'file://' + encodeURI(index), code, inPage }
    )
  const shown = async () => (await inLoops(app, folder, 'document.body.classList.contains("in-loop") ? document.getElementById("loop-frame").contentWindow.location.pathname.split("/").pop() : "一覧"'))?.value
  const go = async (code: string, inPage: boolean, want: string) => {
    await press(code, inPage)
    await expect.poll(shown).toBe(want)
    // 頁が読み終わるのを待つ（次に頁の「← ループ一覧」を押すため）
    if (want !== '一覧') await expect.poll(() => inFrame(app, '/' + want, '!!document.querySelector("button.back")')).toBe(true)
  }
  const toList = 'document.querySelector("button.back").click(); 1'
  await go('document.querySelector(\'[data-go="s-L01"]\').click(); 1', false, 'L01.html')
  await go(toList, true, '一覧')
  await go('document.querySelector(\'[data-go="s-L02"]\').click(); 1', false, 'L02.html')
  await go(toList, true, '一覧')
  await go('document.querySelector(\'[data-go="s-L01"]\').click(); 1', false, 'L01.html')
  const back = win.getByRole('button', { name: '戻る' })
  for (const want of ['一覧', 'L02.html', '一覧', 'L01.html', '一覧']) {
    await back.click()
    await expect.poll(shown).toBe(want)
  }
  await expect(back).toBeDisabled()
})

test('Chrome・Safari と同じキーで戻る・進む。右のチャットの窓では効かない', async () => {
  await start()
  const folder = await openCurrent('proj-key')
  const index = join(folder, 'loops', 'index.html')
  const screen = async () => (await inLoops(app, folder, 'document.body.classList.contains("in-loop") ? location.hash : "一覧"'))?.value
  await expect.poll(screen).toBe('一覧')
  await expect.poll(() => paneText(app, 's-list')).not.toBeNull()
  await app.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!.executeJavaScript('document.querySelector(\'[data-go="s-L01"]\').click(); 1', true)
  }, 'file://' + encodeURI(index))
  await expect.poll(screen).toBe('#s-L01')
  // Mac は ⌘[ ⌘]、ほかは Alt+← Alt+→
  const mac = process.platform === 'darwin'
  const press = (where: 'loops' | 'chat' | 'app', dir: -1 | 1) =>
    app.evaluate(
      ({ webContents, BrowserWindow }, { where, url, keyCode, modifiers }) => {
        const all = webContents.getAllWebContents()
        const w =
          where === 'loops' ? all.find((c) => c.getURL().startsWith(url))! : where === 'chat' ? all.find((c) => c.getURL().includes('/_rla/chat.html'))! : BrowserWindow.getAllWindows()[0].webContents
        w.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        w.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      },
      { where, url: 'file://' + encodeURI(index), keyCode: mac ? (dir < 0 ? '[' : ']') : dir < 0 ? 'Left' : 'Right', modifiers: (mac ? ['meta'] : ['alt']) as ('meta' | 'alt')[] }
    )
  // チャットの窓では効かない
  await press('chat', -1)
  await win.waitForTimeout(500)
  expect(await screen()).toBe('#s-L01')
  // ループの画面で戻る、タブの列で進む
  await press('loops', -1)
  await expect.poll(screen).toBe('一覧')
  await press('app', 1)
  await expect.poll(screen).toBe('#s-L01')
})

test('Mac の戻る・進むのスワイプ（マウスの戻る・進むボタンもこの合図で届く）で、いまのタブを戻る・進む', async () => {
  await start()
  const folder = await openCurrent('proj-swipe')
  const index = join(folder, 'loops', 'index.html')
  const screen = async () => (await inLoops(app, folder, 'document.body.classList.contains("in-loop") ? location.hash : "一覧"'))?.value
  await expect.poll(screen).toBe('一覧')
  await app.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!.executeJavaScript('document.querySelector(\'[data-go="s-L01"]\').click(); 1', true)
  }, 'file://' + encodeURI(index))
  await expect.poll(screen).toBe('#s-L01')
  // 一覧 → L01 → 一覧 → L01 と移っておく（戻るが何回効いたか見分けるため）
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.back")')).toBe(true)
  await app.evaluate(async ({ webContents }, url) => {
    const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!
    await w.mainFrame.framesInSubtree.find((f) => f.url.includes('/L01.html'))!.executeJavaScript('document.querySelector("button.back").click(); 1', true)
  }, 'file://' + encodeURI(index))
  await expect.poll(screen).toBe('一覧')
  await app.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!.executeJavaScript('document.querySelector(\'[data-go="s-L01"]\').click(); 1', true)
  }, 'file://' + encodeURI(index))
  await expect.poll(screen).toBe('#s-L01')
  const swipe = (dir: string, times: number) =>
    app.evaluate(({ BrowserWindow }, { dir, times }) => {
      const w = BrowserWindow.getAllWindows()[0]
      for (let i = 0; i < times; i++) w.emit('swipe', {}, dir)
    }, { dir, times })
  // 1回押すと続けて何回も届く。何回来ても1回だけ戻る
  await swipe('left', 3)
  await expect.poll(screen).toBe('一覧')
  // 3回戻っていれば最初の一覧で、もう戻れない。1回だけなので、まだ戻れる
  await win.waitForTimeout(500)
  await expect(win.getByRole('button', { name: '戻る' })).toBeEnabled()
  await expect(win.getByRole('button', { name: '進む' })).toBeEnabled()
  await win.waitForTimeout(500)
  await swipe('right', 3)
  await expect.poll(screen).toBe('#s-L01')
  await expect(win.getByRole('button', { name: '進む' })).toBeDisabled()
})

test('設定はダイアログで、開いているあいだも後ろのループの画面とチャットを隠さない', async () => {
  await start()
  await openCurrent('proj-behind')
  await expect.poll(async () => (await layoutOf()).chat?.visible).toBe(true)
  await openSettings()
  const l = await layoutOf()
  expect(l.loops?.visible).toBe(true)
  expect(l.chat?.visible).toBe(true)
})

test('ループの画面からリンクを開くと、新しいウィンドウは 1024×680 で開く', async () => {
  await start()
  const folder = await openCurrent('proj-link')
  await expect.poll(async () => (await inLoops(app, folder, '!!document.body'))?.value).toBe(true)
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await app.evaluate(async ({ webContents }, url) => {
    await webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!.executeJavaScript('window.open("about:blank#link", "_blank"); 1', true)
  }, 'file://' + encodeURI(join(folder, 'loops', 'index.html')))
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(before + 1)
  const size = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#link'))!
    return w.getSize()
  })
  expect(size).toEqual([1024, 680])
})

test('LOG のタイトルを押すと、頁の中に広げずに LOG の md を別ウィンドウで開く', async () => {
  await start()
  const folder = await openCurrent('proj-log')
  const index = join(folder, 'loops', 'index.html')
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".record-log a")')).toBe(true)
  // 頁の中には広げない（折りたたみ・中の枠が無い）
  expect(await inFrame(app, '/L01.html', '!!document.querySelector("details.record-log, .record-log iframe")')).toBe(false)
  await app.evaluate(async ({ webContents }, url) => {
    const w = webContents.getAllWebContents().find((c) => c.getURL().startsWith(url))!
    await w.mainFrame.framesInSubtree.find((f) => f.url.includes('/L01.html'))!.executeJavaScript('document.querySelector(".record-log a").click(); 1', true)
  }, 'file://' + encodeURI(index))
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('/loops/logs/L01.md'))))
    .toBe(true)
})

test('頁の見出しは、そのセクションのあいだ上に貼り付き、上に色の線を出す。「← 一覧へ」と重なるときだけ、重なる分だけ文字をずらす（一覧の見出しも貼り付く）', async () => {
  await start()
  const folder = join(root, 'proj-sticky')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  // 一覧の見出し（LOOPS）も貼り付く（一覧には「← 一覧へ」が無いので、ずらさない）。一覧を長くしてスクロールできるようにする
  await inLoops(app, folder, 'document.querySelector(".section.t-loops").insertAdjacentHTML("beforeend", "<div style=\\"height:3000px\\"></div>"); 1')
  const list = () =>
    inLoops(app, folder, `(function(){ var t = document.querySelector(".section.t-loops .sec-tab"); return [getComputedStyle(t).position, t.classList.contains("stuck"), Math.round(t.getBoundingClientRect().top) <= 4, getComputedStyle(t.querySelector(".k")).marginLeft] })()`).then((r) => r?.value)
  await inLoops(app, folder, 'scrollTo(0, document.querySelector(".section.t-loops").offsetTop + 300); 1')
  await expect.poll(list).toEqual(['sticky', true, true, '0px'])
  await inLoops(app, folder, 'scrollTo(0, 0); 1')
  await expect.poll(list).toEqual(['sticky', false, false, '0px'])
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.back")')).toBe(true)
  // GOAL の見出しの様子：[貼り付いているか, 上に止まっているか, 線の幅がセクションと同じか, ずらした幅, ボタンの右端から文字までの間]
  const goal = () =>
    inFrame(
      app,
      '/L01.html',
      `(function(){
        var t = document.querySelector(".section.t-goal .sec-tab"), sec = t.parentElement.getBoundingClientRect(), line = getComputedStyle(t, "::after")
        var k = t.querySelector(".k"), back = document.querySelector("button.back").getBoundingClientRect()
        return [t.classList.contains("stuck"), Math.round(t.getBoundingClientRect().top) <= 4, line.content !== "none" && Math.round(parseFloat(line.width)) === Math.round(sec.width), parseFloat(getComputedStyle(k).marginLeft), Math.round(k.getBoundingClientRect().left - back.right)]
      })()`
    ) as Promise<[boolean, boolean, boolean, number, number]>
  const scrollIntoGoal = () => inFrame(app, '/L01.html', 'scrollTo(0, document.querySelector(".section.t-goal").offsetTop + 300); 1')
  await expect.poll(async () => (await goal()).slice(0, 4)).toEqual([false, false, false, 0])
  // 広い画面：本体が中央寄りでボタンと重ならないので、貼り付いてもずらさない
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(2400, 900))
  await scrollIntoGoal()
  await expect.poll(async () => { const g = await goal(); return [g[0], g[1], g[2], g[3], g[4] >= 12] }).toEqual([true, true, true, 0, true])
  // 狭い画面：重なる分だけずらし、ボタンの右端から 12px 空ける
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 700))
  await inFrame(app, '/L01.html', 'scrollBy(0, 1); 1')
  // ボタンの右端は小数なので、切り上げの分の 1px は許す
  await expect.poll(async () => { const g = await goal(); return [g[0], g[3] > 0, g[4] >= 12 && g[4] <= 13] }).toEqual([true, true, true])
  // 先頭に戻すと元どおり
  await inFrame(app, '/L01.html', 'scrollTo(0, 0); 1')
  await expect.poll(async () => (await goal()).slice(0, 4)).toEqual([false, false, false, 0])
})

test('頁の「← 一覧へ」は左上に浮かび、頁をスクロールしても動かず、押すと一覧に戻る', async () => {
  await start()
  const folder = join(root, 'proj-back')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  // 頁を長くして、スクロールできるようにする
  const l01 = join(folder, 'loops', 'L01.html')
  writeFileSync(l01, readFileSync(l01, 'utf8').replace('</body>', '<div style="height:3000px"></div></body>'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector("button.back")')).toBe(true)
  // 頁を開いた直後から毎コマ測り、見えているあいだは必ず左上にあること（頁が出る動きのあいだは見せない）
  const shown = (await inFrame(
    app,
    '/L01.html',
    `new Promise(function (done) {
      var out = [], t0 = performance.now()
      ;(function tick() {
        var b = document.querySelector("button.back"), r = b.getBoundingClientRect()
        out.push([+getComputedStyle(b).opacity, Math.round(r.left), Math.round(r.top)])
        if (performance.now() - t0 < 900) requestAnimationFrame(tick); else done(out)
      })()
    })`
  )) as [number, number, number][]
  const visible = shown.filter(([o]) => o > 0.01)
  // 上下にはずれない（頁の枠を基準にずれた位置に出ない）。左から滑り込み（行き過ぎて戻る分のわずかな右は許す）、止まったら左上
  expect(visible.every(([, l, t]) => t === 12 && l <= 12 + 10)).toBe(true)
  expect(visible.some(([, l]) => l < 12)).toBe(true)
  expect(shown[shown.length - 1]).toEqual([1, 12, 12])
  const where = () => inFrame(app, '/L01.html', '(function(){ var b = document.querySelector("button.back").getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), scrollY > 0] })()')
  expect(await inFrame(app, '/L01.html', 'document.querySelector("button.back").textContent')).toBe('←一覧へ')
  await expect.poll(where).toEqual([12, 12, false])
  await inFrame(app, '/L01.html', 'scrollTo(0, 800); 1')
  await expect.poll(where).toEqual([12, 12, true])
  await inFrame(app, '/L01.html', 'document.querySelector("button.back").click(); 1')
  await expect.poll(async () => (await inLoops(app, folder, 'document.body.classList.contains("in-loop")'))?.value).toBe(false)
})

test('チャットの AI が作業中のあいだ、一覧のその行（と一覧の見出しの枠）の右上の角に「AI作業中」を重ねて出し、終われば消す', async () => {
  await start()
  const folder = await openCurrent('proj-busy')
  const pill = (sel: string) => async () => (await inLoops(app, folder, `(function(){ var p = document.querySelector(${JSON.stringify(sel)}); return p ? p.textContent : '' })()`))?.value
  // 一覧のチャットが起動して出力しているあいだは、見出しの枠の右上に出る。止まって 2 秒たつと消える
  await expect.poll(pill('#s-list .section > .ai-busy-pill')).toBe('AI作業中')
  await expect.poll(pill('#s-list .section > .ai-busy-pill'), { timeout: 15_000 }).toBe('')
  const row = '#s-list [data-go="s-L01"]'
  const nameAt = async () => (await inLoops(app, folder, `(function(){ var r = document.querySelector('${row} .loop-name').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.height)] })()`))?.value
  const before = await nameAt()
  // L01 のチャットを起こしてから一覧に戻ると、L01 の行の右上の角に出る
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(async () => (await paneText(app, 's-L01')) ?? '').toContain('FAKE-AI {')
  await inLoops(app, folder, 'location.hash = ""; 1')
  await expect.poll(pill(`${row} > .ai-busy-pill`)).toBe('AI作業中')
  const corner = (await inLoops(
    app,
    folder,
    `(function(){ var r = document.querySelector('${row}').getBoundingClientRect(), p = document.querySelector('${row} > .ai-busy-pill').getBoundingClientRect(); return [Math.round(r.right - p.right), Math.round(p.top - r.top)] })()`
  ))?.value
  expect(corner).toEqual([10, 8])
  // 重ねて出すので、ループ名の位置は札があってもなくても同じ
  expect(await nameAt()).toEqual(before)
  expect(await pill('#s-list .section > .ai-busy-pill')()).toBe('')
  await expect.poll(pill(`${row} > .ai-busy-pill`), { timeout: 15_000 }).toBe('')
})
