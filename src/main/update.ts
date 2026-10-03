// 新しい版のアプリが出ていないかを見る。GitHub の Releases の最新（公開したもの）と、いまの版を比べる。
// 自動では入れ替えない（署名していないので、入れ替えは使う人がダウンロードして行う）。アプリは知らせるだけ
import { compareVersions } from '@shared/migrate'
import type { AppUpdate } from '@shared/types'

/** 見に行く先。RISING_LOOP_APP_UPDATE_URL で変えられる（off なら見に行かない。テストは file:// の見本を読む） */
export const UPDATE_URL = 'https://api.github.com/repos/toru0325/rising-loop/releases/latest'
/** 起動したときのほか、この間隔でも見る（開きっぱなしの人にも届くように） */
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/** OS・CPU ごとの配るファイルの名前の終わり（electron-builder.yml の artifactName） */
const assetSuffix = (platform: string, arch: string): string | null =>
  platform === 'darwin' ? `-mac-${arch}.dmg` : platform === 'win32' ? `-win-${arch}.exe` : null

/** Releases の最新の応答から、いまより新しい版を読む。新しくなければ・読めなければ null */
export function updateFrom(json: unknown, current: string, platform: string, arch: string): AppUpdate | null {
  if (!json || typeof json !== 'object') return null
  const r = json as { tag_name?: unknown; body?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft || r.prerelease) return null
  const version = r.tag_name.replace(/^v/, '')
  if (!/^\d+(\.\d+)*$/.test(version) || compareVersions(version, current) <= 0) return null
  const suffix = assetSuffix(platform, arch)
  const assets = Array.isArray(r.assets) ? (r.assets as { name?: unknown; browser_download_url?: unknown }[]) : []
  const asset = suffix ? assets.find((a) => typeof a.name === 'string' && a.name.endsWith(suffix)) : undefined
  return {
    version,
    notes: typeof r.body === 'string' ? r.body.trim() : '',
    download: typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : r.html_url,
    page: r.html_url
  }
}

/** 新しい版を見に行く。ネットが無い・応答がエラーのときは黙って null（知らせないだけ） */
export async function checkUpdate(url: string, current: string, platform: string, arch: string, fetcher: Fetcher): Promise<AppUpdate | null> {
  if (url === 'off') return null
  try {
    const res = await fetcher(url)
    return res.ok ? updateFrom(await res.json(), current, platform, arch) : null
  } catch {
    return null
  }
}
