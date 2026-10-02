// アプリ全体の記録（プロジェクトごとではないもの）。アプリのデータ置き場の app.json
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppSettings {
  /** ほかの場所の rising-loop を［残す］と答えた（次からは聞かない） */
  keepOldSkills?: boolean
  /** 使い方を一度見た（最初の1回だけ自動で開く） */
  howtoSeen?: boolean
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
