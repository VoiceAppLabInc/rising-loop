// アプリ全体の記録（プロジェクトごとではないもの）。アプリのデータ置き場の app.json
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface AppSettings {
  /** 使い方を一度見た（最初の1回だけ自動で開く） */
  howtoSeen?: boolean
  /** 新しい版のお知らせを自動で出した、その版（同じ版については1回だけ） */
  updateSeen?: string
  /** 前回開いたときのアプリの版。変わっていたら、Mac にアイコンを覚え直させる */
  lastVersion?: string
  /** 右のチャットの窓の幅（左端のドラッグで決めた幅。全プロジェクト共通） */
  paneWidth?: number
  /** 使っている人の数を数えるための、アプリごとのランダムな番号（初回に作る） */
  anonId?: string
  /** 使い方の統計（匿名の番号・版・OS・AI）を送らない（設定で止めたとき true。既定は送る） */
  statsOff?: boolean
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
