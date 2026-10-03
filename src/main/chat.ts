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
import { childEnv, killTree } from './platform'
import { resolveCli } from './aiCli'
import { findSession, loadBook, readChatSessions, recordSession, renewFolder, saveBook } from './sessions'

/** 1つのターミナルが持っておく出力の上限（開き直したときに出す分） */
const KEEP = 2 * 1024 * 1024
/** AI の画面が出終わったとみなす、出力が止まってからの時間 */
const QUIET_MS = 800
/** 貼り付けてから Enter を押すまでの間（貼り付けを読み終える前に Enter が届くと、送信されないことがある） */
const ENTER_DELAY_MS = 200
/** 指示文を送れないまま待つ上限 */
const SEND_TIMEOUT_MS = 60_000
/**
 * 起動してから貼り付けを受け付けるまでの時間。起動直後の claude は入力を黙って捨てる（2026-10-02 に本物で確かめた）。
 * 会話を始めるときの文は起動時の引数で渡すので、これは起動中に続けて届いた文のためのもの
 */
const STARTUP_MS = 4000
/**
 * 最後の出力からこの時間内なら、AI は作業中とみなす。claude / codex は作業中ずっと回る印や経過時間を描き直すので、
 * 作業の途中で出力が 2 秒以上途切れることはまず無い（一覧の「AI作業中」の札を早く消すため短くしている）
 */
const BUSY_MS = 2000
/** 打った文字のこだま（入力の直後の出力）は、AI の作業に数えない */
const ECHO_MS = 300

