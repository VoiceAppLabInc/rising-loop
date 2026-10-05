import { describe, expect, it } from 'vitest'
import { rightClickClipboard, termKeyAction } from '../../src/shared/termKeys'

const k = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}, type = 'keydown') => ({
  type,
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

describe('termKeyAction（ターミナルのコピーと貼り付けのキー）', () => {
  it('Windows：Ctrl+C は選んでいればコピー、選んでいなければいままでどおり送る（AI を止める）', () => {
    expect(termKeyAction(k('c', { ctrlKey: true }), true, 'win32')).toBe('copy')
    expect(termKeyAction(k('c', { ctrlKey: true }), false, 'win32')).toBe('pass')
  })
  it('Windows：Ctrl+Shift+C は選んでいればコピー、選んでいなければ何もしない', () => {
    expect(termKeyAction(k('C', { ctrlKey: true, shiftKey: true }), true, 'win32')).toBe('copy')
    expect(termKeyAction(k('C', { ctrlKey: true, shiftKey: true }), false, 'win32')).toBe('none')
  })
  it('Windows：Ctrl+V・Ctrl+Shift+V・Shift+Insert は貼り付け、Ctrl+Insert はコピー', () => {
    expect(termKeyAction(k('v', { ctrlKey: true }), false, 'win32')).toBe('paste')
    expect(termKeyAction(k('V', { ctrlKey: true, shiftKey: true }), false, 'win32')).toBe('paste')
    expect(termKeyAction(k('Insert', { shiftKey: true }), false, 'win32')).toBe('paste')
    expect(termKeyAction(k('Insert', { ctrlKey: true }), true, 'win32')).toBe('copy')
  })
  it('押したときだけ動き、同じキーを離したときはターミナルに送らない', () => {
    expect(termKeyAction(k('v', { ctrlKey: true }, 'keyup'), false, 'win32')).toBe('none')
    expect(termKeyAction(k('c', { ctrlKey: true }, 'keyup'), false, 'win32')).toBe('pass')
  })
  it('ほかのキー・Alt や Win キー付きは、いままでどおり送る。Linux も Windows と同じ', () => {
    expect(termKeyAction(k('a', { ctrlKey: true }), false, 'win32')).toBe('pass')
    expect(termKeyAction(k('v'), false, 'win32')).toBe('pass')
    expect(termKeyAction(k('v', { ctrlKey: true, altKey: true }), false, 'win32')).toBe('pass')
    expect(termKeyAction(k('v', { ctrlKey: true }), false, 'linux')).toBe('paste')
  })
  it('Mac は何もしない（メニューの ⌘C・⌘V が効く）', () => {
    expect(termKeyAction(k('c', { ctrlKey: true }), true, 'darwin')).toBe('pass')
    expect(termKeyAction(k('v', { metaKey: true }), false, 'darwin')).toBe('pass')
  })
  it('右クリックでのコピー・貼り付けは Mac 以外', () => {
    expect(rightClickClipboard('win32')).toBe(true)
    expect(rightClickClipboard('darwin')).toBe(false)
  })
})
