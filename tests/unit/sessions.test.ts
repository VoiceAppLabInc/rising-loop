import { describe, expect, it } from 'vitest'
import { findSession, normalizeBook, parseChatSessions, previousSession, recordSession, renewFolder } from '../../src/main/sessions'

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
    const book = recordSession({}, folder, 's-list', 'claude', 'app-id', '2.0.0')
    expect(findSession(book, 's-list claude old-id\n', folder, 's-list', 'claude', '2.0.0')).toBe('app-id')
  })

  it('記録したときのスキルの版がいまと違えば、新しい会話にする（null）', () => {
    const book = recordSession({}, folder, 's-list', 'claude', 'app-id', '2.0.0')
    expect(findSession(book, null, folder, 's-list', 'claude', '2.1.0')).toBeNull()
  })

  it('アプリの記録が無ければ、スキルの頃の .chat-sessions の会話を続ける（版の記録が無いので刷新しない）', () => {
    expect(findSession({}, 's-list claude old-id\n', folder, 's-list', 'claude', '2.0.0')).toBe('old-id')
    expect(findSession({}, 's-list claude old-id\n', folder, 's-list', 'codex', '2.0.0')).toBeNull()
  })

  it('刷新したプロジェクトでは、.chat-sessions の古い会話に戻らない', () => {
    const book = renewFolder({}, folder)
    expect(findSession(book, 's-list claude old-id\n', folder, 's-list', 'claude', '2.0.0')).toBeNull()
  })

  it('刷新したあとに作った会話は続ける', () => {
    const book = recordSession(renewFolder({}, folder), folder, 's-list', 'claude', 'new-id', '2.0.0')
    expect(findSession(book, 's-list claude old-id\n', folder, 's-list', 'claude', '2.0.0')).toBe('new-id')
  })

  it('別のプロジェクトの記録は使わない', () => {
    const book = recordSession({}, '/b/other', 's-list', 'claude', 'other-id', '2.0.0')
    expect(findSession(book, null, folder, 's-list', 'claude', '2.0.0')).toBeNull()
  })
})

describe('recordSession / renewFolder', () => {
  it('元の記録を書き換えない', () => {
    const book = recordSession({}, '/a', 's-list', 'claude', 'x', '2.0.0')
    const next = recordSession(book, '/a', 's-list', 'codex', 'y', '2.0.0')
    expect(book['/a'].screens['s-list']).toEqual({ claude: { id: 'x', skill: '2.0.0' } })
    expect(next['/a'].screens['s-list']).toEqual({ claude: { id: 'x', skill: '2.0.0' }, codex: { id: 'y', skill: '2.0.0' } })
  })

  it('刷新すると、そのプロジェクトの会話の記録を消す（直前の会話は prev に残す）', () => {
    const book = recordSession({}, '/a', 's-list', 'claude', 'x', '2.0.0')
    expect(renewFolder(book, '/a')['/a']).toEqual({ renewed: true, screens: {}, prev: { 's-list': { claude: { id: 'x', skill: '2.0.0' } } } })
  })

  it('2回刷新しても、画面ごとにいちばん新しい会話を prev に残す', () => {
    let book = recordSession({}, '/a', 's-list', 'claude', 'x', '2.0.0')
    book = recordSession(renewFolder(book, '/a'), '/a', 's-L01', 'claude', 'y', '2.0.0')
    expect(renewFolder(book, '/a')['/a'].prev).toEqual({ 's-list': { claude: { id: 'x', skill: '2.0.0' } }, 's-L01': { claude: { id: 'y', skill: '2.0.0' } } })
  })
})

describe('previousSession（新しい会話にするときの、直前の会話）', () => {
  const folder = '/a/proj'

  it('版が変わって新しい会話にするときは、記録していた会話', () => {
    const book = recordSession({}, folder, 's-L02', 'claude', 'old', '2.5.5')
    expect(previousSession(book, null, folder, 's-L02', 'claude')).toBe('old')
  })

  it('刷新したあとは、刷新の前の会話', () => {
    const book = renewFolder(recordSession({}, folder, 's-L02', 'codex', 'old', '2.5.5'), folder)
    expect(previousSession(book, null, folder, 's-L02', 'codex')).toBe('old')
  })

  it('アプリの記録が無ければ、スキルの頃の .chat-sessions の会話（刷新したあとでも）', () => {
    expect(previousSession(renewFolder({}, folder), 's-L02 claude legacy\n', folder, 's-L02', 'claude')).toBe('legacy')
  })

  it('どこにも無ければ null（AI が違えば別の会話）', () => {
    const book = recordSession({}, folder, 's-L02', 'claude', 'old', '2.5.5')
    expect(previousSession(book, null, folder, 's-L02', 'codex')).toBeNull()
    expect(previousSession({}, null, folder, 's-L02', 'claude')).toBeNull()
  })
})

describe('normalizeBook', () => {
  it('前の形の記録（フォルダ → 画面 → AI → ID）を、版の記録が無い会話として読む', () => {
    expect(normalizeBook({ '/a': { 's-list': { claude: 'x' } } })).toEqual({ '/a': { screens: { 's-list': { claude: { id: 'x' } } } } })
  })
  it('刷新の前の会話（prev）も読む', () => {
    const raw = { '/a': { renewed: true, screens: {}, prev: { 's-L02': { claude: { id: 'x', skill: '2.5.5' }, other: 'z' } } } }
    expect(normalizeBook(raw)).toEqual({ '/a': { renewed: true, screens: {}, prev: { 's-L02': { claude: { id: 'x', skill: '2.5.5' } } } } })
  })
  it('読めない中身は空にする', () => {
    expect(normalizeBook(null)).toEqual({})
    expect(normalizeBook([1, 2])).toEqual({})
  })
})
