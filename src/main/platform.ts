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

/** アプリの［入れる］（公式の単体版）が入れる置き場所。ここを最初に見る（Node の切り替えなどに左右されない） */
const officialDir = (platform: Platform, home: string) => (platform === 'win32' ? win32.join(home, '.local', 'bin') : posix.join(home, '.local', 'bin'))

/**
 * CLI の候補を、使いたい順に並べる：環境変数での指定（あればそれだけ）→ アプリが入れる置き場所（~/.local/bin）→ PATH → よくある置き場所。
 * 入っているかではなく「動くか」で選ぶのは aiCli.ts の pickCli（nodenv の入口のように、あっても動かないものがあるため）。
 * Windows では .exe を先に使う。npm の .cmd は cmd.exe を通さずに中身を直接起動する（cmd.exe を通すと、日本語や空白を含む引数が壊れやすい）
 */
export function cliCandidatesIn(o: { platform: Platform; name: string; override: string | undefined; path: string; home: string } & Fs): Command[] {
  if (o.override) return o.exists(o.override) ? [{ file: o.override, args: [] }] : []
  const win = o.platform === 'win32'
  const p = win ? win32 : posix
  const pathDirs = o.path.split(win ? ';' : ':').filter(Boolean)
  const dirs = [...new Set([officialDir(o.platform, o.home), ...pathDirs, ...knownDirs(o.platform, o.home)])]
  const exts = win ? ['.exe', '.cmd'] : ['']
  const out: Command[] = []
  for (const ext of exts) {
    for (const dir of dirs) {
      const f = p.join(dir, o.name + ext)
      if (!o.exists(f)) continue
      if (ext !== '.cmd') {
        out.push({ file: f, args: [] })
        continue
      }
      const shim = o.read(f)
      const resolved = shim == null ? null : resolveWinShim(f, shim, pathDirs, o.exists)
      out.push(resolved ?? { file: 'cmd.exe', args: ['/d', '/s', '/c', f] })
    }
  }
  return out
}

/** いちばん目の候補（動くかは見ない）。テストと、動くかを確かめる前の目安に使う */
export function findCliIn(o: Parameters<typeof cliCandidatesIn>[0]): Command | null {
  return cliCandidatesIn(o)[0] ?? null
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
export function windowChrome(
  platform: Platform,
  barHeight: number
): {
  titleBarStyle: 'hiddenInset' | 'hidden' | 'default'
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
  trafficLightPosition?: { x: number; y: number }
  controls: 'left' | 'right' | 'none'
} {
  // Mac の閉じる・最小化・最大化のボタンを、タブの列の上下の真ん中に置く（見た目の真ん中は y から約 8px 下。48px の列なら y は 16）
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: Math.round(barHeight / 2) - 8 }, controls: 'left' }
  // Windows の最小化・最大化・閉じるのボタンは、タブの列（濃い列）と同じ高さ・色にする（style.css の --bar・--bar-fg）
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1c1c1b', symbolColor: '#c8c8c4', height: barHeight }, controls: 'right' }
  return { titleBarStyle: 'default', controls: 'none' }
}

const CODEX_DL = 'https://github.com/openai/codex/releases/latest/download'

/**
 * 公式の手順で入れる。claude は公式のインストーラー。codex は公式の Releases から1つのファイルを落として ~/.local/bin に置く
 * （npm で入れると Node が要る。初めての人は Node を入れていないことが多い）。~/.local/bin は findCli が見る置き場所
 */
export function installCommand(ai: 'claude' | 'codex', platform: Platform): Command {
  const win = platform === 'win32'
  if (ai === 'claude')
    return win
      ? { file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] }
      : { file: '/bin/zsh', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'] }
  if (win)
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "$ErrorActionPreference='Stop'; $d=Join-Path $env:USERPROFILE '.local\\bin'; New-Item -ItemType Directory -Force $d | Out-Null; " +
          `$z=Join-Path $env:TEMP 'codex.zip'; Invoke-WebRequest -UseBasicParsing '${CODEX_DL}/codex-x86_64-pc-windows-msvc.exe.zip' -OutFile $z; ` +
          "Expand-Archive -Force $z $d; Move-Item -Force (Join-Path $d 'codex-x86_64-pc-windows-msvc.exe') (Join-Path $d 'codex.exe'); Remove-Item $z; " +
          "Write-Output \"codex を $d に入れました\""
      ]
    }
  return {
    file: '/bin/zsh',
    args: [
      '-lc',
      'set -e; d="$HOME/.local/bin"; mkdir -p "$d"; a=$(uname -m); [ "$a" = arm64 ] && a=aarch64; ' +
        `curl -fL --progress-bar "${CODEX_DL}/codex-$a-apple-darwin.tar.gz" | tar -xz -C "$d"; ` +
        'mv -f "$d/codex-$a-apple-darwin" "$d/codex"; echo "codex を $d に入れました"'
    ]
  }
}

