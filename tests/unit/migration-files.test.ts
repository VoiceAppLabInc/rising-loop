import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPlan, backupLoops, pruneBackups, restoreLoops } from '../../src/main/migration'

let root: string
let loops: string
let backups: string

/** フォルダの中身を「相対パス → 中身」にする */
function contents(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const p = join(dir, n)
    if (statSync(p).isFile()) out[n] = readFileSync(p, 'utf8')
  }
  return out
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-mfiles-'))
  loops = join(root, 'proj', 'loops')
  backups = join(root, 'backups')
  mkdirSync(join(loops, 'update'), { recursive: true })
  mkdirSync(join(loops, 'logs'), { recursive: true })
  writeFileSync(join(loops, 'index.html'), '<html>古い殻</html>')
  writeFileSync(join(loops, 'L01.html'), '<html>頁</html>')
  writeFileSync(join(loops, 'rising.js'), '// 古い')
  writeFileSync(join(loops, 'update', 'L01.py'), 'print(1)')
  writeFileSync(join(loops, 'logs', 'L01.md'), '# ログ')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('backupLoops', () => {
  it('loops/ をまるごと写し、写した場所を返す', () => {
    const dir = backupLoops(loops, join(backups, 'p1'), new Date('2026-10-01T10:20:30Z'))
    expect(contents(join(dir, 'loops'))).toEqual(contents(loops))
  })

  it('同じ時刻に2回取っても上書きしない', () => {
    const now = new Date('2026-10-01T10:20:30Z')
    const a = backupLoops(loops, join(backups, 'p1'), now)
    const b = backupLoops(loops, join(backups, 'p1'), now)
    expect(a).not.toBe(b)
  })
})

describe('pruneBackups', () => {
  it('新しい順に3つだけ残す', () => {
    const p = join(backups, 'p1')
    for (const m of ['01', '02', '03', '04', '05']) backupLoops(loops, p, new Date(`2026-10-${m}T00:00:00Z`))
    pruneBackups(p, 3)
    expect(readdirSync(p).sort()).toHaveLength(3)
    expect(readdirSync(p).sort()[0]).toMatch(/^20261003/)
  })
})

describe('applyPlan', () => {
  it('殻と共通の部品を書き、頁・ログ・数字取りのスクリプトには触らない', () => {
    applyPlan(loops, {
      newIndex: '<html>新しい殻</html>',
      common: [
        { path: 'rising.js', content: '// 新しい' },
        { path: 'update/common.py', content: '# 共通' }
      ]
    })
    expect(readFileSync(join(loops, 'index.html'), 'utf8')).toBe('<html>新しい殻</html>')
    expect(readFileSync(join(loops, 'rising.js'), 'utf8')).toBe('// 新しい')
    expect(readFileSync(join(loops, 'update', 'common.py'), 'utf8')).toBe('# 共通')
    expect(readFileSync(join(loops, 'L01.html'), 'utf8')).toBe('<html>頁</html>')
    expect(readFileSync(join(loops, 'update', 'L01.py'), 'utf8')).toBe('print(1)')
    // loops/ の中に控えや作業の残りを置かない（AI が古い LOOP_DATA を拾わないように）
    expect(existsSync(join(loops, '.tmp'))).toBe(false)
  })
})

describe('restoreLoops', () => {
  it('控えのとおりに戻す。あとから増えたファイルは消し、消えたファイルは戻す', () => {
    const before = contents(loops)
    const dir = backupLoops(loops, join(backups, 'p1'), new Date())
    writeFileSync(join(loops, 'index.html'), '<html>新しい殻</html>')
    writeFileSync(join(loops, 'L02.html'), '<html>あとから増えた頁</html>')
    rmSync(join(loops, 'logs', 'L01.md'))
    restoreLoops(join(dir, 'loops'), loops)
    expect(contents(loops)).toEqual(before)
  })
})
