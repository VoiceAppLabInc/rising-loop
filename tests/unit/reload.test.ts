import { describe, expect, it } from 'vitest'
import { classifyChange, diffStamps, mergeChanges } from '../../src/shared/reload'

describe('classifyChange', () => {
  it('ループの頁はその頁だけ', () => {
    expect(classifyChange('L01.html')).toEqual({ page: 'L01.html' })
  })
  it('殻と共通の部品は画面全体', () => {
    expect(classifyChange('index.html')).toBe('shell')
    expect(classifyChange('rising.css')).toBe('shell')
    expect(classifyChange('rising.js')).toBe('shell')
    expect(classifyChange('project.css')).toBe('shell')
  })
  it('画面に関係しないものは見ない', () => {
    expect(classifyChange('README.md')).toBeNull()
    expect(classifyChange('.chat-sessions')).toBeNull()
    expect(classifyChange('.index.html.swp')).toBeNull()
    expect(classifyChange('L01.html.tmp')).toBeNull()
    expect(classifyChange('logs/L01.md')).toBeNull()
    expect(classifyChange('update\\L01.py')).toBeNull()
    expect(classifyChange('.tmp/numbers.txt')).toBeNull()
    expect(classifyChange(null)).toBeNull()
  })
})

describe('mergeChanges', () => {
  it('殻が1つでも変われば画面全体', () => {
    expect(mergeChanges([{ page: 'L01.html' }, 'shell'])).toBe('shell')
  })
  it('頁だけなら、変わった頁を重ねずに並べる', () => {
    expect(mergeChanges([{ page: 'L01.html' }, { page: 'L02.html' }, { page: 'L01.html' }])).toEqual({ pages: ['L01.html', 'L02.html'] })
  })
  it('何も無ければ null', () => {
    expect(mergeChanges([])).toBeNull()
  })
})

describe('diffStamps（OS の知らせが届かない場所のための見比べ）', () => {
  it('増えた・消えた・更新日時か大きさが変わったファイルの名前を返す', () => {
    const prev = new Map([['L01.html', '1:10'], ['index.html', '1:20'], ['old.js', '1:5']])
    const cur = new Map([['L01.html', '2:10'], ['index.html', '1:20'], ['new.js', '3:1']])
    expect(diffStamps(prev, cur).sort()).toEqual(['L01.html', 'new.js', 'old.js'])
  })
  it('何も変わっていなければ空', () => {
    const s = new Map([['L01.html', '1:10']])
    expect(diffStamps(s, new Map(s))).toEqual([])
  })
})
