// loops/ を新しい形にするときの、決まった入れ替え。スキルの assets/shell-update.py の入れ替えを TypeScript に移したもの。
// 殻（index.html）を同梱の雛形から作り直し、CONST と LOOPS のブロックだけを引き継ぐ。共通の部品は雛形で上書きする。
// 頁（LXX.html）は書き換えない。頁の書き方も見ない（HTML の中身は自由にしておく）。
// 殻から消える独自の部品だけを見つけて返す（移し直すのは AI）。殻と消える部品は、shell-update.py と同じ結果になる
// （tests/unit/migrate.test.ts が Python 版と突き合わせる）。
import type { LoopsForm } from './loopsForm'

export interface Templates {
  index: string
  loop: string
  css: string
  js: string
  /** loops/update/common.py に写す */
  loopdata: string
  version: string
}

/** スキルのフォルダから雛形を読む。read はスキルのフォルダからの相対パスを受け取る */
export function readTemplates(read: (rel: string) => string): Templates {
  return {
    index: read('assets/index.html'),
    loop: read('assets/loop.html'),
    css: read('assets/rising.css'),
    js: read('assets/rising.js'),
    loopdata: read('assets/loopdata.py'),
    version: read('VERSION').trim()
  }
}

export interface LoopsFiles {
  indexHtml: string
  /** L で始まる .html（名前の順） */
  pages: { name: string; html: string }[]
  projectCss: string | null
}

export interface MigrationPlan {
  newIndex: string
  /** loops/ からの相対パスと中身 */
  common: { path: string; content: string }[]
  /** 入れ替えで殻から消える独自の部品（AI が控えの殻から移し直す） */
  lost: string[]
}

/**
 * 雛形から消した部品の id。移し直させないので「消える」に数えない（shell-update.py の DROPPED_IDS と同じにする）
 * 2.0.0: ttyd の説明・アップデートのボタン・コピーの知らせ／2.1.0: 使い方の窓と右上のボタンと、使い方の図の矢印（hw-ah）（アプリに移した）
 */
const DROPPED_IDS = new Set(['cc-ask', 'cc-help', 'cc-help-close', 'cc-help-t', 'rl-update', 'toast', 'toast-body', 'topbtns', 'howto-btn', 'cc-toggle', 'howto', 'howto-t', 'howto-close', 'hw-ah'])

const trimNl = (s: string) => s.replace(/^\n+|\n+$/g, '')

function block(html: string, name: string): string | null {
  const b = `<!-- ${name}:BEGIN -->`
  const i = html.indexOf(b)
  const j = html.indexOf(`<!-- ${name}:END -->`)
  if (i < 0 || j < 0 || j < i) return null
  return trimNl(html.slice(i + b.length, j))
}

function put(html: string, name: string, body: string): string {
  const b = `<!-- ${name}:BEGIN -->`
  const i = html.indexOf(b)
  const j = html.indexOf(`<!-- ${name}:END -->`)
  if (i < 0 || j < 0) throw new Error(`雛形に ${name} マーカーがありません`)
  return html.slice(0, i + b.length) + '\n' + trimNl(body) + '\n' + html.slice(j)
}

/** 版の表示は雛形に直書きせず、入れ替えのときに書く（直書きだと版を上げても古い番号が残る） */
const putVersion = (html: string, v: string) => html.replace(/(<span class="ver"[^>]*>)v?[0-9][0-9.]*(<\/span>)/g, `$1v${v}$2`)

export function planMigration(files: LoopsFiles, tpl: Templates): MigrationPlan | { error: 'no-markers' } {
  const cur = files.indexHtml
  const constBlk = block(cur, 'CONST')
  const loopsBlk = block(cur, 'LOOPS')
  // CONST の印が無いのは 1.2.x の1ファイルの殻。アプリは扱わない（1.5 以上だけ）
  if (constBlk == null || loopsBlk == null) return { error: 'no-markers' }


  const newIndex = putVersion(put(put(tpl.index, 'CONST', constBlk), 'LOOPS', loopsBlk), tpl.version)

  // 印の外にある独自のものは、この入れ替えで消える。黙って消さずに名前で出す
  const squash = (t: string) => t.replace(/\s+/g, '')
  const sout = squash(newIndex)
  const lost = new Set<string>()
  for (const m of cur.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m[1]
    if (body.includes('CONST:BEGIN') || !body.trim()) continue
    if (!sout.includes(squash(body))) {
      const line = cur.slice(0, m.index).split('\n').length
      lost.add(`独自の <script>（${line} 行目あたり）`)
    }
  }
  for (const m of cur.matchAll(/\bid="([\p{L}\p{N}_-]+)"/gu)) {
    if (!DROPPED_IDS.has(m[1]) && !newIndex.includes(`id="${m[1]}"`)) lost.add(`id="${m[1]}"`)
  }

  return {
    newIndex,
    common: [
      { path: 'rising.css', content: tpl.css },
      { path: 'rising.js', content: tpl.js },
      { path: 'update/common.py', content: tpl.loopdata }
    ],
    lost: [...lost].sort()
  }
}

