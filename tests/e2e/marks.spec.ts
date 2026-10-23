import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { CURRENT, inFrame, inLoops, launch, mainWindow, nextFolder } from './helpers'

// ゴールの棒＋線（2.5.16）：30日ぶんまで並べ、入りきらなければ横にスクロールして右端から見せる。
// 日付の下に施策の ID を置き、乗せると施策の流れと同じ札が出て、押すとその施策へ飛ぶ
let app: ElectronApplication
let root: string

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('棒＋線は右端から見え、日付の下の施策の ID から施策へ飛べる', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-marks-'))
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".hist-chart svg")')).toBe(true)

  // 実施日（records[].done 9/2）と開始日（trials[].started 9/7）の日付の下に ID が出る
  expect(await inFrame(app, '/L01.html', '[].map.call(document.querySelectorAll(".rl-tid"), function(a){ return a.textContent }).join(",")')).toBe('T01,T06')

  // 30日ぶんにして描き直すと、横にスクロールでき、右端（いちばん新しい日）が見えている
  await inFrame(app, '/L01.html', `(function(){
    var d = LOOP_DATA.hist, base = new Date(2026, 7, 9); d.days = []; d.line = [];
    for (var i = 0; i < 30; i++) {
      var t = new Date(base); t.setDate(base.getDate() + i); var k = (t.getMonth() + 1) + '/' + t.getDate();
      d.days.push({ d: k, v: 100 + i * 7, partial: i === 29 }); if (i < 29) d.line.push({ d: k, v: 500 + i * 40 });
    }
    d.points[d.points.length - 1].end = d.days[28].d;
    window.LOOP_REDRAWS.forEach(function(f){ f() }); return 1 })()`)
  expect(await inFrame(app, '/L01.html', 'document.querySelectorAll(".hist-chart rect.bar").length')).toBe(30)
  expect(await inFrame(app, '/L01.html', `(function(){ var s = document.querySelector(".rl-scroll");
    return s.scrollWidth > s.clientWidth && s.scrollLeft >= s.scrollWidth - s.clientWidth - 1 })()`)).toBe(true)

  // ID にマウスが乗ると、施策の流れと同じ札（評価・日付・短い名前）が出る
  const pop = () => inFrame(app, '/L01.html', `(function(){ var p = document.querySelector('.rl-pop'); return p && !p.hidden ? p.textContent : null })()`)
  // （頁が読み込み直後に描き直すことがあるので、乗せてから読むまでを1回でやって待つ）
  const hover = () => inFrame(app, '/L01.html', `(function(){ document.querySelector('.rl-tid').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    var p = document.querySelector('.rl-pop'); return p && !p.hidden ? p.textContent : null })()`)
  await expect.poll(hover).toBe('9/2短い名前')
  expect(await inFrame(app, '/L01.html', `document.querySelector('.rl-pop .rl-mark').getAttribute('data-g')`)).toBe('B')
  // 横にスクロールしたら消える（札が指している ID が動く）
  await inFrame(app, '/L01.html', `document.querySelector('.rl-scroll').dispatchEvent(new Event('scroll')); 1`)
  expect(await pop()).toBeNull()

  // 札を押すと、その施策（RECORD の T01）が画面に入る
  await inFrame(app, '/L01.html', `document.querySelector('.rl-tid').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })); document.querySelector('.rl-pop .rl-mark').click(); 1`)
  await expect.poll(() => inFrame(app, '/L01.html', `(function(){ var r = document.getElementById('record-L01-T01').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight })()`)).toBe(true)
  expect(await pop()).toBeNull()

  // 指では、1回目は札を出すだけ（飛ばない）。同じ ID をもう1回押すと飛ぶ
  // （前の飛び先へのなめらかなスクロールが止まってから、上に戻す）
  await expect.poll(() => inFrame(app, '/L01.html', `(function(){ var y = scrollY; scrollTo({ top: 0, behavior: 'instant' }); return y === 0 })()`)).toBe(true)
  await inFrame(app, '/L01.html', `document.querySelectorAll('.rl-tid')[1].click(); 1`)
  expect(await pop()).toBe('9/7短い名前')
  expect(await inFrame(app, '/L01.html', 'scrollY')).toBe(0)
  await inFrame(app, '/L01.html', `document.querySelectorAll('.rl-tid')[1].click(); 1`)
  await expect.poll(() => inFrame(app, '/L01.html', `(function(){ var r = document.getElementById('trial-L01-T06').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight })()`)).toBe(true)
})

// 図を端まで横にスクロールしたあとの指の残りの動きで、頁が戻っていた（2026-10-23。Mac の2本指の横スクロールは「戻る・進む」の合図にもなる）
test('横にスクロールできる図の上では、端まで来ていても2本指の横の動きで頁が戻らない', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-marks-'))
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".hist-chart svg")')).toBe(true)
  // 30日ぶんにして、図をいちばん左（端）までスクロールしておく
  await inFrame(app, '/L01.html', `(function(){
    var d = LOOP_DATA.hist, base = new Date(2026, 7, 9); d.days = []; d.line = [];
    for (var i = 0; i < 30; i++) {
      var t = new Date(base); t.setDate(base.getDate() + i); var k = (t.getMonth() + 1) + '/' + t.getDate();
      d.days.push({ d: k, v: 100 + i * 7 }); d.line.push({ d: k, v: 500 + i * 40 });
    }
    d.points[d.points.length - 1].end = d.days[29].d;
    window.LOOP_REDRAWS.forEach(function(f){ f() }); document.querySelector('.rl-scroll').scrollLeft = 0; return 1 })()`)
  expect(await inFrame(app, '/L01.html', 'document.querySelector(".rl-scroll").scrollLeft')).toBe(0)
  // 頁からアプリへ届く「戻る・進む」の合図（nav:swipe）を数える
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __swipes: number[] }
    g.__swipes = []
    ipcMain.on('nav:swipe', (_e, d: number) => g.__swipes.push(d))
  })
  // 図の上で、右へ払う（戻る向き）横の動きを、ひと払いぶん続けて送る
  await inFrame(app, '/L01.html', `(function(){ var t = document.querySelector('.hist-chart svg');
    for (var i = 0; i < 10; i++) t.dispatchEvent(new WheelEvent('wheel', { deltaX: -100, bubbles: true })); return 1 })()`)
  await new Promise((r) => setTimeout(r, 600))
  // 戻る合図は出ない（図の中の横の動きは、図のスクロールのもの）
  expect(await app.evaluate(() => (globalThis as unknown as { __swipes: number[] }).__swipes)).toEqual([])
})
