import { describe, expect, it } from 'vitest'
import { cliCandidatesIn, findCliIn, installCommand, killCommand, loginArgs, navKeyDir, needsBundledPython, parseLoggedIn, resolveWinShim, windowChrome, withBundledPython } from '../../src/main/platform'

const fsOf = (files: Record<string, string>) => ({
  exists: (p: string) => p in files,
  read: (p: string) => (p in files ? files[p] : null)
})

describe('findCliIn（Mac）', () => {
  const base = { platform: 'darwin' as const, name: 'claude', override: undefined, home: '/Users/t' }

  it('環境変数で指定された場所を最初に使う', () => {
    const fs = fsOf({ '/x/my-claude': '', '/usr/local/bin/claude': '' })
    expect(findCliIn({ ...base, override: '/x/my-claude', path: '/usr/local/bin', ...fs })).toEqual({ file: '/x/my-claude', args: [] })
  })

  it('PATH の順に探す', () => {
    const fs = fsOf({ '/b/claude': '', '/c/claude': '' })
    expect(findCliIn({ ...base, path: '/a:/b:/c', ...fs })).toEqual({ file: '/b/claude', args: [] })
  })

  it('PATH に無ければ、よくある置き場所を見る', () => {
    const fs = fsOf({ '/Users/t/.local/bin/claude': '' })
    expect(findCliIn({ ...base, path: '/usr/bin', ...fs })).toEqual({ file: '/Users/t/.local/bin/claude', args: [] })
  })

  it('どこにも無ければ null', () => {
    expect(findCliIn({ ...base, path: '/usr/bin', ...fsOf({}) })).toBeNull()
  })
})

describe('cliCandidatesIn（候補の並び）', () => {
  const base = { platform: 'darwin' as const, name: 'codex', override: undefined, home: '/Users/t' }
  it('アプリが［入れる］で入れる置き場所（~/.local/bin）を、PATH より先に見る。同じ場所は1回だけ', () => {
    const fs = fsOf({ '/Users/t/.nodenv/shims/codex': '', '/Users/t/.local/bin/codex': '', '/opt/homebrew/bin/codex': '' })
    expect(cliCandidatesIn({ ...base, path: '/Users/t/.nodenv/shims:/Users/t/.local/bin:/opt/homebrew/bin', ...fs }).map((c) => c.file)).toEqual([
      '/Users/t/.local/bin/codex',
      '/Users/t/.nodenv/shims/codex',
      '/opt/homebrew/bin/codex'
    ])
  })
  it('環境変数で指定されていれば、それだけ（無ければ空）', () => {
    const fs = fsOf({ '/x/codex': '', '/Users/t/.local/bin/codex': '' })
    expect(cliCandidatesIn({ ...base, override: '/x/codex', path: '', ...fs }).map((c) => c.file)).toEqual(['/x/codex'])
    expect(cliCandidatesIn({ ...base, override: '/nope', path: '', ...fs })).toEqual([])
  })
})

