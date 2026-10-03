// claude / codex のうち、アプリが使うものを決める。「入っているか」ではなく「動くか」「アプリが使う機能があるか」で選ぶ。
// nodenv・Volta・asdf などの入口は、いまの Node に本体が無いと動かない。昔 npm で入れた古い版は、動いてもアプリが使う機能が無い。
// どちらも飛ばして次の候補を見る。使えるものが無ければ、設定・ようこその画面が［入れる］（公式の単体版。Node は要らない）を出す
import { execFile } from 'node:child_process'
import type { AiKind } from '@shared/types'
import { childEnv, cliCandidates, type Command } from './platform'

export type Probe = (file: string, args: string[]) => Promise<{ out: string; code: number }>

/** 見つけた結果。ok：使える／old：動くが古い／broken：あるが動かない／none：どこにも無い */
export interface Picked {
  cmd: Command | null
  state: 'ok' | 'old' | 'broken' | 'none'
  version: string | null
}

/** アプリが使う機能（起動の引数は launch.ts）。--help にこれが出ない版は古すぎる */
const NEEDS: Record<AiKind, { args: string[]; has: string[] }> = {
  claude: { args: ['--help'], has: ['--plugin-dir'] },
  codex: { args: ['exec', '--help'], has: ['--json', '--skip-git-repo-check'] }
}

export async function pickCli(ai: AiKind, candidates: Command[], probe: Probe): Promise<Picked> {
  let old: string | null = null
  let broken = false
  for (const c of candidates) {
    const v = await probe(c.file, [...c.args, '--version'])
    const version = v.out.trim().split('\n')[0] ?? ''
    if (v.code !== 0 || !/\d+\.\d+/.test(version)) {
      broken = true
      continue
    }
    const h = await probe(c.file, [...c.args, ...NEEDS[ai].args])
    if (!NEEDS[ai].has.every((f) => h.out.includes(f))) {
      old ??= version
      continue
    }
    return { cmd: c, state: 'ok', version }
  }
  return { cmd: null, state: old != null ? 'old' : broken ? 'broken' : 'none', version: old }
}

/** 本物のプロセスで確かめる（20 秒まで） */
export const runProbe =
  (env: NodeJS.ProcessEnv): Probe =>
  (file, args) =>
    new Promise((resolve) => {
      execFile(file, args, { env, timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0
        resolve({ out: String(stdout ?? ''), code })
      })
    })

/** 決めた結果は覚えておく（チャットを開くたびに確かめない）。［入れる］［ログイン］のあとは忘れて確かめ直す */
const cache = new Map<AiKind, Picked>()
export function forgetCli(): void {
  cache.clear()
}
export async function resolveCli(ai: AiKind): Promise<Picked> {
  const hit = cache.get(ai)
  if (hit) return hit
  const picked = await pickCli(ai, await cliCandidates(ai), runProbe(await childEnv()))
  if (picked.state === 'ok') cache.set(ai, picked)
  return picked
}
