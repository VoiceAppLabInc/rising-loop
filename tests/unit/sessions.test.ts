import { describe, expect, it } from 'vitest'
import { findSession, parseChatSessions, recordSession } from '../../src/main/sessions'

describe('parseChatSessions', () => {
  it('chat-pane.sh の「<画面ID> <ai> <ID>」の行を読む', () => {
    const text = 's-list claude 1111\ns-L01 claude 2222\ns-L01 codex 3333\n'
    expect(parseChatSessions(text)).toEqual({ 's-list claude': '1111', 's-L01 claude': '2222', 's-L01 codex': '3333' })
  })

  it('同じ画面と AI が2行あれば、chat-pane.sh と同じく先の行を使う', () => {
    expect(parseChatSessions('s-list claude aaa\ns-list claude bbb\n')['s-list claude']).toBe('aaa')
  })

  it('形の違う行と空行は読み飛ばす', () => {
    expect(parseChatSessions('\n# メモ\ns-list claude\ns-list claude id1 余り\r\n  \ns-L02 claude id2\r\n')).toEqual({ 's-L02 claude': 'id2' })
  })
})

describe('findSession', () => {
  const folder = '/a/yoga'
  it('アプリの記録を先に見る', () => {
    const book = recordSession({}, folder, 's-list', 'claude', 'app-id')
    expect(findSession(book, 's-list claude old-id\n', folder, 's-list', 'claude')).toBe('app-id')
  })

  it('アプリの記録が無ければ、既存の .chat-sessions を使う', () => {
    expect(findSession({}, 's-list claude old-id\n', folder, 's-list', 'claude')).toBe('old-id')
    expect(findSession({}, 's-list claude old-id\n', folder, 's-list', 'codex')).toBeNull()
  })

  it('.chat-sessions が無くても動く', () => {
    expect(findSession({}, null, folder, 's-L01', 'claude')).toBeNull()
  })

  it('別のプロジェクトの記録は使わない', () => {
    const book = recordSession({}, '/b/other', 's-list', 'claude', 'other-id')
    expect(findSession(book, null, folder, 's-list', 'claude')).toBeNull()
  })
})

describe('recordSession', () => {
  it('元の記録を書き換えない', () => {
    const book = recordSession({}, '/a', 's-list', 'claude', 'x')
    const next = recordSession(book, '/a', 's-list', 'codex', 'y')
    expect(book).toEqual({ '/a': { 's-list': { claude: 'x' } } })
    expect(next).toEqual({ '/a': { 's-list': { claude: 'x', codex: 'y' } } })
  })
})
