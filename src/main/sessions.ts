// 画面ごとのチャットの会話 ID。
// スキルの chat-pane.sh は loops/.chat-sessions に「<画面ID> <ai> <ID>」を書いていた。アプリはそれを読むだけにし、
// 新しい会話の ID はアプリのデータ置き場の sessions.json に持つ（プロジェクトのフォルダには書かない）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AiKind } from '@shared/types'

/** 会話の記録。skill は会話を作ったときの同梱のスキルの版（無いのは、版を記録する前の会話） */
export interface SessionEntry {
  id: string
  skill?: string
}

/**
 * フォルダ → { 刷新したか, 画面ID → AI → 会話 }。
 * renewed: ［新しい形にする］で会話を刷新したプロジェクト。スキルの頃の .chat-sessions の会話には戻らない
 */
export type SessionBook = Record<string, { renewed?: boolean; screens: Record<string, Partial<Record<AiKind, SessionEntry>>> }>

/** 「<画面ID> <ai>」→ 会話 ID。同じ組が2行あれば、chat-pane.sh（awk で最初の1行）と同じく先の行を使う */
export function parseChatSessions(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length !== 3) continue
    const key = `${cols[0]} ${cols[1]}`
    if (!(key in map)) map[key] = cols[2]
  }
  return map
}

/**
 * 続ける会話の ID。null なら新しい会話にする。
 * - アプリの記録があれば、それを使う。ただし記録した版がいまのスキルの版と違えば、新しい会話にする（古い決まりを残さない）
 * - 版の記録が無い会話（スキルの頃のもの）は、そのまま続ける
 * - アプリの記録が無ければ、スキルの頃の loops/.chat-sessions を使う。刷新したプロジェクトでは使わない
 */
export function findSession(book: SessionBook, chatSessions: string | null, folder: string, screen: string, ai: AiKind, skill: string): string | null {
  const f = book[folder]
  const own = f?.screens[screen]?.[ai]
  if (own) return own.skill && own.skill !== skill ? null : own.id
  if (f?.renewed || chatSessions == null) return null
  return parseChatSessions(chatSessions)[`${screen} ${ai}`] ?? null
}

export function recordSession(book: SessionBook, folder: string, screen: string, ai: AiKind, id: string, skill: string): SessionBook {
  const f = book[folder] ?? { screens: {} }
  return { ...book, [folder]: { ...f, screens: { ...f.screens, [screen]: { ...f.screens[screen], [ai]: { id, skill } } } } }
}

/** ［新しい形にする］のとき、そのプロジェクトの会話をすべて新しくする（古い会話の中身は消さない。続けなくなるだけ） */
export function renewFolder(book: SessionBook, folder: string): SessionBook {
  return { ...book, [folder]: { renewed: true, screens: {} } }
}

/** 読んだ記録をいまの形にそろえる。前の形（フォルダ → 画面 → AI → ID）は、版の記録が無い会話として読む */
export function normalizeBook(raw: unknown): SessionBook {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: SessionBook = {}
  for (const [folder, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as { renewed?: unknown; screens?: unknown }
    const isNew = 'screens' in o && o.screens && typeof o.screens === 'object'
    const screensRaw = (isNew ? o.screens : v) as Record<string, unknown>
    const screens: SessionBook[string]['screens'] = {}
    for (const [screen, ais] of Object.entries(screensRaw)) {
      if (!ais || typeof ais !== 'object') continue
      const e: Partial<Record<AiKind, SessionEntry>> = {}
      for (const [ai, x] of Object.entries(ais as Record<string, unknown>)) {
        if (ai !== 'claude' && ai !== 'codex') continue
        if (typeof x === 'string') e[ai] = { id: x }
        else if (x && typeof x === 'object' && typeof (x as SessionEntry).id === 'string') {
          const se = x as SessionEntry
          e[ai] = typeof se.skill === 'string' ? { id: se.id, skill: se.skill } : { id: se.id }
        }
      }
      screens[screen] = e
    }
    out[folder] = isNew && o.renewed === true ? { renewed: true, screens } : { screens }
  }
  return out
}

export function readChatSessions(folder: string): string | null {
  try {
    return readFileSync(join(folder, 'loops', '.chat-sessions'), 'utf8')
  } catch {
    return null
  }
}

export function loadBook(file: string): SessionBook {
  try {
    return normalizeBook(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return {}
  }
}

export function saveBook(file: string, book: SessionBook): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(book, null, 2))
  renameSync(file + '.tmp', file)
}
