// ほかの場所に入っている rising-loop（古い名前の loop-manager を含む）。
// アプリは同梱のスキルを使うので、起動時に見つけたら「ゴミ箱に入れますか」と聞く。見分け方はスキルの install.sh と同じ（SKILL.md の name）。
// 1.8.0 より前のスキル版は、アプリの中のチャットでも「数字の話が出たら使う」で古い手順を動かしてしまうので、聞かずにゴミ箱に入れる（old）。
// 1.8.0 はアプリ版へ案内するだけで、アプリの中（RISING_LOOP_APP=1）では黙るので、残してもよい
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { compareVersions } from '@shared/migrate'
import type { FoundSkill } from '@shared/types'

/** これより前の版は、アプリの中で黙れない */
const QUIET_FROM = '1.8.0'

const ROOTS = [
  ['.claude', 'skills'],
  ['.agents', 'skills'],
  ['.codex', 'skills']
]

export function findOldSkills(home: string): FoundSkill[] {
  const out: FoundSkill[] = []
  for (const r of ROOTS) {
    const root = join(home, ...r)
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const n of names) {
      const dir = join(root, n)
      const md = join(dir, 'SKILL.md')
      try {
        if (!statSync(dir).isDirectory() || !existsSync(md)) continue
        const head = readFileSync(md, 'utf8').slice(0, 2000)
        const m = head.match(/^name:\s*(rising-loop|loop-manager)\s*$/m)
        if (!m) continue
        const version = existsSync(join(dir, 'VERSION')) ? readFileSync(join(dir, 'VERSION'), 'utf8').trim() : ''
        out.push({ dir, old: m[1] === 'loop-manager' || !/^\d+(\.\d+)*$/.test(version) || compareVersions(version, QUIET_FROM) < 0 })
      } catch {
        // 読めないものは見ない
      }
    }
  }
  return out
}
