// 右のチャット。claude / codex をアプリの中の疑似ターミナル（node-pty）で、そのままの画面で動かす。
// ターミナルは「プロジェクト × 画面ID」ごとに1つ。出力は main が持っておき、右の窓が開き直されても続きを出す。
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import type { WebFrameMain } from 'electron'
import { pasteForTerminal } from '@shared/intercept'
import type { AiKind, Project } from '@shared/types'
import { CLAUDE_PROMPT, claudeArgs, codexArgs, codexCreateArgs, codexInstructions, parseCodexThreadId } from './launch'
import { childEnv, findCli, killTree } from './platform'
import { findSession, loadBook, readChatSessions, recordSession, saveBook } from './sessions'

/** 1つのターミナルが持っておく出力の上限（開き直したときに出す分） */
const KEEP = 2 * 1024 * 1024
/** AI の画面が出終わったとみなす、出力が止まってからの時間 */
const QUIET_MS = 800
/** 貼り付けてから Enter を押すまでの間（貼り付けを読み終える前に Enter が届くと、送信されないことがある） */
const ENTER_DELAY_MS = 200
/** 指示文を送れないまま待つ上限 */
const SEND_TIMEOUT_MS = 60_000

interface Term {
  proc: pty.IPty | null
  buf: string
  frame: WebFrameMain | null
  starting: boolean
  cols: number
  rows: number
  /** いまのプロセスが何か出力したか、最後に出力した時刻 */
  started: boolean
  lastOut: number
  /** まだ送っていない指示文 */
  queue: { text: string; at: number }[]
  flushing: boolean
}

export interface ChatPaths {
  /** アプリのデータ置き場 */
  dataDir: string
  /** claude の --plugin-dir に渡すフォルダ（.claude-plugin/ がある所） */
  pluginDir: string
  /** スキル本体（SKILL.md がある所）。codex に場所を伝える */
  skillDir: string
}

/** claude の設定の置き場所。CLAUDE_CONFIG_DIR があればそこ（テストでも使う） */
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

function claudeSessionExists(id: string): boolean {
  const root = join(claudeDir(), 'projects')
  try {
    return readdirSync(root).some((d) => existsSync(join(root, d, id + '.jsonl')))
  } catch {
    return false
  }
}

