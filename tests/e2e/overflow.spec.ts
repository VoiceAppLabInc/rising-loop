import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { CURRENT, inFrame, inLoops, launch, mainWindow, nextFolder } from './helpers'

// 右のチャットを広げて頁が狭くなっても、日数の多い棒グラフ（ゴールの図 .rl-hist・施策の評価の図 .record-viz）で
// 頁全体に横のスクロールバーが出ない（はみ出した分はグラフの枠の中だけで横にスクロールする。2.5.3）
let app: ElectronApplication
let root: string

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

test('日数の多い棒グラフがあっても、狭い頁に横のスクロールバーが出ない', async () => {
  root = mkdtempSync(join(tmpdir(), 'rla-overflow-'))
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  app = await launch(root)
  const win = await mainWindow(app)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 800))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'[data-go="s-L01"]\').click(); 1')
  await expect.poll(() => inFrame(app, '/L01.html', '!!document.querySelector(".record-viz")')).toBe(true)
  // 40日ぶんの棒（数字つき）を、施策の評価の図とゴールの図の形で頁に足す
  await inFrame(
    app,
    '/L01.html',
    `(function(){
      var cols = '', labels = ''
      for (var i = 0; i < 40; i++) { cols += '<div class="rv-col"><b>1,234</b><i style="height:50%"></i></div>'; labels += '<span>10/' + (i + 1) + '</span>' }
      var bars = '<div class="rv-bars">' + cols + '</div><div class="rv-labels">' + labels + '</div>'
      document.querySelector('.record-viz').insertAdjacentHTML('beforeend', bars)
      document.querySelector('.section.t-goal').insertAdjacentHTML('beforeend', '<div class="rl rl-hist">' + bars + '</div>')
      return 1 })()`
  )
  // 頁の幅を 700px ほどにする（チャットを広げたときの狭さ）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1060, 800))
  const fits = () => inFrame(app, '/L01.html', 'document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')
  await expect.poll(fits).toBe(true)
  // グラフの枠の中では横にスクロールできる
  expect(await inFrame(app, '/L01.html', '(function(){ var v = document.querySelector(".record-viz"), h = document.querySelector(".rl.rl-hist"); return v.scrollWidth > v.clientWidth && h.scrollWidth > h.clientWidth })()')).toBe(true)
})