export type Stage =
  /** 1.5 より前の形。アプリでは新しい形にできない */
  | 'unsupported'
  /** 前の版。アプリ以前（1.5〜1.7）の形か、殻の版が同梱のスキルの版より古い。［新しい形にする］で入れ替える */
  | 'old'
  | 'current'

/** 版の大小（1.10.0 > 1.9.0）。数字でない所は 0 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * アプリ以前の形は、形の印で見分ける（版の表示があてにならないため。一度きりの移行）。
 * 2.0 以降は、殻の版の表示と同梱のスキルの版を比べるだけ。殻の版が新しければ何も変えない
 */
export function stageOf(form: LoopsForm, version: string): Stage {
  if (form.era === '1.2' || form.era === '1.3-1.4') return 'unsupported'
  if (form.era === '1.5-1.7') return 'old'
  if (form.era === 'unknown') return 'current'
  if (!form.shown) return 'old'
  return compareVersions(form.shown, version) < 0 ? 'old' : 'current'
}

/** 作り直しの作業に並べる、頁ごと・一覧の、台帳の項目 */
export interface ReworkItems {
  pages: { name: string; from: string; changes: { id: string }[] }[]
  list: { from: string; changes: { id: string }[] } | null
}

/**
 * 入れ替えのあとに、AI に送る作業（指示文の形）。SKILL.md の「最新版に合わせる」は、これが届いたときだけ動く。
 * 頁と一覧には、台帳（migrations.json）の項目のうち、まだ反映していないものだけを並べる。中身は台帳を読ませる。
 * 控えは loops/ の外にある。殻から消えた部品があるときだけ、その控えの殻1ファイルの場所を書く
 */
export function reworkInstruction(o: { version: string; ledgerPath: string; work: ReworkItems; lost: string[]; backupIndex: string }): string {
  const ids = (cs: { id: string }[]) => cs.map((c) => c.id).join('、')
  const lines = [
    `新しい形への作り直し（${o.version}）。アプリが殻と共通の部品の入れ替えを済ませた。SKILL.md の「最新版に合わせる」の「作り直しの中身」をやる`,
    `台帳：${o.ledgerPath}（下の項目の中身はここ。挙がった項目だけを反映する）`
  ]
  if (o.work.pages.length) {
    lines.push('頁：')
    for (const p of o.work.pages) lines.push(`- ${p.name}（${p.from} から）：${ids(p.changes)}`)
  }
  if (o.work.list) lines.push(`一覧（${o.work.list.from} から）：${ids(o.work.list.changes)}`)
  if (o.lost.length) {
    lines.push(`殻から消えたもの：${o.lost.join('、')}`)
    lines.push(`元の殻：${o.backupIndex}（このファイルの、上に挙げた部品だけを読む）`)
  }
  lines.push(`反映し終えたら、頁は <html data-loop-ver="${o.version}">、一覧は <!-- list-ver: ${o.version} --> にする`)
  const body = lines.map((l) => '  ' + l).join('\n')
  return `---\nloop: all\nsection: ALL\nrule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと\ntask: |\n${body}\n---`
}

/** CHANGELOG のその版の項から、箇条書きの1行目だけを飾り（★・**）を外して返す。新しい会話の最初に出す */
export function changelogSummary(md: string, version: string): string[] {
  const lines = md.split(/\r?\n/)
  const i = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`)
  if (i < 0) return []
  const out: string[] = []
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith('## ')) break
    const m = /^- (.+)$/.exec(l)
    if (m) out.push(m[1].replace(/★\s*/g, '').replace(/\*\*/g, '').replace(/`/g, '').trim())
  }
  return out
}
