import { describe, expect, it } from 'vitest'
import { findSession, keepAsPrevious, normalizeBook, parseChatSessions, previousSession, recordSession, renewFolder, transcriptHasReply } from '../../src/main/sessions'

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

  it('刷新のとき、AI の返事が入っていない会話では prev を上書きしない（引き継ぎの途中で切り替えた・開いただけの会話）', () => {
    let book = recordSession({}, '/a', 's-list', 'claude', 'real', '2.0.0')
    book = renewFolder(book, '/a')
    book = recordSession(book, '/a', 's-list', 'claude', 'empty', '2.0.0')
    const hasReply = (_ai: string, id: string) => id !== 'empty'
    expect(renewFolder(book, '/a', hasReply)['/a'].prev).toEqual({ 's-list': { claude: { id: 'real', skill: '2.0.0' } } })
  })
})

describe('previousSession / keepAsPrevious（新しい会話にするときの、直前の会話）', () => {
  const folder = '/a/proj'

  it('版が変わって新しい会話にするとき、それまでの会話に返事があれば、それを直前の会話にする', () => {
    const book = recordSession({}, folder, 's-L02', 'claude', 'old', '2.5.5')
    const kept = keepAsPrevious(book, folder, 's-L02', 'claude', () => true)
    expect(previousSession(kept, null, folder, 's-L02', 'claude')).toBe('old')
  })

  it('それまでの会話に返事が無ければ、前の直前の会話を残す', () => {
    let book = recordSession({}, folder, 's-L02', 'claude', 'real', '2.5.5')
    book = keepAsPrevious(book, folder, 's-L02', 'claude', () => true)
    book = recordSession(book, folder, 's-L02', 'claude', 'empty', '2.5.6')
    book = keepAsPrevious(book, folder, 's-L02', 'claude', (_ai, id) => id !== 'empty')
    expect(previousSession(book, null, folder, 's-L02', 'claude')).toBe('real')
  })

  it('刷新したあとは、刷新の前の会話', () => {
    const book = renewFolder(recordSession({}, folder, 's-L02', 'codex', 'old', '2.5.5'), folder)
    expect(previousSession(book, null, folder, 's-L02', 'codex')).toBe('old')
  })

  it('アプリの記録が無ければ、スキルの頃の .chat-sessions の会話（刷新したあとでも）', () => {
    expect(previousSession(renewFolder({}, folder), 's-L02 claude legacy\n', folder, 's-L02', 'claude')).toBe('legacy')
  })

  it('どこにも無ければ null（AI が違えば別の会話）', () => {
    const book = keepAsPrevious(recordSession({}, folder, 's-L02', 'claude', 'old', '2.5.5'), folder, 's-L02', 'claude', () => true)
    expect(previousSession(book, null, folder, 's-L02', 'codex')).toBeNull()
    expect(previousSession({}, null, folder, 's-L02', 'claude')).toBeNull()
  })
})

describe('transcriptHasReply（会話の記録に、AI の返事が入っているか）', () => {
  it('claude：assistant の文があれば返事あり。ユーザーの文だけなら無し', () => {
    expect(transcriptHasReply('claude', '{"type":"user","message":{"role":"user","content":"直前の会話の記録を読んで"}}\n')).toBe(false)
    expect(transcriptHasReply('claude', '{"type":"user","message":{"role":"user","content":"x"}}\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"前回は…"}]}}\n')).toBe(true)
  })
  it('claude：道具を使っただけで文の無い返事は数えない', () => {
    expect(transcriptHasReply('claude', '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read"}]}}\n')).toBe(false)
  })
  it('codex：会話を作るときの「了解」だけなら無し。ほかの返事があれば有り', () => {
    const ok = '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"了解"}]}}\n'
    const real = '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"前回は保存版のショート化まで"}]}}\n'
    expect(transcriptHasReply('codex', ok)).toBe(false)
    expect(transcriptHasReply('codex', ok + real)).toBe(true)
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
