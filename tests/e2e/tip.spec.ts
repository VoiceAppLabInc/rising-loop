import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { CURRENT, inFrame, inLoops, launch, mainWindow, nextFolder } from './helpers'

// 図の札（マウスを乗せると出る。2.5.12）が、マウスが離れたあとに残らない。
// 上のゲージの札が、下の棒グラフの上に残ったことがある（2026-10-16。2.5.14 で直した）
let app: ElectronApplication
let root: string

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

/** 頁の要素の上でマウスを動かしたことにして、いま出ている札の文字を返す（出ていなければ null） */
const moveTo = (sel: string) =>
  inFrame(
    app,
    '/L01.html',
    `(function(){
      document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 200 }))
      var t = document.querySelector('.rl-tip'); return t && !t.hidden ? t.textContent : null })()`
  )

test('札は、持ち主の外に出たら・スクロールしたら消える', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-tip-'))
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".rl-bullet .tr[data-tip]") && !!document.querySelector(".hist-chart svg")')).toBe(true)

  // 棒グラフを分母つき（自分で札を出す図）にして描き直す。起きたのはこの図の上
  await inFrame(app, '/L01.html', `(function(){ LOOP_DATA.hist.days.forEach(function(d){ d.of = 3 }); window.LOOP_REDRAWS.forEach(function(f){ f() }); return 1 })()`)
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".hist-chart svg rect.of")')).toBe(true)
  // ゲージの上では、目標までの残りを出す
  expect(await moveTo('.rl-bullet .tr')).toContain('目標まで')
  // 下の棒グラフ（自分で札を出す図）の上に移ったら、ゲージの札は消える
  expect(await moveTo('.hist-chart svg text.xl')).toBeNull()
  // スクロールしたら消える
  expect(await moveTo('.rl-bullet .tr')).toContain('目標まで')
  expect(await inFrame(app, '/L01.html', `(function(){ window.dispatchEvent(new Event('scroll')); document.dispatchEvent(new Event('scroll')); var t = document.querySelector('.rl-tip'); return t.hidden })()`)).toBe(true)
  // 窓の外へ出たら消える
  expect(await moveTo('.rl-bullet .tr')).toContain('目標まで')
  expect(await inFrame(app, '/L01.html', `(function(){ document.dispatchEvent(new MouseEvent('mouseleave')); return document.querySelector('.rl-tip').hidden })()`)).toBe(true)
})

test('一覧の札は、ループの頁へ移ったら・頁（iframe）の上に移ったら消える', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-tip-'))
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(".loop-row .rl-bullet .tr[data-tip]")'))?.value).toBe(true)
  /** 一覧（殻）の要素に、マウスが入った・動いたことにして、いま出ている札の文字を返す */
  const shellMove = async (sel: string, type = 'pointermove') =>
    (
      await inLoops(
        app,
        folder,
        `(function(){
          document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, clientX: 200, clientY: 200 }))
          var t = document.querySelector('.rl-tip'); return t && !t.hidden ? t.textContent : null })()`
      )
    )?.value

  // 一覧の行のゲージの札を出してから、そのループの頁へ移ると消える（動画で残っていた）
  expect(await shellMove('.loop-row .rl-bullet .tr')).toContain('目標まで')
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(async () => (await inLoops(app, folder, `(function(){ var t = document.querySelector('.rl-tip'); return !t || t.hidden })()`))?.value).toBe(true)
  // ループの頁（iframe）の上に入ったら消える（そこから先の動きは殻に届かない）
  await inLoops(app, folder, 'location.hash = "#s-list"; 1')
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector("#s-list.active")'))?.value).toBe(true)
  expect(await shellMove('.loop-row .rl-bullet .tr')).toContain('目標まで')
  expect(await inLoops(app, folder, `(function(){
    var f = document.getElementById('loop-frame') || document.body
    f.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 300, clientY: 300 }))
    return document.querySelector('.rl-tip').hidden })()`).then((r) => r?.value)).toBe(true)
})