describe('findCliIn（Windows）', () => {
  const base = { platform: 'win32' as const, name: 'claude', override: undefined, home: 'C:\\Users\\t' }

  it('.exe を .cmd より先に使う', () => {
    const fs = fsOf({ 'C:\\bin\\claude.cmd': '', 'C:\\bin\\claude.exe': '' })
    expect(findCliIn({ ...base, path: 'C:\\bin', ...fs })).toEqual({ file: 'C:\\bin\\claude.exe', args: [] })
  })

  it('PATH は ; で区切る', () => {
    const fs = fsOf({ 'D:\\tools\\claude.exe': '' })
    expect(findCliIn({ ...base, path: 'C:\\Windows;D:\\tools', ...fs })).toEqual({ file: 'D:\\tools\\claude.exe', args: [] })
  })

  it('公式のインストーラーの置き場所（~\\.local\\bin）を見る', () => {
    const fs = fsOf({ 'C:\\Users\\t\\.local\\bin\\claude.exe': '' })
    expect(findCliIn({ ...base, path: 'C:\\Windows', ...fs })).toEqual({ file: 'C:\\Users\\t\\.local\\bin\\claude.exe', args: [] })
  })

  it('npm の .cmd は、cmd.exe を通さずに中身の node スクリプトを node で起動する', () => {
    const shim = '@ECHO off\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n'
    const fs = fsOf({ 'C:\\npm\\codex.cmd': shim, 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': '', 'C:\\nodejs\\node.exe': '' })
    expect(findCliIn({ ...base, name: 'codex', path: 'C:\\npm;C:\\nodejs', ...fs })).toEqual({
      file: 'C:\\nodejs\\node.exe',
      args: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']
    })
  })
})

describe('resolveWinShim', () => {
  it('.cmd の隣に node.exe があればそれを使う', () => {
    const shim = '"%dp0%\\node.exe"  "%dp0%\\node_modules\\x\\cli.js" %*'
    const fs = fsOf({ 'C:\\n\\node.exe': '', 'C:\\n\\node_modules\\x\\cli.js': '' })
    expect(resolveWinShim('C:\\n\\x.cmd', shim, [], fs.exists)).toEqual({ file: 'C:\\n\\node.exe', args: ['C:\\n\\node_modules\\x\\cli.js'] })
  })

  it('中身が .exe を指していれば、その .exe を直接起動する', () => {
    const shim = '@"%~dp0\\..\\pkg\\bin\\tool.exe" %*'
    const fs = fsOf({ 'C:\\pkg\\bin\\tool.exe': '' })
    expect(resolveWinShim('C:\\npm\\tool.cmd', shim, [], fs.exists)).toEqual({ file: 'C:\\pkg\\bin\\tool.exe', args: [] })
  })

  it('読み解けなければ null', () => {
    expect(resolveWinShim('C:\\npm\\tool.cmd', 'echo hi', [], () => false)).toBeNull()
  })
})

describe('killCommand', () => {
  it('Windows は taskkill で子や孫までまとめて止める', () => {
    expect(killCommand('win32', 1234)).toEqual({ file: 'taskkill', args: ['/PID', '1234', '/T', '/F'] })
  })
  it('Mac は node-pty の kill に任せる', () => {
    expect(killCommand('darwin', 1234)).toBeNull()
  })
})

describe('windowChrome', () => {
  it('Mac は左に閉じる・最小化ボタンの余白を取り、ボタンをタブの列の上下の真ん中に置く', () => {
    expect(windowChrome('darwin', 48)).toMatchObject({ titleBarStyle: 'hiddenInset', controls: 'left', trafficLightPosition: { x: 16, y: 16 } })
  })
  it('Windows は右にウィンドウのボタンを重ね、高さと色をタブの列（濃い列）に合わせる', () => {
    expect(windowChrome('win32', 48)).toMatchObject({ titleBarStyle: 'hidden', controls: 'right', titleBarOverlay: { color: '#1c1c1b', symbolColor: '#c8c8c4', height: 48 } })
  })
})

describe('入れる・ログインのコマンド', () => {
  it('claude を入れる：Mac は公式の install.sh、Windows は公式の install.ps1', () => {
    expect(installCommand('claude', 'darwin')).toEqual({ file: '/bin/zsh', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'] })
    expect(installCommand('claude', 'win32')).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] })
  })
  it('codex を入れる：Node が無くても入るよう、公式の Releases から1つのファイルを落として ~/.local/bin に置く', () => {
    const mac = installCommand('codex', 'darwin')
    expect(mac.file).toBe('/bin/zsh')
    expect(mac.args[0]).toBe('-lc')
    expect(mac.args[1]).toContain('https://github.com/openai/codex/releases/latest/download/codex-$a-apple-darwin.tar.gz')
    expect(mac.args[1]).toContain('$HOME/.local/bin')
    expect(mac.args[1]).not.toContain('npm')
    const win = installCommand('codex', 'win32')
    expect(win.file).toBe('powershell.exe')
    expect(win.args.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command'])
    expect(win.args[4]).toContain('https://github.com/openai/codex/releases/latest/download/codex-x86_64-pc-windows-msvc.exe.zip')
    expect(win.args[4]).toContain("'codex.exe'")
    expect(win.args[4]).not.toContain('npm')
  })
  it('ログイン：claude は auth login、codex は login', () => {
    expect(loginArgs('claude')).toEqual(['auth', 'login'])
    expect(loginArgs('codex')).toEqual(['login'])
  })
})

describe('ログインの状態を読む', () => {
  it('claude は auth status の JSON の loggedIn', () => {
    expect(parseLoggedIn('claude', '{"loggedIn": true, "authMethod": "claude.ai"}', 0)).toBe(true)
    expect(parseLoggedIn('claude', '{"loggedIn": false}', 0)).toBe(false)
    expect(parseLoggedIn('claude', 'error', 1)).toBe(false)
  })
  it('codex は login status が成功して「Logged in」を含むか', () => {
    expect(parseLoggedIn('codex', 'Logged in using ChatGPT', 0)).toBe(true)
    expect(parseLoggedIn('codex', 'Not logged in', 1)).toBe(false)
  })
})

describe('戻る・進むのキー（Chrome・Safari と同じ）', () => {
  const key = (k: string, mods: { meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean } = {}, type = 'keyDown') => ({ type, key: k, meta: false, control: false, alt: false, shift: false, ...mods })
  it('Mac は ⌘[ ⌘] と ⌘← ⌘→', () => {
    expect(navKeyDir(key('[', { meta: true }), 'darwin')).toBe(-1)
    expect(navKeyDir(key(']', { meta: true }), 'darwin')).toBe(1)
    expect(navKeyDir(key('ArrowLeft', { meta: true }), 'darwin')).toBe(-1)
    expect(navKeyDir(key('ArrowRight', { meta: true }), 'darwin')).toBe(1)
  })
  it('Mac で ⌘ が無い・ほかの修飾キーが混ざる・離したときは何もしない', () => {
    expect(navKeyDir(key('['), 'darwin')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { alt: true }), 'darwin')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { meta: true, alt: true }), 'darwin')).toBeNull()
    expect(navKeyDir(key('[', { meta: true, control: true }), 'darwin')).toBeNull()
    expect(navKeyDir(key('[', { meta: true }, 'keyUp'), 'darwin')).toBeNull()
  })
  it('戻る・進む専用のキー（BrowserBack・BrowserForward）は、どの OS でも修飾キーなしで効く', () => {
    for (const os of ['darwin', 'win32', 'linux'] as const) {
      expect(navKeyDir(key('BrowserBack'), os)).toBe(-1)
      expect(navKeyDir(key('BrowserForward'), os)).toBe(1)
      expect(navKeyDir(key('BrowserBack', { shift: true }), os)).toBeNull()
      expect(navKeyDir(key('BrowserBack', { meta: true }), os)).toBeNull()
    }
  })
  it('Windows は Alt+← Alt+→ だけ', () => {
    expect(navKeyDir(key('ArrowLeft', { alt: true }), 'win32')).toBe(-1)
    expect(navKeyDir(key('ArrowRight', { alt: true }), 'win32')).toBe(1)
    expect(navKeyDir(key('[', { control: true }), 'win32')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { alt: true, control: true }), 'win32')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { meta: true }), 'win32')).toBeNull()
  })
})

