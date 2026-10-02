// 台帳（スキルの migrations.json）。版ごとに、既存のループの HTML に要る変化を1件ずつ持つ。
// 版が上がったら、前の版からいまの版までの項目を走査し、まだ反映していない頁と一覧に、その項目だけを AI に反映させる。
// 頁の構成は版ごとに大きく変わるので、アプリは構成を決め打ちしない。変化の中身は台帳に、反映は AI に任せる。
// 反映し終えた印は、頁の <html data-loop-ver="X"> と、一覧（殻の LOOPS ブロック）の <!-- list-ver: X -->。
import { createHash } from 'node:crypto'
import { compareVersions } from '@shared/migrate'

export type ChangeTarget = 'pages' | 'list' | 'const'

export interface LedgerChange {
  id: string
  /** pages: 各ループの頁／list: 一覧の行（殻の LOOPS ブロック）／const: 殻の CONST ブロック */
  target: ChangeTarget
  /** 何を変えるか（AI にそのまま渡す） */
  what: string
  /** 作りの細かいところ（雛形のどこを見るか、など） */
  detail?: string
}

export interface LedgerEntry {
  version: string
  /** その版の雛形の指紋。雛形が変わったのに台帳に項目が無いと、テストが落ちる */
  templates: { loop: string; loops: string; const: string }
  changes: LedgerChange[]
}

export type Ledger = LedgerEntry[]

export function parseLedger(json: string): Ledger {
  const raw = JSON.parse(json) as { versions?: Ledger }
  return raw.versions ?? []
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16)

/** 殻の <!-- NAME:BEGIN --> の行から <!-- NAME:END --> の行まで（両方の行を含む） */
function blockLines(html: string, name: string): string {
  const lines = html.split('\n')
  const i = lines.findIndex((l) => l.includes(`<!-- ${name}:BEGIN -->`))
  const j = lines.findIndex((l) => l.includes(`<!-- ${name}:END -->`))
  if (i < 0 || j < i) return ''
  return lines.slice(i, j + 1).join('\n') + '\n'
}

/** 雛形の指紋（頁の雛形まるごと・殻の LOOPS ブロック・殻の CONST ブロック） */
export function fingerprints(loopHtml: string, indexHtml: string): LedgerEntry['templates'] {
  return { loop: hash(loopHtml), loops: hash(blockLines(indexHtml, 'LOOPS')), const: hash(blockLines(indexHtml, 'CONST')) }
}

/** from より後、to まで（from < 版 <= to）の項目を古い順に */
export function changesBetween(ledger: Ledger, from: string, to: string): LedgerChange[] {
  return ledger.filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0).flatMap((e) => e.changes)
}

const pageVer = (html: string) => /<html[^>]*\bdata-loop-ver="([0-9][0-9.]*)"/.exec(html)?.[1] ?? null
const listVer = (indexHtml: string) => /<!-- list-ver: ([0-9][0-9.]*)/.exec(blockLines(indexHtml, 'LOOPS'))?.[1] ?? null

export interface PendingWork {
  pages: { name: string; from: string; changes: LedgerChange[] }[]
  /** 一覧の行と CONST（殻の子がまとめて直す）。反映するものが無ければ null */
  list: { from: string; changes: LedgerChange[] } | null
}

/**
 * まだ反映していない項目。印の無い頁・一覧は baseline（新しい形にする前の版）から数える。
 * 範囲に頁や一覧の変化が無ければ挙げない（作り直さない）
 */
export function pendingWork(o: { ledger: Ledger; current: string; baseline: string; indexHtml: string; pages: { name: string; html: string }[] }): PendingWork {
  const pages = o.pages
    .map((p) => {
      const from = pageVer(p.html) ?? o.baseline
      return { name: p.name, from, changes: changesBetween(o.ledger, from, o.current).filter((c) => c.target === 'pages') }
    })
    .filter((p) => p.changes.length)
  const lf = listVer(o.indexHtml) ?? o.baseline
  const lc = changesBetween(o.ledger, lf, o.current).filter((c) => c.target === 'list' || c.target === 'const')
  return { pages, list: lc.length ? { from: lf, changes: lc } : null }
}
