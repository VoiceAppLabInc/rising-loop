import { describe, expect, it } from 'vitest'
import { findCliIn, installCommand, killCommand, loginArgs, navKeyDir, parseLoggedIn, resolveWinShim, windowChrome } from '../../src/main/platform'

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
  it('Mac は左に閉じる・最小化ボタンの余白を取る', () => {
    expect(windowChrome('darwin')).toMatchObject({ titleBarStyle: 'hiddenInset', controls: 'left' })
  })
  it('Windows は右にウィンドウのボタンを重ねる', () => {
    expect(windowChrome('win32')).toMatchObject({ titleBarStyle: 'hidden', controls: 'right' })
    expect(windowChrome('win32').titleBarOverlay).toBeTruthy()
  })
})

describe('入れる・ログインのコマンド', () => {
  it('claude を入れる：Mac は公式の install.sh、Windows は公式の install.ps1', () => {
    expect(installCommand('claude', 'darwin')).toEqual({ file: '/bin/zsh', args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'] })
    expect(installCommand('claude', 'win32')).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'] })
  })
  it('codex を入れる：npm で入れる', () => {
    expect(installCommand('codex', 'darwin')).toEqual({ file: '/bin/zsh', args: ['-lc', 'npm install -g @openai/codex'] })
    expect(installCommand('codex', 'win32')).toEqual({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'npm install -g @openai/codex'] })
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
  it('Windows は Alt+← Alt+→ だけ', () => {
    expect(navKeyDir(key('ArrowLeft', { alt: true }), 'win32')).toBe(-1)
    expect(navKeyDir(key('ArrowRight', { alt: true }), 'win32')).toBe(1)
    expect(navKeyDir(key('[', { control: true }), 'win32')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { alt: true, control: true }), 'win32')).toBeNull()
    expect(navKeyDir(key('ArrowLeft', { meta: true }), 'win32')).toBeNull()
  })
})
