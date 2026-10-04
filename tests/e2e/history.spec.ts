import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { CURRENT, inFrame, inLoops, launch, mainWindow, nextFolder } from './helpers'

// 一覧の「HISTORY 施策の流れ」。loops/history.js（loops/update/history.py が書く）から rising.js が描く
let app: ElectronApplication
let win: Page
let root: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-history-'))
})

test.afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

/** いまの版の見本に history.js を置いて開く（見本の L01 には評価の T01 と、実行中の T06・T07 がある） */
async function openWith(history: unknown | null): Promise<string> {
  app = await launch(root)
  win = await mainWindow(app)
  const folder = join(root, 'proj')
  cpSync(resolve('tests/fixtures/versions', CURRENT), folder, { recursive: true })
  if (history) writeFileSync(join(folder, 'loops', 'history.js'), `window.HISTORY_DATA = ${JSON.stringify(history)};\n`)
  // 見本の頁は窓より短くスクロールしないので、施策の前後に空きを入れて長くする（飛んだ先が上に来るかを見るため）
  const page = join(folder, 'loops', 'L01.html')
  const pad = '<div style="height:2000px"></div>'
  writeFileSync(page, readFileSync(page, 'utf8').replace('<div class="trial" id="trial-L01-T06">', pad + '$&').replace('<div class="record-set"', pad + '$&').replace('<script>', pad + '$&'))
  await nextFolder(app, folder)
  await win.getByRole('button', { name: 'フォルダを開く…' }).click()
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(\'[data-go="s-L01"]\')'))?.value).toBe(true)
  return folder
}

const DATA = {
  generated: '2026-09-28',
  loops: [
    {
      id: 'L01',
      name: '券の売上',
      unit: '円',
      lowerBetter: false,
      now: 2000,
      nowAt: '2026-09-28',
      bottlenecks: [
        { from: '2026-08-30', text: '250円かかると思われている', a: null, b: null },
        { from: '2026-09-06', text: '決済シートで止まる', a: { at: '2026-09-06', value: 1750 }, b: { at: '2026-09-20', value: 1000 } },
        { from: '2026-09-20', text: '払う直前で止まる', a: { at: '2026-09-20', value: 1000 }, b: { at: '2026-09-28', value: 2000 } }
      ],
      trials: [
        { id: 'T01', date: '2026-09-02', short: 'ボタンを1か所に', grade: 'B', at: 'record' },
        { id: 'T06', date: '2026-09-10', short: '翌日もう一度', grade: '-', at: 'trial' },
        { id: 'T07', date: '2026-09-23', short: '値札を出す', grade: '-', at: 'trial' }
      ]
    }
  ]
}

test('ループ一覧の下に、上から「ボトルネックの箱 → その期間の施策の札 → 矢印 → 次の箱 … → 現在」の順で出す', async () => {
  const folder = await openWith(DATA)
  const look = await inLoops(
    app,
    folder,
    `(function(){
      var sec = document.querySelector(".section.t-history");
      if (!sec) return null;
      return {
        after: sec.previousElementSibling.classList.contains("t-loops"),
        tab: sec.querySelector(".sec-tab").textContent,
        legend: [].map.call(sec.querySelectorAll(".hs-legend .hs-tp"), function(t){ return t.getAttribute("data-g") + " " + t.textContent }),
        flow: [].map.call(sec.querySelector(".hs-loop").children, function(e){
          if (e.classList.contains("hs-h")) return "見出し";
          if (e.classList.contains("hs-ts")) return "↓ " + [].map.call(e.querySelectorAll(".hs-tp"), function(t){ return t.getAttribute("data-g") + " " + t.textContent }).join(" / ");
          var n = e.querySelector(".hs-num"), b = n.querySelector("b");
          return e.firstChild.textContent + " | " + (n.classList.contains("off") ? "計測前" : (b.className ? b.className + " " : "") + b.textContent + " " + n.querySelector("small").textContent);
        })
      }
    })()`
  )
  expect(look?.value).toEqual({
    after: true,
    tab: 'HISTORY施策の流れ',
    legend: ['A・B 狙いに届いた', 'C 半分', 'D・E 届かなかった', '- まだ（いまやっている）'],
    // 箱の右は終わりの数字と向き（1750 → 1000 は悪くなった dn、1000 → 2000 は良くなった up）。点が無ければ計測前。施策の無い期間は矢印だけ
    flow: [
      '見出し',
      '250円かかると思われている | 計測前',
      '↓ B 9/2ボタンを1か所に',
      '決済シートで止まる | dn 1,000 円 ・ 9/6〜9/20',
      '↓ - 9/10翌日もう一度',
      '払う直前で止まる | up 2,000 円 ・ 9/20〜9/28',
      '↓ - 9/23値札を出す',
      '現在 | 2,000 円 ・ 9/28'
    ]
  })
})

