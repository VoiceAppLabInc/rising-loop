// 新しい形にするときのファイルの操作（控え・入れ替え・元に戻す）。
// 控えは loops/ の外（アプリのデータ置き場）に置く。loops/ の中に頁の写しがあると、AI が grep で拾って
// 古い LOOP_DATA で頁を書き直すことがあるため（スキルの「loops/.tmp/ は作業場」の件と同じ問題）。
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** loops/ をまるごと <root>/<日時>/loops に写し、<root>/<日時> を返す（同じ時刻なら連番を付けて上書きしない） */
export function backupLoops(loops: string, root: string, now: Date): string {
  let dir = join(root, stamp(now))
  for (let i = 2; existsSync(dir); i++) dir = join(root, `${stamp(now)}-${i}`)
  mkdirSync(dir, { recursive: true })
  cpSync(loops, join(dir, 'loops'), { recursive: true, preserveTimestamps: true })
  return dir
}

/** 控えを新しい順に keep 個だけ残す */
export function pruneBackups(root: string, keep: number): void {
  let names: string[]
  try {
    names = readdirSync(root).filter((n) => statSync(join(root, n)).isDirectory())
  } catch {
    return
  }
  for (const n of names.sort().reverse().slice(keep)) rmSync(join(root, n), { recursive: true, force: true })
}

/** 書きかけのファイルが残らないよう、別名で書いてから置き換える */
function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.rla-writing`
  writeFileSync(tmp, content)
  renameSync(tmp, file)
}

/** 殻と共通の部品を書く。頁・ログ・数字取りのスクリプトには触らない */
export function applyPlan(loops: string, plan: { newIndex: string; common: { path: string; content: string }[] }): void {
  for (const c of plan.common) writeAtomic(join(loops, c.path), c.content)
  // 殻は最後に書く（アプリは殻の変化で画面を読み込み直すので、共通の部品がそろってから）
  writeAtomic(join(loops, 'index.html'), plan.newIndex)
}

/** loops/ を控えのとおりにする。控えに無いファイルは消し、控えのファイルで上書きする */
export function restoreLoops(backupLoopsDir: string, loops: string): void {
  const keep = new Set(readdirSync(backupLoopsDir, { recursive: true, encoding: 'utf8' }))
  for (const n of readdirSync(loops, { recursive: true, encoding: 'utf8' }).sort().reverse()) {
    if (keep.has(n)) continue
    rmSync(join(loops, n), { recursive: true, force: true })
  }
  cpSync(backupLoopsDir, loops, { recursive: true, force: true, preserveTimestamps: true })
}
