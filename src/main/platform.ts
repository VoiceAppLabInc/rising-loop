// OS ごとに違う部分をここにまとめる（claude / codex の探し方・環境変数・プロセスの止め方・ウィンドウの枠）。
// 手元に Windows が無いので、win32 の分岐は単体テストで確かめただけで、実機では動かしていない。
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export type Platform = NodeJS.Platform

export interface Command {
  file: string
  args: string[]
}

interface Fs {
  exists: (p: string) => boolean
  read: (p: string) => string | null
}

/** 子プロセスに渡すと、対話の claude が「子の会話」とみなされて会話が保存されないなどの違いが出る目印 */
const CLAUDE_CODE_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_CODE_SSE_PORT']

/** PATH に無いときに見る、よくある置き場所 */
function knownDirs(platform: Platform, home: string): string[] {
  if (platform === 'win32') return [win32.join(home, '.local', 'bin'), win32.join(home, 'AppData', 'Roaming', 'npm')]
  return [posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
}

/**
 * CLI の探し方: 環境変数での指定 → PATH → よくある置き場所。
 * Windows では .exe を先に使う。npm の .cmd は cmd.exe を通さずに中身を直接起動する
 * （cmd.exe を通すと、日本語や空白を含む引数が壊れやすい）。
 */
export function findCliIn(o: { platform: Platform; name: string; override: string | undefined; path: string; home: string } & Fs): Command | null {
  if (o.override && o.exists(o.override)) return { file: o.override, args: [] }
  const win = o.platform === 'win32'
  const p = win ? win32 : posix
  const pathDirs = o.path.split(win ? ';' : ':').filter(Boolean)
  const dirs = [...pathDirs, ...knownDirs(o.platform, o.home)]
  const exts = win ? ['.exe', '.cmd'] : ['']
  for (const ext of exts) {
    for (const dir of dirs) {
      const f = p.join(dir, o.name + ext)
      if (!o.exists(f)) continue
      if (ext !== '.cmd') return { file: f, args: [] }
      const shim = o.read(f)
      const resolved = shim == null ? null : resolveWinShim(f, shim, pathDirs, o.exists)
      return resolved ?? { file: 'cmd.exe', args: ['/d', '/s', '/c', f] }
    }
  }
  return null
}

/** npm が作る .cmd の中身から、実際に起動するもの（node とスクリプト、または .exe）を読み取る */
export function resolveWinShim(cmdPath: string, content: string, pathDirs: string[], exists: (p: string) => boolean): Command | null {
  const dir = win32.dirname(cmdPath)
  const paths = [...content.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((t) => /%~?dp0%?/i.test(t))
    .map((t) => win32.normalize(t.replace(/%~dp0|%dp0%/i, dir)))
  const script = paths.find((t) => /\.(c|m)?js$/i.test(t) && exists(t))
  if (script) {
    const node =
      paths.find((t) => /\\node\.exe$/i.test(t) && exists(t)) ??
      pathDirs.map((d) => win32.join(d, 'node.exe')).find(exists) ??
      'node.exe'
    return { file: node, args: [script] }
  }
  const exe = paths.find((t) => /\.exe$/i.test(t) && !/\\node\.exe$/i.test(t) && exists(t))
  return exe ? { file: exe, args: [] } : null
}

/** 止めるときのコマンド。Windows は子や孫のプロセスが残るので taskkill でまとめて止める */
export function killCommand(platform: Platform, pid: number): Command | null {
  return platform === 'win32' ? { file: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] } : null
}

/** ウィンドウの枠。controls はウィンドウのボタンがタブの列のどちら側に来るか */
export function windowChrome(platform: Platform): {
  titleBarStyle: 'hiddenInset' | 'hidden' | 'default'
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
  controls: 'left' | 'right' | 'none'
} {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', controls: 'left' }
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f4f5f7', symbolColor: '#1d1e22', height: 40 }, controls: 'right' }
  return { titleBarStyle: 'default', controls: 'none' }
}

/** 公式の手順で入れる。claude は公式のインストーラー、codex は npm（Node が要る） */
export function installCommand(ai: 'claude' | 'codex', platform: Platform): Command {
  const win = platform === 'win32'
  if (ai === 'claude')
    return win
      ? { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] }
      : { file: '/bin/zsh', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'] }
  return win ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'npm install -g @openai/codex'] } : { file: '/bin/zsh', args: ['-lc', 'npm install -g @openai/codex'] }
}

/** ログインは公式のコマンドで、ブラウザに任せる（アプリはトークンを扱わない） */
export const loginArgs = (ai: 'claude' | 'codex'): string[] => (ai === 'claude' ? ['auth', 'login'] : ['login'])
/** ログインの状態を調べるコマンドの引数 */
export const statusArgs = (ai: 'claude' | 'codex'): string[] => (ai === 'claude' ? ['auth', 'status'] : ['login', 'status'])

export function parseLoggedIn(ai: 'claude' | 'codex', out: string, code: number): boolean {
  if (ai === 'claude') {
    try {
      return JSON.parse(out).loggedIn === true
    } catch {
      return false
    }
  }
  return code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)
}

// ── ここから下は実際の OS に触る部分 ──

let shellEnv: Promise<NodeJS.ProcessEnv> | null = null

/**
 * Mac はログインシェルの環境変数を読む（VS Code と同じ方式）。Finder から開いたアプリには、シェルで足した PATH が付かないため。
 * Windows はアプリにそのまま付いてくるので読まない。
 */
export function loadShellEnv(): Promise<NodeJS.ProcessEnv> {
  shellEnv ??= readShellEnv()
  return shellEnv
}

function readShellEnv(): Promise<NodeJS.ProcessEnv> {
  // テストでは読まない（ログインシェルの起動に数秒かかり、テストの待ち時間を食うため）
  if (process.platform === 'win32' || process.env.RISING_LOOP_APP_SKIP_SHELL_ENV === '1') return Promise.resolve({ ...process.env })
  const shell = process.env.SHELL || '/bin/zsh'
  const mark = '__RLA_ENV__'
  const script = `process.stdout.write('${mark}'+JSON.stringify(process.env)+'${mark}')`
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `'${process.execPath}' -e "${script}"`],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        try {
          if (err) throw err
          const env = JSON.parse(stdout.split(mark)[1]) as NodeJS.ProcessEnv
          delete env.ELECTRON_RUN_AS_NODE
          resolve({ ...process.env, ...env })
        } catch {
          resolve({ ...process.env })
        }
      }
    )
  })
}

/** claude / codex に渡す環境変数 */
export async function childEnv(): Promise<NodeJS.ProcessEnv> {
  const env = { ...(await loadShellEnv()) }
  for (const k of CLAUDE_CODE_MARKERS) delete env[k]
  delete env.ELECTRON_RUN_AS_NODE
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}

const OVERRIDE: Record<string, string> = { claude: 'RISING_LOOP_APP_CLAUDE_PATH', codex: 'RISING_LOOP_APP_CODEX_PATH' }

export async function findCli(name: 'claude' | 'codex'): Promise<Command | null> {
  const env = await loadShellEnv()
  return findCliIn({
    platform: process.platform,
    name,
    override: env[OVERRIDE[name]] ?? process.env[OVERRIDE[name]],
    path: env.PATH ?? env.Path ?? '',
    home: homedir(),
    exists: existsSync,
    read: (p) => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return null
      }
    }
  })
}

export function killTree(pid: number, fallback: () => void): void {
  const k = killCommand(process.platform, pid)
  if (!k) return fallback()
  execFile(k.file, k.args, { windowsHide: true }, () => undefined)
}
