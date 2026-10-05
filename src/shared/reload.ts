// loops/ のどのファイルが変わったら、画面のどこを読み込み直すか。

export type Change = 'shell' | { page: string }

/** loops/ 直下のファイル名から判定する。画面に関係しないもの（md・ログ・一時ファイル・下のフォルダ）は null */
export function classifyChange(name: string | null): Change | null {
  if (!name || /[\\/]/.test(name) || name.startsWith('.')) return null
  if (/\.(css|js)$/i.test(name) || name === 'index.html') return 'shell'
  if (/\.html$/i.test(name)) return { page: name }
  return null
}

/** たまった変更をまとめる。殻が1つでも変われば画面全体、頁だけならその頁 */
export function mergeChanges(changes: Change[]): 'shell' | { pages: string[] } | null {
  if (!changes.length) return null
  if (changes.includes('shell')) return 'shell'
  return { pages: [...new Set(changes.map((c) => (c as { page: string }).page))] }
}

/** loops/ 直下のファイルの「更新日時:大きさ」。OS の知らせが届かない場所（WSL の \\wsl.localhost など）でも、これを見比べれば変化が分かる */
export type Stamps = Map<string, string>

/** 前と今の見比べで、増えた・消えた・変わったファイルの名前 */
export function diffStamps(prev: Stamps, cur: Stamps): string[] {
  const out: string[] = []
  for (const [n, s] of cur) if (prev.get(n) !== s) out.push(n)
  for (const n of prev.keys()) if (!cur.has(n)) out.push(n)
  return out
}
