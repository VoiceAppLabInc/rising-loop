// ループの画面（一覧・各ループの頁）とリンクを開いた窓の、右クリックのメニューに出す項目。
// Electron は右クリックのメニューを自分では出さないので、main が右クリックされた場所に合わせて組み立てる。

export type ContextItem = 'cut' | 'copy' | 'paste' | 'selectAll' | 'openLinkInApp' | 'openLinkExternal' | 'openFileDefault' | 'revealFile' | 'copyLink' | 'separator'

/** 右クリックされた場所（Electron の context-menu の params のうち使うものだけ） */
export interface ContextPlace {
  selectionText: string
  linkURL: string
  isEditable: boolean
}

/** リンクの先に合わせた項目。ウェブのページはブラウザで、手元のファイルは既定のアプリで開く・Finder で表示。mailto: などは OS に任せる */
function linkItems(url: string): ContextItem[] {
  if (/^https?:/i.test(url)) return ['openLinkInApp', 'openLinkExternal', 'copyLink']
  if (/^file:/i.test(url)) return ['openLinkInApp', 'openFileDefault', 'revealFile', 'copyLink']
  return ['openLinkExternal', 'copyLink']
}

/**
 * 出す項目。入力欄なら編集の4つ、文字を選んでいればコピー、リンクの上ならリンクの項目（区切って並べる）。
 * どれにも当たらなければ「すべて選択」だけ
 */
export function contextItems(p: ContextPlace): ContextItem[] {
  const groups: ContextItem[][] = []
  if (p.isEditable) groups.push(['cut', 'copy', 'paste', 'selectAll'])
  else if (p.selectionText.trim()) groups.push(['copy'])
  if (p.linkURL) groups.push(linkItems(p.linkURL))
  if (!groups.length) return ['selectAll']
  return groups.flatMap((g, i) => (i ? ['separator' as const, ...g] : g))
}
