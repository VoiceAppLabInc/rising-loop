import { describe, expect, it } from 'vitest'
import { checkUpdate, checkUpdateNow, readWithProgress, updateFrom } from '../../src/main/update'

const release = (o: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  name: 'v0.2.0',
  body: '- 新しいお知らせ\n- 直したこと',
  html_url: 'https://github.com/toru0325/rising-loop/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'Rising-Loop-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.com/arm64.dmg' },
    { name: 'Rising-Loop-0.2.0-mac-x64.dmg', browser_download_url: 'https://example.com/x64.dmg' },
    { name: 'Rising-Loop-0.2.0-win-x64.exe', browser_download_url: 'https://example.com/setup.exe' },
    { name: 'Rising-Loop-0.2.0-win-x64.exe.blockmap', browser_download_url: 'https://example.com/setup.exe.blockmap' }
  ],
  ...o
})

describe('Releases の最新から、新しい版を読む', () => {
  it('いまより新しければ、版・説明・この OS と CPU 向けのファイル・リリースの頁を返す', () => {
    expect(updateFrom(release(), '0.1.0', 'darwin', 'arm64')).toEqual({
      version: '0.2.0',
      notes: '- 新しいお知らせ\n- 直したこと',
      download: 'https://example.com/arm64.dmg',
      page: 'https://github.com/toru0325/rising-loop/releases/tag/v0.2.0'
    })
    expect(updateFrom(release(), '0.1.0', 'darwin', 'x64')?.download).toBe('https://example.com/x64.dmg')
    expect(updateFrom(release(), '0.1.0', 'win32', 'x64')?.download).toBe('https://example.com/setup.exe')
  })
  it('同じ版・古い版なら null', () => {
    expect(updateFrom(release(), '0.2.0', 'darwin', 'arm64')).toBeNull()
    expect(updateFrom(release(), '0.10.0', 'darwin', 'arm64')).toBeNull()
  })
  it('下書き・プレリリースは知らせない', () => {
    expect(updateFrom(release({ draft: true }), '0.1.0', 'darwin', 'arm64')).toBeNull()
    expect(updateFrom(release({ prerelease: true }), '0.1.0', 'darwin', 'arm64')).toBeNull()
  })
  it('この OS 向けのファイルが無ければ、ダウンロードはリリースの頁にする', () => {
    expect(updateFrom(release(), '0.1.0', 'linux', 'x64')?.download).toBe('https://github.com/toru0325/rising-loop/releases/tag/v0.2.0')
  })
  it('説明が無ければ空、版の頭に v が無くても読む', () => {
    expect(updateFrom(release({ tag_name: '0.3.0', body: null }), '0.1.0', 'darwin', 'arm64')).toMatchObject({ version: '0.3.0', notes: '' })
  })
  it('形の違うもの（エラーの応答など）は null', () => {
    expect(updateFrom({ message: 'Not Found' }, '0.1.0', 'darwin', 'arm64')).toBeNull()
    expect(updateFrom(null, '0.1.0', 'darwin', 'arm64')).toBeNull()
    expect(updateFrom(release({ tag_name: 'nightly' }), '0.1.0', 'darwin', 'arm64')).toBeNull()
  })
})

describe('新しい版を見に行く', () => {
  const ok = (json: unknown) => async () => ({ ok: true, json: async () => json })
  it('取れたら読む', async () => {
    expect((await checkUpdate('https://api.example.com/latest', '0.1.0', 'darwin', 'arm64', ok(release())))?.version).toBe('0.2.0')
  })
  it('off なら見に行かない', async () => {
    let called = false
    const f = async () => {
      called = true
      return { ok: true, json: async () => release() }
    }
    expect(await checkUpdate('off', '0.1.0', 'darwin', 'arm64', f)).toBeNull()
    expect(called).toBe(false)
  })
  it('ネットが無い・応答がエラーなら、黙って null', async () => {
    const down = async () => {
      throw new Error('offline')
    }
    expect(await checkUpdate('https://api.example.com/latest', '0.1.0', 'darwin', 'arm64', down)).toBeNull()
    expect(await checkUpdate('https://api.example.com/latest', '0.1.0', 'darwin', 'arm64', async () => ({ ok: false, json: async () => ({}) }))).toBeNull()
  })
})

describe('いますぐ確かめる（設定のボタン・メニュー）', () => {
  const ok = (json: unknown) => async () => ({ ok: true, json: async () => json })
  it('新しい版がある・最新・見に行けなかった、を見分ける', async () => {
    expect(await checkUpdateNow('https://x', '0.1.0', 'darwin', 'arm64', ok(release()))).toMatchObject({ status: 'new', update: { version: '0.2.0' } })
    expect(await checkUpdateNow('https://x', '0.2.0', 'darwin', 'arm64', ok(release()))).toEqual({ status: 'latest' })
    expect(await checkUpdateNow('https://x', '0.1.0', 'darwin', 'arm64', async () => ({ ok: false, json: async () => ({}) }))).toEqual({ status: 'error' })
    const down = async () => {
      throw new Error('offline')
    }
    expect(await checkUpdateNow('https://x', '0.1.0', 'darwin', 'arm64', down)).toEqual({ status: 'error' })
    expect(await checkUpdateNow('off', '0.1.0', 'darwin', 'arm64', ok(release()))).toEqual({ status: 'latest' })
  })
})

describe('落としながら % を数える', () => {
  const chunks = (n: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(size).fill(i))
        c.close()
      }
    })
  it('大きさが分かれば、変わったときだけ % を知らせ、全部をつないで返す', async () => {
    const seen: number[] = []
    const buf = await readWithProgress(new Response(chunks(4, 25), { headers: { 'content-length': '100' } }), (p) => seen.push(p))
    expect(seen).toEqual([25, 50, 75, 100])
    expect(buf.length).toBe(100)
    expect([buf[0], buf[25], buf[99]]).toEqual([0, 1, 3])
  })
  it('大きさが分からなければ % は知らせない（中身は返す）', async () => {
    const seen: number[] = []
    const buf = await readWithProgress(new Response(chunks(3, 10)), (p) => seen.push(p))
    expect(seen).toEqual([])
    expect(buf.length).toBe(30)
  })
})
