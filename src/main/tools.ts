// 設定画面の［入れる］［ログイン］で、公式の手順をアプリの中のターミナルで動かす（1つずつ）
import * as pty from 'node-pty'
import type { Command } from './platform'
import { killTree } from './platform'

export class ToolRunner {
  private proc: pty.IPty | null = null

  get running(): boolean {
    return !!this.proc
  }

  run(cmd: Command, o: { cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number; onData: (d: string) => void; onExit: (code: number) => void }): void {
    this.stop()
    const p = pty.spawn(cmd.file, cmd.args, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env as Record<string, string> })
    this.proc = p
    p.onData(o.onData)
    p.onExit(({ exitCode }) => {
      if (this.proc === p) this.proc = null
      o.onExit(exitCode)
    })
  }

  input(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    try {
      if (cols > 1 && rows > 1) this.proc?.resize(cols, rows)
    } catch {
      // 終わりかけ
    }
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    if (p) killTree(p.pid, () => p.kill())
  }
}
