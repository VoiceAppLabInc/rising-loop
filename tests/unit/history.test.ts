import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// 一覧の「施策の流れ」の中身を書く assets/history.py（プロジェクトでは loops/update/history.py）を、本当に流して確かめる
const ASSETS = resolve('skill/skills/rising-loop/assets')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** loops/（殻の一覧の行・頁・update/ の common.py と history.py）を一時フォルダに作る */
function project(pages: Record<string, string>, rows: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'rla-history-'))
  dirs.push(root)
  const loops = join(root, 'loops')
  mkdirSync(join(loops, 'update'), { recursive: true })
  copyFileSync(join(ASSETS, 'loopdata.py'), join(loops, 'update', 'common.py'))
  copyFileSync(join(ASSETS, 'history.py'), join(loops, 'update', 'history.py'))
  writeFileSync(join(loops, 'index.html'), `<div class="loops">${rows.map((id) => `<div class="loop-row" data-go="s-${id}"></div>`).join('')}</div>`)
  for (const [name, data] of Object.entries(pages)) writeFileSync(join(loops, name), `<html><body>\n<script>\nvar LOOP_DATA = ${data};\n</script>\n</body></html>`)
  return root
}

const run = (root: string) => execFileSync('python3', ['loops/update/history.py'], { cwd: root, encoding: 'utf8' })
const readOut = (root: string) => {
  const js = readFileSync(join(root, 'loops', 'history.js'), 'utf8')
  return { js, data: JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1)) }
}

const L01 = `{
  id: "L01", title: "券の手取りを 24円 に", short: "券の手取り",
  metric: { start: 3.46 },
  hist: { unit: "円", target: 24, points: [ { at: "2026-09-20", value: 1.18 }, { at: "2026-09-28", value: 1.1 } ] },
  bottlenecks: [
    { from: "2026-09-06", text: "決済シートで止まる", value: 3.46 },
    { from: "2026-09-01", text: "250円かかると思われている" }
  ],
  trials: [ { id: "T07", title: "みんなで投票する", short: "みんなで投票", started: "2026-09-23" }, { id: "T08", title: "日付の無い施策" } ],
  records: [ { id: "T01", title: "ボタンを1か所にまとめる", short: "ボタンを1か所に", done: "2026-09-02", grade: "B" },
             { id: "T02", title: "15分のお試し", done: "2026-09-07", grade: "-" } ]
}`
// 下がるほど良い（目標 < はじめ）。short が無ければ title
const L02 = `{
  id: "L02", title: "解約を減らす",
  metric: { start: 40 },
  hist: { unit: "件", target: 20, points: [] },
  bottlenecks: [ { from: "2026-09-10", text: "解約の理由が分からない" } ],
  trials: [], records: []
}`
// bottlenecks が無い頁は出さない
const L03 = `{ id: "L03", title: "広告売上", metric: { start: 1 }, hist: { unit: "円", target: 2, points: [] }, trials: [], records: [] }`

describe('history.py（一覧の施策の流れの中身）', () => {
  it('全頁の LOOP_DATA から集め、一覧の行の順に書く。bottlenecks の無い頁は出さない', () => {
    const root = project({ 'L01.html': L01, 'L02.html': L02, 'L03.html': L03 }, ['L02', 'L03', 'L01'])
    expect(run(root)).toContain('2 ループを書いた')
    const { js, data } = readOut(root)
    expect(js).toMatch(/^\/\/ .*\nwindow\.HISTORY_DATA = \{/)
    expect(data.loops.map((l: { id: string }) => l.id)).toEqual(['L02', 'L01'])
    const [l2, l1] = data.loops
    expect(l2).toMatchObject({ name: '解約を減らす', unit: '件', lowerBetter: true, now: null, nowAt: null })
    expect(l1).toMatchObject({ name: '券の手取り', unit: '円', lowerBetter: false, now: 1.1, nowAt: '2026-09-28' })
    // ボトルネックは古い順に並べ直す。value が無い段は value を持たない
    expect(l1.bottlenecks).toEqual([
      { from: '2026-09-01', text: '250円かかると思われている' },
      { from: '2026-09-06', text: '決済シートで止まる', value: 3.46 }
    ])
    // 施策は評価に移ったもの（record）と実行中（trial）を日付の順に。日付の無いものは最後。short が無ければ title
    expect(l1.trials).toEqual([
      { id: 'T01', date: '2026-09-02', short: 'ボタンを1か所に', grade: 'B', at: 'record' },
      { id: 'T02', date: '2026-09-07', short: '15分のお試し', grade: '-', at: 'record' },
      { id: 'T07', date: '2026-09-23', short: 'みんなで投票', grade: '-', at: 'trial' },
      { id: 'T08', date: null, short: '日付の無い施策', grade: '-', at: 'trial' }
    ])
  })

  it('一覧の行に無い頁は、名前の順で後ろに付ける', () => {
    const root = project({ 'L01.html': L01, 'L02.html': L02 }, [])
    run(root)
    expect(readOut(root).data.loops.map((l: { id: string }) => l.id)).toEqual(['L01', 'L02'])
  })

  it('中身が同じなら書き直さない（書いた日だけの差では書かない）', () => {
    const root = project({ 'L01.html': L01 }, ['L01'])
    run(root)
    const p = join(root, 'loops', 'history.js')
    const old = readFileSync(p, 'utf8').replace(/"generated": "[^"]*"/, '"generated": "2000-01-01"')
    writeFileSync(p, old)
    expect(run(root)).toContain('変わりなし')
    expect(readFileSync(p, 'utf8')).toBe(old)
  })

  it('読めない頁は飛ばして名前を出し、ほかの頁は書く', () => {
    const root = project({ 'L01.html': L01, 'L09.html': '{ broken: `${x}` }' }, ['L01', 'L09'])
    const out = run(root)
    expect(out).toContain('読めない頁（飛ばした）: L09.html')
    expect(readOut(root).data.loops.map((l: { id: string }) => l.id)).toEqual(['L01'])
  })
})
