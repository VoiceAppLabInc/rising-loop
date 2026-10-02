// ほかの場所に入っている rising-loop（古い名前の loop-manager を含む）。
// アプリは同梱のスキルを使うので、起動時に見つけたら「ゴミ箱に入れますか」と聞く。見分け方はスキルの install.sh と同じ（SKILL.md の name）
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = [
  ['.claude', 'skills'],
  ['.agents', 'skills'],
  ['.codex', 'skills']
]

export function findOldSkills(home: string): string[] {
  const out: string[] = []
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
        if (/^name:\s*(rising-loop|loop-manager)\s*$/m.test(head)) out.push(dir)
      } catch {
        // 読めないものは見ない
      }
    }
  }
  return out
}
