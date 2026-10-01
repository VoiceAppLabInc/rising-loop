import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectForm } from '../../src/shared/loopsForm'

/** tests/fixtures/versions/<版>/loops/ を、アプリが読むのと同じ形にする */
function fixture(dir: string) {
  const loops = resolve('tests/fixtures', dir, 'loops')
  const names = readdirSync(loops)
  return {
    indexHtml: readFileSync(join(loops, 'index.html'), 'utf8'),
    pages: names.filter((n) => /^L\d+\.html$/.test(n)).map((n) => readFileSync(join(loops, n), 'utf8'))
  }
}

describe('detectForm', () => {
  it('1.2.x：殻が1ファイル（CONST の印が無い）', () => {
    const f = detectForm(fixture('versions/1.2.8'))
    expect(f.current).toBe(false)
    expect(f.era).toBe('1.2')
    expect(f.shown).toBe('1.2.8')
  })

  it('1.3〜1.4：頁が値を LXX.md に持つ形（data-page-schema が 2 でない）', () => {
    const f = detectForm(fixture('versions/1.4.0'))
    expect(f.current).toBe(false)
    expect(f.era).toBe('1.3-1.4')
    expect(f.shown).toBe('1.4.0')
  })

  it('1.5〜1.7：右のチャットが ttyd の形（💡・⬆ アップデートがある）', () => {
    expect(detectForm(fixture('versions/1.6.1'))).toMatchObject({ current: false, era: '1.5-1.7', shown: '1.6.1' })
    expect(detectForm(fixture('sample-project'))).toMatchObject({ current: false, era: '1.5-1.7' })
  })

  it('版の表示が v0.0.0（1.7.1 から雛形に入っている仮の値）なら、版は分からないとする', () => {
    expect(detectForm(fixture('versions/1.7.5')).shown).toBeNull()
  })

  it('いまの形なら新しくする必要は無い', () => {
    expect(detectForm(fixture('versions/2.0.0'))).toMatchObject({ current: true, era: 'current' })
  })

  it('殻が読めなければ、版の分からない形として新しくする必要は無いとする（何も変えない）', () => {
    expect(detectForm({ indexHtml: null, pages: [] })).toMatchObject({ current: true, era: 'unknown', shown: null })
  })

  it('頁が1つでも古ければ古い形', () => {
    const now = fixture('versions/2.0.0')
    const old = fixture('versions/1.4.0')
    expect(detectForm({ indexHtml: now.indexHtml, pages: [...now.pages, ...old.pages] })).toMatchObject({ current: false, era: '1.3-1.4' })
  })
})

describe('同梱のスキルの雛形', () => {
  it('殻の版の表示は VERSION と同じ（新しく作ったループにも版が残るように）', () => {
    const version = readFileSync(resolve('skill/skills/rising-loop/VERSION'), 'utf8').trim()
    const f = detectForm({ indexHtml: readFileSync(resolve('skill/skills/rising-loop/assets/index.html'), 'utf8'), pages: [] })
    expect(f.shown).toBe(version)
  })
})