interface Term {
  proc: pty.IPty | null
  buf: string
  frame: WebFrameMain | null
  starting: boolean
  cols: number
  rows: number
  /** いまのプロセスが何か出力したか、最後に出力した時刻、起動した時刻 */
  started: boolean
  lastOut: number
  /** AI が作業として出力した最後の時刻（打った文字のこだまは除く）。作業中かの判定に使う */
  lastWork: number
  /** 人が最後に打った時刻 */
  lastInput: number
  spawnedAt: number
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
  /** 同梱のスキルの版。会話に記録し、版が変わったら新しい会話にする */
  skillVersion: string
  /** その版の CHANGELOG の要点。版が変わって新しい会話にしたとき、最初に出す */
  changes: string[]
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
  /** 刷新のために止めたプロセス（「終了しました」を出さない） */
  private killed = new WeakSet<pty.IPty>()
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
    t.lastInput = Date.now()
    if (t.proc) t.proc.write(data)
    else if (!t.starting && data.includes('\r')) restart()
  }

  /**
   * ［新しい形にする］のとき、そのプロジェクトのチャットを刷新する。動いている AI を止め、会話の記録を消してから、
   * 開いている右の窓は新しい会話で起動し直す（古い会話の中身は消さない。続けなくなるだけ）
   */
  renewProject(project: Project, ai: AiKind, first?: { screen: string; text: string }): void {
    saveBook(this.bookFile, renewFolder(loadBook(this.bookFile), project.folder))
    // 新しい会話で最初に送る文（作り直しの作業など）。起動時の引数で渡すので、起動の前に積んでおく
    if (first) this.term(project.id, first.screen, 100, 30).queue.unshift({ text: first.text, at: Date.now() })
    for (const [key, t] of this.terms) {
      if (!key.startsWith(`${project.id}:`)) continue
      const p = t.proc
      t.proc = null
      if (p) {
        this.killed.add(p)
        killTree(p.pid, () => p.kill())
      }
      // 画面に残った前の会話を消してから始める
      t.buf = ''
      this.toPane(t, '\x1bc')
      if (!t.starting) void this.start(t, project, key.slice(project.id.length + 1), ai)
    }
  }

  /**
   * 設定で AI や確認のモードを変えたとき、そのプロジェクトのチャットを起動し直す（会話は続ける）。
   * 開いていない画面は、次に開いたときに新しい設定で起動する
   */
  restartProject(project: Project, ai: AiKind): void {
    for (const [key, t] of this.terms) {
      if (!key.startsWith(`${project.id}:`)) continue
      const p = t.proc
      t.proc = null
      if (p) {
        this.killed.add(p)
        killTree(p.pid, () => p.kill())
      }
      t.buf = ''
      this.toPane(t, '\x1bc')
      if (!t.starting) void this.start(t, project, key.slice(project.id.length + 1), ai)
    }
  }

  /** プロジェクトを外す・フォルダを変えるとき。そのプロジェクトの AI を止めて、ターミナルを捨てる */
  killProject(projectId: string): void {
    for (const [key, t] of [...this.terms]) {
      if (!key.startsWith(`${projectId}:`)) continue
      const p = t.proc
      t.proc = null
      if (p) {
        this.killed.add(p)
        killTree(p.pid, () => p.kill())
      }
      this.terms.delete(key)
    }
  }

  /** その画面の AI が作業中か（起動中・送る文が残っている・少し前まで出力していた） */
  busy(projectId: string, screen: string): boolean {
    const t = this.terms.get(`${projectId}:${screen}`)
    if (!t) return false
    return t.starting || t.queue.length > 0 || (!!t.proc && Date.now() - t.lastWork < BUSY_MS)
  }

  /** そのプロジェクトで AI が作業中の画面（一覧の札に出す） */
  busyScreens(projectId: string): string[] {
    const out: string[] = []
    for (const key of this.terms.keys()) {
      if (!key.startsWith(`${projectId}:`)) continue
      const screen = key.slice(projectId.length + 1)
      if (this.busy(projectId, screen)) out.push(screen)
    }
    return out.sort()
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
      t = { proc: null, buf: '', frame: null, starting: false, cols, rows, started: false, lastOut: 0, lastWork: 0, lastInput: 0, spawnedAt: 0, queue: [], flushing: false }
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
        const now = Date.now()
        const ready = t.proc && t.started && now - t.lastOut >= QUIET_MS && now - t.spawnedAt >= STARTUP_MS
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
      // 動くもの・アプリが使う機能があるものだけを使う（nodenv の入口や古い版は飛ばす）
      const cmd = (await resolveCli(ai)).cmd
      if (!cmd) {
        const name = ai === 'claude' ? 'Claude Code' : 'Codex'
        this.out(t, `\r\n${name} が使えません。右上の ⚙（設定）の「AI」で［入れる］を押し、終わったらここで Enter を押してください。\r\n`)
        return
      }
      const env = await childEnv()
      const book = loadBook(this.bookFile)
      let id = findSession(book, readChatSessions(project.folder), project.folder, screen, ai, this.paths.skillVersion)
      // スキルの版が変わって新しい会話にするときは、何が変わったかを先に出す
      const prev = book[project.folder]?.screens[screen]?.[ai]?.skill
      if (!id && prev && prev !== this.paths.skillVersion) {
        const lines = [`スキルが ${this.paths.skillVersion} になりました。`, ...this.paths.changes.slice(0, 5).map((c) => `・${c}`)]
        this.out(t, lines.map((l) => `\x1b[1m${l}\x1b[0m\r\n`).join('') + '\r\n')
      }
      // 新しい会話を始めるときは、そう出す（版が変わった・刷新した・初めて）
      if (!id) this.out(t, `\x1b[2m新しい会話を始めます（スキル ${this.paths.skillVersion}）\x1b[0m\r\n`)
      const instructions = codexInstructions(this.paths.skillDir)
      if (ai === 'claude') id ??= randomUUID()
      else if (!id) {
        this.out(t, 'codex の会話を作っています（30秒ほど）…\r\n')
        id = await this.createCodexThread(cmd.file, cmd.args, project, screen, instructions, env)
        if (!id) {
          this.out(t, 'codex の会話を作れませんでした。codex にログインしているかを確かめて、Enter を押してください。\r\n')
          return
        }
      }
      saveBook(this.bookFile, recordSession(loadBook(this.bookFile), project.folder, screen, ai, id, this.paths.skillVersion))

      // 会話を始めるときに送る文は、貼り付けずに起動時の引数で渡す（起動直後の貼り付けは捨てられる）。
      // 起動の準備のあいだに積まれた文も含めて、ここで1つ拾う
      const prompt = t.queue.shift()?.text
      const args =
        ai === 'claude'
          ? claudeArgs({ sessionId: id, exists: claudeSessionExists(id), pluginDir: this.paths.pluginDir, promptFile: this.promptFile, model: claudeModel(), prompt, autoApprove: project.perm === 'auto' })
          : codexArgs({ threadId: id, instructions, prompt, autoApprove: project.perm === 'auto' })
      const proc = pty.spawn(cmd.file, [...cmd.args, ...args], { name: 'xterm-256color', cols: t.cols, rows: t.rows, cwd: project.folder, env: env as Record<string, string> })
      t.proc = proc
      t.started = false
      t.spawnedAt = Date.now()
      proc.onData((d) => {
        // 刷新のために止めたプロセスの残りの出力は、新しい会話の画面に出さない
        if (this.killed.has(proc)) return
        t.started = true
        t.lastOut = Date.now()
        if (t.lastOut - t.lastInput > ECHO_MS) t.lastWork = t.lastOut
        this.out(t, d)
      })
      proc.onExit(() => {
        if (t.proc === proc) t.proc = null
        if (this.killed.has(proc)) return
        this.out(t, '\r\n\x1b[2m終了しました。Enter で開き直します。\x1b[0m\r\n')
      })
    } finally {
      t.starting = false
    }
  }

  private createCodexThread(file: string, pre: string[], project: Project, screen: string, instructions: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const prompt = `これは ${project.name} の Rising Loop の右のチャット（${screen}）専用の窓口です。返事は「了解」だけ。`
    return new Promise((resolve) => {
      const child = execFile(file, [...pre, ...codexCreateArgs({ instructions, prompt })], { cwd: project.folder, env, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) =>
        resolve(parseCodexThreadId(String(stdout ?? '')))
      )
      child.stdin?.end()
    })
  }
}
