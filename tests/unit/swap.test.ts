// Mac でアプリを新しい版に入れ替えるシェル。本物の .dmg（hdiutil で作る）で動かして確かめる
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAC_SWAP_SH, bundleOf, needsIconRefresh } from '../../src/main/update'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rla-swap-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** 中に Rising Loop.app（版の印のファイルだけ）を入れた .dmg を作る */
function dmgWith(version: string): string {
  const src = join(root, 'src-' + version)
  mkdirSync(join(src, 'Rising Loop.app', 'Contents'), { recursive: true })
  writeFileSync(join(src, 'Rising Loop.app', 'Contents', 'VERSION'), version)
  // 日時を古くしておく（入れ替えたあとで今の日時になるかを見るため）
  utimesSync(join(src, 'Rising Loop.app'), new Date('2020-01-01'), new Date('2020-01-01'))
  const dmg = join(root, `new-${version}.dmg`)
  execFileSync('hdiutil', ['create', '-quiet', '-fs', 'APFS', '-srcfolder', src, '-volname', 'Rising Loop', dmg])
  return dmg
}

describe.runIf(process.platform === 'darwin')('Mac の入れ替え', () => {
  it('前のアプリが終わるのを待ってから、.dmg の中のアプリと入れ替え、.dmg を消す', () => {
    const apps = join(root, 'Applications')
    mkdirSync(join(apps, 'Rising Loop.app', 'Contents'), { recursive: true })
    writeFileSync(join(apps, 'Rising Loop.app', 'Contents', 'VERSION'), '0.1.0')
    writeFileSync(join(apps, 'Rising Loop.app', 'Contents', 'OLD-ONLY'), 'x')
    const dmg = dmgWith('0.1.1')
    // 終わったプロセスの番号（待たずに進む）
    const gone = spawnSync('/usr/bin/true').pid
    const r = spawnSync('/bin/sh', ['-c', MAC_SWAP_SH, 'sh', String(gone), dmg, join(apps, 'Rising Loop.app'), 'no-open'], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(join(apps, 'Rising Loop.app', 'Contents', 'VERSION'), 'utf8')).toBe('0.1.1')
    // 前の版のファイルは残さない（丸ごと入れ替える）
    expect(existsSync(join(apps, 'Rising Loop.app', 'Contents', 'OLD-ONLY'))).toBe(false)
    expect(existsSync(dmg)).toBe(false)
  }, 60_000)

  it('入れ替えたアプリの日時を今にする（Mac がアイコンを覚え直すきっかけ）', () => {
    const apps = join(root, 'Applications')
    mkdirSync(join(apps, 'Rising Loop.app', 'Contents'), { recursive: true })
    const dmg = dmgWith('0.1.8')
    // .dmg の中のアプリの日時は古くしておく（ditto は日時も写す）
    const gone = spawnSync('/usr/bin/true').pid
    const before = Date.now() - 1000
    const r = spawnSync('/bin/sh', ['-c', MAC_SWAP_SH, 'sh', String(gone), dmg, join(apps, 'Rising Loop.app'), 'no-open'], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(0)
    expect(statSync(join(apps, 'Rising Loop.app')).mtimeMs).toBeGreaterThan(before)
  }, 60_000)

  it('.dmg が開けなければ、前のアプリを残したまま止まる', () => {
    const apps = join(root, 'Applications')
    mkdirSync(join(apps, 'Rising Loop.app', 'Contents'), { recursive: true })
    writeFileSync(join(apps, 'Rising Loop.app', 'Contents', 'VERSION'), '0.1.0')
    const bad = join(root, 'bad.dmg')
    writeFileSync(bad, 'not a dmg')
    const gone = spawnSync('/usr/bin/true').pid
    const r = spawnSync('/bin/sh', ['-c', MAC_SWAP_SH, 'sh', String(gone), bad, join(apps, 'Rising Loop.app'), 'no-open'], { encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(readFileSync(join(apps, 'Rising Loop.app', 'Contents', 'VERSION'), 'utf8')).toBe('0.1.0')
  }, 60_000)
})

describe('アプリの置き場所', () => {
  it('Mac は実行ファイルの3つ上の .app、それ以外は null', () => {
    expect(bundleOf('/Applications/Rising Loop.app/Contents/MacOS/Rising Loop', 'darwin')).toBe('/Applications/Rising Loop.app')
    expect(bundleOf('/Users/u/dev/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin')).toBe('/Users/u/dev/node_modules/electron/dist/Electron.app')
    expect(bundleOf('/opt/x/rising', 'darwin')).toBeNull()
    expect(bundleOf('C:\\\\Program Files\\\\Rising Loop\\\\Rising Loop.exe', 'win32')).toBeNull()
  })
})

describe('版が変わって初めて開いたか（アイコンを覚え直させる）', () => {
  it('前回の版と違えば true。初めて（記録なし）も true、同じなら false', () => {
    expect(needsIconRefresh('0.1.7', '0.1.8')).toBe(true)
    expect(needsIconRefresh(undefined, '0.1.8')).toBe(true)
    expect(needsIconRefresh('0.1.8', '0.1.8')).toBe(false)
  })
})
