import { describe, expect, it } from 'vitest'
import { findCliIn, killCommand, resolveWinShim, windowChrome } from '../../src/main/platform'

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
