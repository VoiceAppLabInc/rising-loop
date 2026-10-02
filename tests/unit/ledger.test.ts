import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changesBetween, fingerprints, parseLedger, pendingWork, type Ledger } from '../../src/main/ledger'
import { compareVersions } from '../../src/shared/migrate'

const SKILL = resolve('skill/skills/rising-loop')
const read = (rel: string) => readFileSync(join(SKILL, rel), 'utf8')
const ledger = parseLedger(read('migrations.json'))
const version = read('VERSION').trim()

describe('台帳（migrations.json）', () => {
  it('版は古い順に並び、最後はいまの版', () => {
    for (let i = 1; i < ledger.length; i++) expect(compareVersions(ledger[i - 1].version, ledger[i].version)).toBe(-1)
    expect(ledger[ledger.length - 1].version).toBe(version)
  })

  it('項目の ID は重ならず、その版で始まり、何を変えるかが書いてある', () => {
    const ids = ledger.flatMap((e) => e.changes.map((c) => c.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of ledger)
      for (const c of e.changes) {
        expect(c.id.startsWith(e.version + '-')).toBe(true)
        expect(['pages', 'list', 'const']).toContain(c.target)
        expect(c.what.length).toBeGreaterThan(0)
      }
  })

  it('いまの版の項に、いまの雛形の指紋が書いてある（雛形を変えたら台帳も書く）', () => {
    expect(ledger[ledger.length - 1].templates).toEqual(fingerprints(read('assets/loop.html'), read('assets/index.html')))
  })

  it('前の版から雛形が変わった版には、その変化の項目がある（台帳の書き忘れを落とす）', () => {
    for (let i = 1; i < ledger.length; i++) {
      const a = ledger[i - 1]
      const b = ledger[i]
      const has = (t: string) => b.changes.some((c) => c.target === t)
      if (a.templates.loop !== b.templates.loop) expect(has('pages'), `${b.version} の頁の変化`).toBe(true)
      if (a.templates.loops !== b.templates.loops) expect(has('list'), `${b.version} の一覧の変化`).toBe(true)
      if (a.templates.const !== b.templates.const) expect(has('const'), `${b.version} の CONST の変化`).toBe(true)
    }
  })
})

describe('changesBetween', () => {
  it('前の版より後、いまの版まで（両端は「より後」と「まで」）の項目を、古い順に返す', () => {
    const ids = changesBetween(ledger, '1.7.3', '2.0.0').map((c) => c.id)
    expect(ids[0].startsWith('1.7.4-')).toBe(true)
    expect(ids.some((id) => id.startsWith('1.7.3-'))).toBe(false)
    expect(ids[ids.length - 1].startsWith('2.0.0-')).toBe(true)
  })
  it('同じ版なら何も無い', () => {
    expect(changesBetween(ledger, version, version)).toEqual([])
  })
})

describe('pendingWork（どの頁と一覧に、どの項目を反映するか）', () => {
  const small: Ledger = [
    { version: '1.0.0', templates: { loop: 'a', loops: 'a', const: 'a' }, changes: [] },
    { version: '1.1.0', templates: { loop: 'b', loops: 'a', const: 'a' }, changes: [{ id: '1.1.0-x', target: 'pages', what: '欄 X を足す' }] },
    { version: '1.2.0', templates: { loop: 'b', loops: 'b', const: 'b' }, changes: [{ id: '1.2.0-y', target: 'list', what: '一覧 Y' }, { id: '1.2.0-z', target: 'const', what: 'CONST Z' }] },
    { version: '1.3.0', templates: { loop: 'c', loops: 'b', const: 'b' }, changes: [{ id: '1.3.0-w', target: 'pages', what: '欄 W を変える' }] }
  ]
  const index = (listVer?: string) => `<!-- LOOPS:BEGIN -->\n${listVer ? `<!-- list-ver: ${listVer} -->\n` : ''}<div></div>\n<!-- LOOPS:END -->`
  const page = (name: string, ver?: string) => ({ name, html: `<html lang="ja"${ver ? ` data-loop-ver="${ver}"` : ''}><body></body></html>` })

  it('印の無い頁と一覧は、新しい形にする前の版から数える', () => {
    const w = pendingWork({ ledger: small, current: '1.3.0', baseline: '1.0.0', indexHtml: index(), pages: [page('L01.html')] })
    expect(w.pages).toEqual([{ name: 'L01.html', from: '1.0.0', changes: [small[1].changes[0], small[3].changes[0]] }])
    expect(w.list).toEqual({ from: '1.0.0', changes: [small[2].changes[0], small[2].changes[1]] })
  })

  it('印があれば、その版から数える。いまの版まで反映済みなら挙げない', () => {
    const w = pendingWork({ ledger: small, current: '1.3.0', baseline: '1.0.0', indexHtml: index('1.2.0'), pages: [page('L01.html', '1.1.0'), page('L02.html', '1.3.0')] })
    expect(w.pages.map((p) => [p.name, p.changes.map((c) => c.id)])).toEqual([['L01.html', ['1.3.0-w']]])
    expect(w.list).toBeNull()
  })

  it('範囲に頁や一覧の変化が無ければ、作り直さない', () => {
    const w = pendingWork({ ledger: small, current: '1.2.0', baseline: '1.1.0', indexHtml: index('1.2.0'), pages: [page('L01.html')] })
    expect(w.pages).toEqual([])
    expect(w.list).toBeNull()
  })

  it('同梱の台帳で、1.7.5 の頁を 2.0.0 にするとき', () => {
    const fx = resolve('tests/fixtures/versions/1.7.5/loops')
    const w = pendingWork({
      ledger,
      current: version,
      baseline: '1.7.5',
      indexHtml: readFileSync(join(fx, 'index.html'), 'utf8'),
      pages: [{ name: 'L01.html', html: readFileSync(join(fx, 'L01.html'), 'utf8') }]
    })
    expect(w.pages[0].changes.map((c) => c.id)).toEqual(changesBetween(ledger, '1.7.5', version).filter((c) => c.target === 'pages').map((c) => c.id))
    expect(w.pages[0].changes.length).toBeGreaterThan(0)
  })
})
