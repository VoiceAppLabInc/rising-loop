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
 * prev: 刷新の前の会話。続けはしないが、新しい会話に「直前の会話の記録」として読ませる
 */
type Screens = Record<string, Partial<Record<AiKind, SessionEntry>>>
export type SessionBook = Record<string, { renewed?: boolean; screens: Screens; prev?: Screens }>

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

/**
 * ［新しい形にする］のとき、そのプロジェクトの会話をすべて新しくする（古い会話の中身は消さない。続けなくなるだけ）。
 * 直前の会話は prev に残し、新しい会話に記録を読ませる
 */
export function renewFolder(book: SessionBook, folder: string): SessionBook {
  const f = book[folder]
  const prev: Screens = { ...f?.prev }
  for (const [screen, ais] of Object.entries(f?.screens ?? {})) prev[screen] = { ...prev[screen], ...ais }
  return { ...book, [folder]: Object.keys(prev).length ? { renewed: true, screens: {}, prev } : { renewed: true, screens: {} } }
}

/**
 * 新しい会話にするときの、その画面の直前の会話の ID。無ければ null。
 * 版が変わったときは記録していた会話、刷新したあとは刷新の前の会話、アプリの記録が無ければスキルの頃の .chat-sessions の会話
 */
export function previousSession(book: SessionBook, chatSessions: string | null, folder: string, screen: string, ai: AiKind): string | null {
  const f = book[folder]
  const id = f?.screens[screen]?.[ai]?.id ?? f?.prev?.[screen]?.[ai]?.id
  if (id) return id
  return chatSessions == null ? null : (parseChatSessions(chatSessions)[`${screen} ${ai}`] ?? null)
}

/** 読んだ記録をいまの形にそろえる。前の形（フォルダ → 画面 → AI → ID）は、版の記録が無い会話として読む */
export function normalizeBook(raw: unknown): SessionBook {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: SessionBook = {}
  for (const [folder, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as { renewed?: unknown; screens?: unknown; prev?: unknown }
    const isNew = 'screens' in o && o.screens && typeof o.screens === 'object'
    const screens = readScreens((isNew ? o.screens : v) as Record<string, unknown>)
    const entry: SessionBook[string] = isNew && o.renewed === true ? { renewed: true, screens } : { screens }
    if (isNew && o.prev && typeof o.prev === 'object' && !Array.isArray(o.prev)) entry.prev = readScreens(o.prev as Record<string, unknown>)
    out[folder] = entry
  }
  return out
}

function readScreens(raw: Record<string, unknown>): Screens {
  const screens: Screens = {}
  for (const [screen, ais] of Object.entries(raw)) {
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
  return screens
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
