// スキルの画面がアプリの外へ向けて出すもの（右の窓の URL・クリップボードの指示文）を見分ける。
// スキルとの約束はこの2つだけにする。画面の中身や LOOP_DATA の形には頼らない。

/** 右の窓（ttyd）の番号。スキルの rising.js が http://localhost:7681/?arg=<フォルダ>&arg=<画面ID> を開く */
export const PANE_PORT = '7681'

export interface PaneTarget {
  folder: string
  /** s-list・s-L01 など */
  screen: string
}

export function parsePaneUrl(url: string): PaneTarget | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' || u.port !== PANE_PORT) return null
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null
  const [folder, screen] = u.searchParams.getAll('arg')
  if (!folder || !screen) return null
  return { folder, screen }
}

/** rising.js が組む指示文（--- で始まり --- で終わる）か。ほかのコピーは普通のコピーとして扱う */
export function isInstruction(text: string): boolean {
  return /^---\r?\n[\s\S]*\r?\n---\s*$/.test(text)
}

/** ループの画面の URL（index.html#s-L01）から、いま見えている画面IDを取る。rising.js は画面を # で切り替える */
export function screenOfUrl(url: string): string {
  const m = /#(s-[A-Za-z0-9_-]+)$/.exec(url)
  return m ? m[1] : 's-list'
}

/**
 * ターミナルに貼り付けの形（bracketed paste）で入れる文。途中の改行で送信されないようにする。
 * 改行は xterm.js の貼り付けと同じく \r にそろえ、文の中の ESC は取り除く（貼り付けの終わりを偽装させない）。
 * Windows（ConPTY）でこの形がそのまま通るかは要確認。
 */
export function pasteForTerminal(text: string): string {
  return '\x1b[200~' + text.replace(/\x1b/g, '').replace(/\r?\n/g, '\r') + '\x1b[201~'
}

/**
 * 前の版の画面の「⬆ アップデート」が組む指示文か。アプリはこれを AI に渡さず、［新しい形にする］のダイアログに読み替える
 * （新しい形にするのはアプリの決まった処理。AI に install.sh や合わせる手順を走らせない）
 */
export function isUpdateRequest(text: string): boolean {
  return text.includes('rising-loop を最新版に更新して')
}
