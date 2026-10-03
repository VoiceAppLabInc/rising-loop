// アプリ全体の記録（プロジェクトごとではないもの）。アプリのデータ置き場の app.json
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface AppSettings {
  /** ほかの場所の rising-loop を［残す］と答えた（次からは聞かない） */
  keepOldSkills?: boolean
  /** 使い方を一度見た（最初の1回だけ自動で開く） */
  howtoSeen?: boolean
  /** 新しい版のお知らせを自動で出した、その版（同じ版については1回だけ） */
  updateSeen?: string
}

export function loadSettings(file: string): AppSettings {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as AppSettings) : {}
  } catch {
    return {}
  }
}

export function saveSettings(file: string, s: AppSettings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(s, null, 2))
  renameSync(file + '.tmp', file)
}

/**
 * アプリのデータ置き場。普段使いのアプリ（配ったもの）は Rising Loop、開発版（pnpm dev）は Rising Loop Dev に分けて混ぜない。
 * 0.1.0 までの名前は Rising Loop App だったので、普段使いのアプリを初めて開いたときは、その中身を写して引き継ぐ（前の置き場は消さない）
 */
export function dataDirOf(o: { packaged: boolean; override?: string; appData: string; exists: (p: string) => boolean }): { dir: string; copyFrom?: string } {
  if (o.override) return { dir: o.override }
  if (!o.packaged) return { dir: join(o.appData, 'Rising Loop Dev') }
  const dir = join(o.appData, 'Rising Loop')
  const old = join(o.appData, 'Rising Loop App')
  return !o.exists(dir) && o.exists(old) ? { dir, copyFrom: old } : { dir }
}