/**
 * 同梱の Python を使うか。スキルの数字取りのスクリプトは python3 で動く。本物の python3 があればそれを使い、無いときだけ同梱のものを足す。
 * Mac の /usr/bin/python3 は、コマンドラインツール（Xcode）が無いと「入れますか」と出すだけの代役なので、そのときは無いとみなす。
 * Windows の WindowsApps の中の python3 は、Microsoft Store へ案内するだけの代役なので数えない
 */
export function needsBundledPython(o: { platform: Platform; path: string; exists: (p: string) => boolean; macTools: boolean }): boolean {
  const win = o.platform === 'win32'
  const p = win ? win32 : posix
  for (const dir of o.path.split(win ? ';' : ':').filter(Boolean)) {
    if (win && /\\WindowsApps\\?$/i.test(dir)) continue
    const f = p.join(dir, win ? 'python3.exe' : 'python3')
    if (!o.exists(f)) continue
    if (!win && f === '/usr/bin/python3' && !o.macTools) continue
    return false
  }
  return true
}

/** 同梱の Python を PATH の先頭に足す。Mac は bin/、Windows はフォルダそのもの（python.exe・python3.exe がある）と Scripts\\ */
export function withBundledPython(env: NodeJS.ProcessEnv, dir: string, platform: Platform): NodeJS.ProcessEnv {
  const win = platform === 'win32'
  const key = win ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path') : 'PATH'
  const add = win ? [dir, win32.join(dir, 'Scripts')] : [posix.join(dir, 'bin')]
  const rest = env[key]
  return { ...env, [key]: [...add, ...(rest ? [rest] : [])].join(win ? ';' : ':') }
}

/** ログインは公式のコマンドで、ブラウザに任せる（アプリはトークンを扱わない） */
/**
 * 戻る・進むのキー（Chrome・Safari と同じ）。戻るなら -1、進むなら 1、ほかは null。
 * Mac は ⌘[ ⌘] と ⌘← ⌘→、Windows などは Alt+← Alt+→。ほかの修飾キーが混ざっていれば何もしない。
 * 戻る・進む専用のキー（BrowserBack・BrowserForward。一部のキーボードにある）は、どの OS でも修飾キーなしで効く
 */
export function navKeyDir(
  input: { type: string; key: string; meta: boolean; control: boolean; alt: boolean; shift: boolean },
  platform: Platform
): -1 | 1 | null {
  if (input.type !== 'keyDown') return null
  if (input.key === 'BrowserBack' || input.key === 'BrowserForward') {
    if (input.meta || input.control || input.alt || input.shift) return null
    return input.key === 'BrowserBack' ? -1 : 1
  }
  if (platform === 'darwin') {
    if (!input.meta || input.control || input.alt) return null
    if (input.key === '[' || input.key === 'ArrowLeft') return -1
    if (input.key === ']' || input.key === 'ArrowRight') return 1
    return null
  }
  if (!input.alt || input.control || input.meta) return null
  if (input.key === 'ArrowLeft') return -1
  if (input.key === 'ArrowRight') return 1
  return null
}

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

/** 同梱の Python の置き場所（index が起動したときに決める。無ければ足さない） */
let bundledPython: string | null = null
export function setBundledPython(dir: string | null): void {
  bundledPython = dir && existsSync(dir) ? dir : null
}

let macTools: Promise<boolean> | null = null
/** Mac のコマンドラインツール（Xcode）が入っているか。xcode-select -p が通れば入っている */
function hasMacTools(): Promise<boolean> {
  macTools ??= new Promise((resolve) => execFile('xcode-select', ['-p'], { timeout: 5000 }, (err) => resolve(!err)))
  return macTools
}

/** claude / codex に渡す環境変数 */
export async function childEnv(): Promise<NodeJS.ProcessEnv> {
  let env = { ...(await loadShellEnv()) }
  for (const k of CLAUDE_CODE_MARKERS) delete env[k]
  delete env.ELECTRON_RUN_AS_NODE
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // アプリの中で動いている目印。~/.claude/skills に残ったスキル版の案内（legacy/rising-loop）は、これを見て黙る
  env.RISING_LOOP_APP = '1'
  if (bundledPython) {
    const path = env.PATH ?? env.Path ?? ''
    const tools = process.platform === 'darwin' ? await hasMacTools() : false
    if (needsBundledPython({ platform: process.platform, path, exists: existsSync, macTools: tools })) env = withBundledPython(env, bundledPython, process.platform)
  }
  return env
}

const OVERRIDE: Record<string, string> = { claude: 'RISING_LOOP_APP_CLAUDE_PATH', codex: 'RISING_LOOP_APP_CODEX_PATH' }

/** claude / codex の候補（使いたい順）。動くかは aiCli.ts の resolveCli が確かめる */
export async function cliCandidates(name: 'claude' | 'codex'): Promise<Command[]> {
  const env = await loadShellEnv()
  return cliCandidatesIn({
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
