#!/usr/bin/env node
// 使っている人の数とダウンロード数を数える（手元で動かす。gcloud にログインしていること）。
//   node scripts/stats.mjs            # 直近 30 日
//   node scripts/stats.mjs 7          # 直近 7 日
// 置き場所 gs://rising-loop-dist の取得の記録（Cloud Storage の usage logs。gs://rising-loop-logs に1時間ごとの CSV で届く）を読む。
//   使っている人：アプリが新しい版を確かめるときの latest.json?id=<匿名の番号>&v=…&s=…&os=…&ai=…&wsl=… を、番号ごとにまとめる
//   ダウンロード：releases/<版>/… と latest/… の .dmg・.exe の取得（200 の GET）を、ファイルごとに数える
// 名前やメールは記録に無い（アプリは送らない）。IP は数えるのに使わない
import { execFileSync } from 'node:child_process'

const PROJECT = 'rising-loop'
const LOGS = 'gs://rising-loop-logs'
const days = Number(process.argv[2]) || 30
const since = Date.now() - days * 24 * 60 * 60 * 1000

const gcloud = (args) => execFileSync('gcloud', [...args, `--project=${PROJECT}`], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] })

// 記録のファイル名：dist_usage_<YYYY>_<MM>_<DD>_<HH>_<MM>_<SS>_<id>_v0
/** 記録のファイルの一覧。まだ1つも無ければ空（gcloud は「見つからない」を失敗で返す） */
const listLogs = () => {
  try {
    return gcloud(['storage', 'ls', `${LOGS}/dist_usage_*`])
  } catch {
    return ''
  }
}
const files = listLogs()
  .split('\n')
  .filter(Boolean)
  .filter((f) => {
    const m = /dist_usage_(\d{4})_(\d{2})_(\d{2})_(\d{2})/.exec(f)
    return m && Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) >= since - 3600_000
  })
if (!files.length) {
  console.log(`直近 ${days} 日の記録はまだありません（記録は1時間ごとに届きます）`)
  process.exit(0)
}

/** CSV の1行（"…","…"）を分ける */
const cells = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))

const users = new Map() // id → { first, last, v, s, os, ai, wsl }
const downloads = new Map() // object → count
const usersByDay = new Map() // YYYY-MM-DD → Set(id)
for (const f of files) {
  const text = gcloud(['storage', 'cat', f])
  const [head, ...rows] = text.split('\n').filter(Boolean)
  const cols = cells(head)
  const at = (r, name) => r[cols.indexOf(name)]
  for (const line of rows) {
    const r = cells(line)
    const t = Number(at(r, 'time_micros')) / 1000
    if (t < since || at(r, 'cs_method') !== 'GET' || at(r, 'sc_status') !== '200') continue
    const obj = at(r, 'cs_object') ?? ''
    if (obj === 'latest.json') {
      const q = new URL(at(r, 'cs_uri'), 'https://x').searchParams
      const id = q.get('id')
      if (!id) continue
      const u = users.get(id) ?? { first: t, last: t }
      users.set(id, { ...u, first: Math.min(u.first, t), last: Math.max(u.last, t), v: q.get('v'), s: q.get('s'), os: q.get('os'), ai: q.get('ai'), wsl: q.get('wsl') === '1' })
      const day = new Date(t).toISOString().slice(0, 10)
      if (!usersByDay.has(day)) usersByDay.set(day, new Set())
      usersByDay.get(day).add(id)
    } else if (/\.(dmg|exe)$/.test(obj)) {
      downloads.set(obj, (downloads.get(obj) ?? 0) + 1)
    }
  }
}

const count = (key) => {
  const m = new Map()
  for (const u of users.values()) m.set(u[key] ?? '－', (m.get(u[key] ?? '－') ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('　')
}
console.log(`■ 直近 ${days} 日（記録 ${files.length} ファイル）`)
console.log(`使っている人：${users.size} 人（統計を止めている人は数えられない）`)
console.log(`  アプリの版：${count('v')}`)
console.log(`  OS：${count('os')}`)
console.log(`  AI：${count('ai')}`)
console.log(`  WSL：${[...users.values()].filter((u) => u.wsl).length} 人`)
console.log('日ごとの使っている人：')
for (const [d, s] of [...usersByDay].sort()) console.log(`  ${d}  ${s.size}`)
console.log('ダウンロード（ファイルごと。アプリの［アップデート］・1行インストール・LP のボタンを含む）：')
for (const [o, n] of [...downloads].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${o}`)
