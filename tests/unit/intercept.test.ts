import { describe, expect, it } from 'vitest'
import { isInstruction, isUpdateRequest, parsePaneUrl, pasteForTerminal, screenOfUrl } from '../../src/shared/intercept'

describe('parsePaneUrl', () => {
  it('右の窓の URL から、フォルダと画面IDを取り出す', () => {
    // rising.js は encodeURIComponent でフォルダを渡す（+ が空白に化けないよう %2B）
    const url = 'http://localhost:7681/?arg=' + encodeURIComponent('/Volumes/Data/+Works/a b') + '&arg=s-L01'
    expect(parsePaneUrl(url)).toEqual({ folder: '/Volumes/Data/+Works/a b', screen: 's-L01' })
  })

  it('127.0.0.1 でも受ける', () => {
    expect(parsePaneUrl('http://127.0.0.1:7681/?arg=%2Fa&arg=s-list')).toEqual({ folder: '/a', screen: 's-list' })
  })

  it('右の窓でなければ null', () => {
    expect(parsePaneUrl('http://localhost:5173/')).toBeNull()
    expect(parsePaneUrl('https://localhost:7681/?arg=%2Fa&arg=s-list')).toBeNull()
    expect(parsePaneUrl('http://example.com:7681/?arg=%2Fa&arg=s-list')).toBeNull()
    expect(parsePaneUrl('http://localhost:7681/?arg=%2Fa')).toBeNull()
    expect(parsePaneUrl('not a url')).toBeNull()
  })
})

describe('isInstruction', () => {
  it('rising.js が組む指示文を指示文と見なす', () => {
    const block = '---\nloop: L01\nsection: GOAL\nrule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと\ntask: |\n  このループを更新して\n---'
    expect(isInstruction(block)).toBe(true)
    expect(isInstruction(block.replace(/\n/g, '\r\n'))).toBe(true)
  })

  it('💡 のコマンドなど、ほかのコピーは指示文ではない', () => {
    expect(isInstruction('sh /a/loops/chat-pane.sh claude')).toBe(false)
    expect(isInstruction('---')).toBe(false)
    expect(isInstruction('--- 見出し\n本文')).toBe(false)
    expect(isInstruction('---\nloop: L01\n終わりの線が無い')).toBe(false)
  })
})

describe('screenOfUrl', () => {
  it('ループの画面の URL の #s-L01 から画面IDを取る', () => {
    expect(screenOfUrl('file:///a/loops/index.html#s-L01')).toBe('s-L01')
  })
  it('# が無い・画面IDでないときは一覧', () => {
    expect(screenOfUrl('file:///a/loops/index.html')).toBe('s-list')
    expect(screenOfUrl('file:///a/loops/index.html#howto')).toBe('s-list')
    expect(screenOfUrl('not a url')).toBe('s-list')
  })
})

describe('pasteForTerminal', () => {
  it('貼り付けの形で囲み、改行は \\r にそろえる', () => {
    expect(pasteForTerminal('---\nloop: L01\r\ntask: |\n  更新して\n---')).toBe('\x1b[200~---\rloop: L01\rtask: |\r  更新して\r---\x1b[201~')
  })
  it('文の中の ESC は取り除く（貼り付けの終わりを偽装させない）', () => {
    expect(pasteForTerminal('a\x1b[201~b')).toBe('\x1b[200~a[201~b\x1b[201~')
  })
})

describe('isUpdateRequest', () => {
  it('前の版の「⬆ アップデート」の指示文を見分ける', () => {
    const t = '---\nloop: all\nsection: ALL\nrule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと\ntask: |\n  rising-loop を最新版に更新して、このループを合わせて\n---'
    expect(isUpdateRequest(t)).toBe(true)
  })
  it('ほかの指示文は違う', () => {
    expect(isUpdateRequest('---\nloop: all\nsection: ALL\ntask: |\n  loops/ の全ループを更新して\n---')).toBe(false)
  })
})
