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

/** いますぐ確かめた結果。new：新しい版がある／latest：いまの版が最新（見に行かない設定のときも）／error：見に行けなかった */
export type UpdateCheck = { status: 'new'; update: AppUpdate } | { status: 'latest' } | { status: 'error' }

export async function checkUpdateNow(url: string, current: string, platform: string, arch: string, fetcher: Fetcher): Promise<UpdateCheck> {
  if (url === 'off') return { status: 'latest' }
  try {
    const res = await fetcher(url)
    if (!res.ok) return { status: 'error' }
    const update = updateFrom(await res.json(), current, platform, arch)
    return update ? { status: 'new', update } : { status: 'latest' }
  } catch {
    return { status: 'error' }
  }
}

/** 新しい版を見に行く。ネットが無い・応答がエラーのときは黙って null（知らせないだけ） */
export async function checkUpdate(url: string, current: string, platform: string, arch: string, fetcher: Fetcher): Promise<AppUpdate | null> {
  const r = await checkUpdateNow(url, current, platform, arch, fetcher)
  return r.status === 'new' ? r.update : null
}

/** Mac のアプリの置き場所（〜/Rising Loop.app）。実行ファイルの3つ上。Mac でなければ・.app の中でなければ null */
export function bundleOf(exe: string, platform: string): string | null {
  if (platform !== 'darwin') return null
  const m = exe.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/)
  return m ? m[1] : null
}

/**
 * Mac でアプリを新しい版に入れ替えるシェル。アプリが自分で落とした .dmg を使う（ブラウザで落としたものと違って、
 * 「ダウンロードしたもの」の印が付かないので、署名していなくても「壊れている」と言われない）。
 * 引数：$1 終わるのを待つアプリのプロセス番号、$2 .dmg、$3 入れ替えるアプリ（〜.app）、$4 open なら最後に開く。
 * .dmg が開けない・中にアプリが無いときは、前のアプリを残したまま（開き直して）止まる
 */
export const MAC_SWAP_SH = `
pid="$1"; dmg="$2"; app="$3"; after="$4"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 120 ] && exit 1
  sleep 0.5
done
mnt="$(mktemp -d)"
ok=0
if hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null 2>&1; then
  src="$(ls -d "$mnt"/*.app 2>/dev/null | head -1)"
  if [ -n "$src" ] && rm -rf "$app.new" && ditto "$src" "$app.new" && rm -rf "$app" && mv "$app.new" "$app"; then ok=1; fi
  hdiutil detach -quiet "$mnt" >/dev/null 2>&1 || hdiutil detach -quiet -force "$mnt" >/dev/null 2>&1
fi
rmdir "$mnt" 2>/dev/null
rm -rf "$app.new"
[ "$ok" = 1 ] && rm -f "$dmg"
xattr -dr com.apple.quarantine "$app" 2>/dev/null
[ "$after" = open ] && open "$app"
[ "$ok" = 1 ]
`
