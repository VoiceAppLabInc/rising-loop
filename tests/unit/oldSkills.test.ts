import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findOldSkills } from '../../src/main/oldSkills'

let home: string
const skill = (dir: string, name: string, version?: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n本文\n`)
  if (version) writeFileSync(join(dir, 'VERSION'), version + '\n')
}
const dirs = (found: { dir: string }[]) => found.map((f) => f.dir).sort()

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'rla-home-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('findOldSkills', () => {
  it('~/.claude/skills・~/.agents/skills・~/.codex/skills の rising-loop と loop-manager を見つける', () => {
    skill(join(home, '.claude', 'skills', 'rising-loop'), 'rising-loop')
    skill(join(home, '.agents', 'skills', 'old-name'), 'loop-manager')
    skill(join(home, '.codex', 'skills', 'rl'), 'rising-loop')
    skill(join(home, '.claude', 'skills', 'other'), 'grill-me')
    expect(dirs(findOldSkills(home))).toEqual(
      [join(home, '.agents', 'skills', 'old-name'), join(home, '.claude', 'skills', 'rising-loop'), join(home, '.codex', 'skills', 'rl')].sort()
    )
  })

  it('フォルダ名ではなく SKILL.md の name で見る。無ければ空', () => {
    skill(join(home, '.claude', 'skills', 'rising-loop'), 'something-else')
    expect(findOldSkills(home)).toEqual([])
    expect(findOldSkills(join(home, 'none'))).toEqual([])
  })

  it('1.8.0 より前（VERSION が古い・VERSION が無い・名前が loop-manager）は old。アプリの中で黙れないので必ずゴミ箱に入れる', () => {
    const at = (n: string) => join(home, '.claude', 'skills', n)
    skill(at('v175'), 'rising-loop', '1.7.5')
    skill(at('none'), 'rising-loop')
    skill(at('lm'), 'loop-manager', '9.0.0')
    skill(at('v180'), 'rising-loop', '1.8.0')
    skill(at('v190'), 'rising-loop', '1.9.0')
    const old = Object.fromEntries(findOldSkills(home).map((f) => [f.dir.split(/[\\/]/).pop(), f.old]))
    expect(old).toEqual({ v175: true, none: true, lm: true, v180: false, v190: false })
  })
})
