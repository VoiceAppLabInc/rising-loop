// 画面ごとのチャットの会話 ID。
// スキルの chat-pane.sh は loops/.chat-sessions に「<画面ID> <ai> <ID>」を書いていた。アプリはそれを読むだけにし、
// 新しい会話の ID はアプリのデータ置き場の sessions.json に持つ（プロジェクトのフォルダには書かない）。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AiKind } from '@shared/types'

/** フォルダ → 画面ID → AI → 会話 ID */
export type SessionBook = Record<string, Record<string, Partial<Record<AiKind, string>>>>

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

/** アプリの記録を先に見て、無ければ既存の .chat-sessions を使う */
export function findSession(book: SessionBook, chatSessions: string | null, folder: string, screen: string, ai: AiKind): string | null {
  const own = book[folder]?.[screen]?.[ai]
  if (own) return own
  if (chatSessions == null) return null
  return parseChatSessions(chatSessions)[`${screen} ${ai}`] ?? null
}

export function recordSession(book: SessionBook, folder: string, screen: string, ai: AiKind, id: string): SessionBook {
  return { ...book, [folder]: { ...book[folder], [screen]: { ...book[folder]?.[screen], [ai]: id } } }
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
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as SessionBook) : {}
  } catch {
    return {}
  }
}

export function saveBook(file: string, book: SessionBook): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(book, null, 2))
  renameSync(file + '.tmp', file)
}