function claudeModel(): string | null {
  try {
    const m = JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8'))?.model
    return typeof m === 'string' && m ? m : null
  } catch {
    return null
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Chats {
  private terms = new Map<string, Term>()
  private promptFile: string
  private bookFile: string

  constructor(private paths: ChatPaths) {
    mkdirSync(paths.dataDir, { recursive: true })
    this.promptFile = join(paths.dataDir, 'claude-prompt.md')
    writeFileSync(this.promptFile, CLAUDE_PROMPT)
    this.bookFile = join(paths.dataDir, 'sessions.json')
  }

  /** 右の窓が開いたとき。それまでの出力を出し、まだ動いていなければ起動する */
  attach(project: Project, screen: string, ai: AiKind, frame: WebFrameMain, cols: number, rows: number): void {
    const t = this.term(project.id, screen, cols, rows)
    t.frame = frame
    if (t.buf) this.toPane(t, t.buf)
    this.resize(project.id, screen, cols, rows)
    if (!t.proc && !t.starting) void this.start(t, project, screen, ai)
  }

  /**
   * 指示文を、その画面のチャットに貼り付けて Enter まで押す。
   * ターミナルがまだ無ければ（右の窓を閉じているなど）その場で起動し、AI の画面が出終わってから送る。
   */
  send(project: Project, screen: string, ai: AiKind, text: string): void {
    const t = this.term(project.id, screen, 100, 30)
    t.queue.push({ text, at: Date.now() })
    if (!t.proc && !t.starting) void this.start(t, project, screen, ai)
    void this.flush(t)
  }

  input(projectId: string, screen: string, data: string, restart: () => void): void {
    const t = this.terms.get(`${projectId}:${screen}`)
    if (!t) return
    if (t.proc) t.proc.write(data)
    else if (!t.starting && data.includes('\r')) restart()
  }

  /** 終了したターミナルを開き直す */
  restart(project: Project, screen: string, ai: AiKind): void {
    const t = this.terms.get(`${project.id}:${screen}`)
    if (t && !t.proc && !t.starting) void this.start(t, project, screen, ai)
  }

  resize(projectId: string, screen: string, cols: number, rows: number): void {
    const t = this.terms.get(`${projectId}:${screen}`)
    if (!t || cols < 2 || rows < 2) return
    t.cols = cols
    t.rows = rows
    try {
      t.proc?.resize(cols, rows)
    } catch {
      // 終わりかけのプロセスは大きさを変えられない
    }
  }

  killAll(): void {
    for (const t of this.terms.values()) {
      const p = t.proc
      if (p) killTree(p.pid, () => p.kill())
      t.proc = null
    }
  }

  private term(projectId: string, screen: string, cols: number, rows: number): Term {
    const key = `${projectId}:${screen}`
    let t = this.terms.get(key)
    if (!t) {
      t = { proc: null, buf: '', frame: null, starting: false, cols, rows, started: false, lastOut: 0, queue: [], flushing: false }
      this.terms.set(key, t)
    }
    return t
  }

  private async flush(t: Term): Promise<void> {
    if (t.flushing) return
    t.flushing = true
    try {
      while (t.queue.length) {
        const next = t.queue[0]
        const ready = t.proc && t.started && Date.now() - t.lastOut >= QUIET_MS
        if (!ready) {
          if (Date.now() - next.at > SEND_TIMEOUT_MS) {
            t.queue.shift()
            this.out(t, '\r\n\x1b[2m指示文を送れませんでした。もう一度ボタンを押してください。\x1b[0m\r\n')
            continue
          }
          await wait(200)
          continue
        }
        t.queue.shift()
        const proc = t.proc!
        proc.write(pasteForTerminal(next.text))
        await wait(ENTER_DELAY_MS)
        if (t.proc === proc) proc.write('\r')
        // 次の指示文は、この指示文への AI の出力が落ち着いてから
        t.lastOut = Date.now()
      }
    } finally {
      t.flushing = false
    }
  }

  private out(t: Term, s: string): void {
    t.buf = (t.buf + s).slice(-KEEP)
    this.toPane(t, s)
  }

  private toPane(t: Term, s: string): void {
    try {
      if (t.frame && !t.frame.isDestroyed()) t.frame.send('pane:data', s)
    } catch {
      // 右の窓が閉じられた
    }
  }

  private async start(t: Term, project: Project, screen: string, ai: AiKind): Promise<void> {
    t.starting = true
    try {
      const cmd = await findCli(ai)
      if (!cmd) {
        this.out(t, `\r\n${ai} が見つかりませんでした。インストールしてから Enter を押してください。\r\n`)
        return
      }
      const env = await childEnv()
      const book = loadBook(this.bookFile)
      let id = findSession(book, readChatSessions(project.folder), project.folder, screen, ai)
      let args: string[]
      if (ai === 'claude') {
        id ??= randomUUID()
        args = claudeArgs({ sessionId: id, exists: claudeSessionExists(id), pluginDir: this.paths.pluginDir, promptFile: this.promptFile, model: claudeModel() })
      } else {
        const instructions = codexInstructions(this.paths.skillDir)
        if (!id) {
          this.out(t, 'codex の会話を作っています（30秒ほど）…\r\n')
          id = await this.createCodexThread(cmd.file, cmd.args, project, screen, instructions, env)
          if (!id) {
            this.out(t, 'codex の会話を作れませんでした。codex にログインしているかを確かめて、Enter を押してください。\r\n')
            return
          }
        }
        args = codexArgs({ threadId: id, instructions })
      }
      saveBook(this.bookFile, recordSession(loadBook(this.bookFile), project.folder, screen, ai, id))

      const proc = pty.spawn(cmd.file, [...cmd.args, ...args], { name: 'xterm-256color', cols: t.cols, rows: t.rows, cwd: project.folder, env: env as Record<string, string> })
      t.proc = proc
      t.started = false
      proc.onData((d) => {
        t.started = true
        t.lastOut = Date.now()
        this.out(t, d)
      })
      proc.onExit(() => {
        if (t.proc === proc) t.proc = null
        this.out(t, '\r\n\x1b[2m終了しました。Enter で開き直します。\x1b[0m\r\n')
      })
    } finally {
      t.starting = false
    }
  }

  private createCodexThread(file: string, pre: string[], project: Project, screen: string, instructions: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const prompt = `これは ${project.name} の Rising Loop App の右のチャット（${screen}）専用の窓口です。返事は「了解」だけ。`
    return new Promise((resolve) => {
      const child = execFile(file, [...pre, ...codexCreateArgs({ instructions, prompt })], { cwd: project.folder, env, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) =>
        resolve(parseCodexThreadId(String(stdout ?? '')))
      )
      child.stdin?.end()
    })
  }
}