describe('同梱の Python を使うか', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p)
  it('Mac：PATH に本物の python3 があれば使わない', () => {
    expect(needsBundledPython({ platform: 'darwin', path: '/opt/homebrew/bin:/usr/bin', exists: has('/opt/homebrew/bin/python3', '/usr/bin/python3'), macTools: false })).toBe(false)
    expect(needsBundledPython({ platform: 'darwin', path: '/usr/bin', exists: has('/usr/bin/python3'), macTools: true })).toBe(false)
  })
  it('Mac：/usr/bin/python3 しか無く、コマンドラインツールが入っていなければ使う（それは入れるよう促すだけの代役）', () => {
    expect(needsBundledPython({ platform: 'darwin', path: '/usr/bin:/bin', exists: has('/usr/bin/python3'), macTools: false })).toBe(true)
  })
  it('Mac：python3 がどこにも無ければ使う', () => {
    expect(needsBundledPython({ platform: 'darwin', path: '/usr/bin:/bin', exists: has(), macTools: true })).toBe(true)
  })
  it('Windows：Microsoft Store へ案内するだけの python3（WindowsApps の中）は数えない', () => {
    const apps = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps'
    expect(needsBundledPython({ platform: 'win32', path: apps, exists: has(apps + '\\python3.exe'), macTools: false })).toBe(true)
    expect(needsBundledPython({ platform: 'win32', path: 'C:\\Python312;' + apps, exists: has('C:\\Python312\\python3.exe'), macTools: false })).toBe(false)
  })
  it('PATH の先頭に足す（Mac は bin、Windows はフォルダそのもの。Windows は Path の名前のままにする）', () => {
    expect(withBundledPython({ PATH: '/usr/bin' }, '/App/Resources/python', 'darwin')).toEqual({ PATH: '/App/Resources/python/bin:/usr/bin' })
    expect(withBundledPython({ Path: 'C:\\Windows' }, 'C:\\App\\python', 'win32')).toEqual({ Path: 'C:\\App\\python;C:\\App\\python\\Scripts;C:\\Windows' })
  })
})