test('ボトルネックの記録が無いループも落とさず、記録なしの箱1つの下に施策を並べる', async () => {
  const plain = { id: 'L02', name: '広告売上', unit: '円', lowerBetter: false, now: 0.25, nowAt: '2026-09-28', bottlenecks: [], period: { a: { at: '2026-09-02', value: 0.31 }, b: { at: '2026-09-28', value: 0.25 } },
    trials: [{ id: 'T01', date: '2026-09-02', short: '広告を枠ごとに', grade: 'A', at: 'record' }] }
  const folder = await openWith({ ...DATA, loops: [plain] })
  const flow = await inLoops(app, folder, `[].map.call(document.querySelector(".hist-sec .hs-loop").children, function(e){ return e.className + " " + e.textContent })`)
  expect(flow?.value).toEqual(['hs-h L02広告売上', 'hs-bn none ボトルネックの記録がありません0.25円 ・ 9/2〜9/28', 'hs-ts 9/2広告を枠ごとに', 'hs-bn hs-cur 現在0.25円 ・ 9/28'])
})

test('施策がまだ1つも無いループは、箱も数字も出さず「まだ施策がありません」だけを出す', async () => {
  const fresh = { id: 'L02', name: '翌日も来る人', unit: '%', lowerBetter: false, now: 11, nowAt: '2026-09-01', bottlenecks: [{ from: '2026-09-01', text: '理由が分からない', a: { at: '2026-09-01', value: 11 }, b: { at: '2026-09-01', value: 11 } }], trials: [] }
  const folder = await openWith({ ...DATA, loops: [...DATA.loops, fresh] })
  const look = await inLoops(
    app,
    folder,
    `[].map.call(document.querySelectorAll(".hist-sec .hs-loop"), function(l){ return [l.querySelector(".hs-h").textContent, l.querySelectorAll(".hs-bn").length, (l.querySelector(".hs-blank") || {}).textContent || null] })`
  )
  expect(look?.value).toEqual([
    ['L01券の売上', 4, null],
    ['L02翌日も来る人', 0, 'まだ施策がありません']
  ])
})

test('施策の札を押すと、そのループの頁を開いて、その施策の位置へ飛ぶ', async () => {
  const folder = await openWith(DATA)
  await expect.poll(async () => (await inLoops(app, folder, '!!document.querySelector(".hs-ts .hs-tp")'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'.hs-tp[data-anchor="record-L01-T01"]\').click(); 1')
  await expect.poll(async () => (await inLoops(app, folder, 'location.hash'))?.value).toBe('#s-L01')
  // 評価に移った施策は施策の評価の欄（#record-L01-T01）。頁の先頭ではなく、その施策が上に来ている
  const top = (id: string) => inFrame(app, '/L01.html', `(function(){ var e = document.getElementById("${id}"); return e ? Math.round(e.getBoundingClientRect().top) : null })()`)
  await expect.poll(() => top('record-L01-T01')).toBeLessThan(80)
  // 一覧に戻って、実行中の T07 の札を押すと、施策の実行の欄（#trial-L01-T07）へ。同じ頁でも開き直して飛ぶ
  await inLoops(app, folder, 'location.hash = "s-list"; 1')
  await expect.poll(async () => (await inLoops(app, folder, '!document.body.classList.contains("in-loop")'))?.value).toBe(true)
  await inLoops(app, folder, 'document.querySelector(\'.hs-tp[data-anchor="trial-L01-T07"]\').click(); 1')
  await expect.poll(() => top('trial-L01-T07')).toBeLessThan(80)
})

test('history.js が無ければ、節を出さない', async () => {
  const folder = await openWith(null)
  expect((await inLoops(app, folder, '!!document.querySelector(".section.t-history")'))?.value).toBe(false)
})
