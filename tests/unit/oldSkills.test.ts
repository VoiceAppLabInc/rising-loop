import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findOldSkills } from '../../src/main/oldSkills'

let home: string
const skill = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n本文\n`)
}

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
    expect(findOldSkills(home).sort()).toEqual(
      [join(home, '.agents', 'skills', 'old-name'), join(home, '.claude', 'skills', 'rising-loop'), join(home, '.codex', 'skills', 'rl')].sort()
    )
  })

  it('フォルダ名ではなく SKILL.md の name で見る。無ければ空', () => {
    skill(join(home, '.claude', 'skills', 'rising-loop'), 'something-else')
    expect(findOldSkills(home)).toEqual([])
    expect(findOldSkills(join(home, 'none'))).toEqual([])
  })
})
