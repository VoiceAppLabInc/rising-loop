import { describe, expect, it } from 'vitest'
import { classifyChange, mergeChanges } from '../../src/shared/reload'

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
