import { describe, expect, it } from 'vitest'
import { pickCli } from '../../src/main/aiCli'

// 候補ごとの答え（--version と、使う機能の --help）
type Reply = { version?: { out: string; code: number }; help?: { out: string; code: number } }
const probeOf = (replies: Record<string, Reply>) => async (file: string, args: string[]) => {
  const r = replies[file] ?? {}
  if (args[0] === '--version') return r.version ?? { out: '', code: 127 }
  return r.help ?? { out: '', code: 1 }
}
const cmd = (file: string) => ({ file, args: [] })
const okClaude: Reply = { version: { out: '2.1.288 (Claude Code)\n', code: 0 }, help: { out: '  --plugin-dir <path>  Load a plugin\n', code: 0 } }
const okCodex: Reply = { version: { out: 'codex-cli 0.160.0\n', code: 0 }, help: { out: '      --json\n      --skip-git-repo-check\n', code: 0 } }

describe('pickCli（動くもの・新しさが足りるものを選ぶ）', () => {
  it('動かないもの（nodenv の入口など）は飛ばして、次の動くものを使う', async () => {
    const probe = probeOf({ '/shims/codex': { version: { out: 'nodenv: codex: command not found', code: 127 } }, '/brew/codex': okCodex })
    expect(await pickCli('codex', [cmd('/shims/codex'), cmd('/brew/codex')], probe)).toEqual({ cmd: cmd('/brew/codex'), state: 'ok', version: 'codex-cli 0.160.0' })
  })
  it('動いても、アプリが使う機能が無い古い版は飛ばす', async () => {
    const old: Reply = { version: { out: '1.0.3 (Claude Code)\n', code: 0 }, help: { out: '  --print\n', code: 0 } }
    const probe = probeOf({ '/npm/claude': old, '/local/claude': okClaude })
    expect(await pickCli('claude', [cmd('/npm/claude'), cmd('/local/claude')], probe)).toMatchObject({ cmd: cmd('/local/claude'), state: 'ok' })
  })
  it('codex は exec の --json と --skip-git-repo-check があるかで見る', async () => {
    const old: Reply = { version: { out: 'codex-cli 0.1.0\n', code: 0 }, help: { out: '      --json\n', code: 0 } }
    expect(await pickCli('codex', [cmd('/a')], probeOf({ '/a': old }))).toEqual({ cmd: null, state: 'old', version: 'codex-cli 0.1.0' })
  })
  it('使えるものが無いとき：古いものがあれば old、動かないものだけなら broken、何も無ければ none', async () => {
    const old: Reply = { version: { out: '1.0.3 (Claude Code)\n', code: 0 }, help: { out: '', code: 0 } }
    const broken: Reply = { version: { out: '', code: 127 } }
    expect(await pickCli('claude', [cmd('/b'), cmd('/o')], probeOf({ '/b': broken, '/o': old }))).toEqual({ cmd: null, state: 'old', version: '1.0.3 (Claude Code)' })
    expect(await pickCli('claude', [cmd('/b')], probeOf({ '/b': broken }))).toEqual({ cmd: null, state: 'broken', version: null })
    expect(await pickCli('claude', [], probeOf({}))).toEqual({ cmd: null, state: 'none', version: null })
  })
  it('--version が 0 で終わっても、数字が出なければ動かないとみなす', async () => {
    const probe = probeOf({ '/x': { version: { out: 'usage: something\n', code: 0 } } })
    expect(await pickCli('claude', [cmd('/x')], probe)).toMatchObject({ state: 'broken' })
  })
})
