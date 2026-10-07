import { describe, expect, it } from 'vitest'
import { FEEDBACK_ENTRY, FEEDBACK_FORM, FEEDBACK_URL_MAX, envLine, feedbackUrl, parseFeedbackFile } from '../../src/shared/feedback'

const params = (u: string) => new URL(u).searchParams

describe('feedbackUrl（答えを入れた状態で開くフォームの URL）', () => {
  it('種類・内容・環境を、それぞれの欄の番号で入れる', () => {
    const u = feedbackUrl({ kind: 'うまく動かない', body: '画面が新しくならない', env: 'アプリ v0.3.0' })
    expect(u.startsWith(FEEDBACK_FORM + '?')).toBe(true)
    const q = params(u)
    expect(q.get('usp')).toBe('pp_url')
    expect(q.get(`entry.${FEEDBACK_ENTRY.kind}`)).toBe('うまく動かない')
    expect(q.get(`entry.${FEEDBACK_ENTRY.body}`)).toBe('画面が新しくならない')
    expect(q.get(`entry.${FEEDBACK_ENTRY.env}`)).toBe('アプリ v0.3.0')
    expect(q.has(`entry.${FEEDBACK_ENTRY.email}`)).toBe(false)
  })
  it('選択肢に無い種類は入れない', () => {
    expect(params(feedbackUrl({ kind: 'バグ' })).has(`entry.${FEEDBACK_ENTRY.kind}`)).toBe(false)
  })
  it('長すぎる内容は切って、上限の長さに収める', () => {
    const u = feedbackUrl({ kind: 'うまく動かない', body: 'あ'.repeat(3000), env: 'x' })
    expect(u.length).toBeLessThanOrEqual(FEEDBACK_URL_MAX)
    expect(params(u).get(`entry.${FEEDBACK_ENTRY.body}`)).toMatch(/…（長いので切りました）$/)
  })
})

describe('parseFeedbackFile（AI が書いた報告）', () => {
  it('1行目の「種類: …」と、その後ろの内容に分ける（--- の区切りは外す）', () => {
    expect(parseFeedbackFile('種類: こうしてほしい\n---\nボタンを大きく\nしてほしい\n')).toEqual({ kind: 'こうしてほしい', body: 'ボタンを大きく\nしてほしい' })
  })
  it('種類が無い・選択肢に無いときは「うまく動かない」', () => {
    expect(parseFeedbackFile('動かない')).toEqual({ kind: 'うまく動かない', body: '動かない' })
    expect(parseFeedbackFile('種類: ばぐ\n動かない')).toEqual({ kind: 'うまく動かない', body: '動かない' })
  })
})

describe('envLine', () => {
  it('版・OS・AI・WSL を1行に', () => {
    expect(envLine({ app: '0.3.0', skill: '2.5.3', platform: 'win32', arch: 'x64', ai: 'codex', wsl: true })).toBe('アプリ v0.3.0 / スキル v2.5.3 / win32-x64 / AI: codex / WSL: はい')
  })
})
