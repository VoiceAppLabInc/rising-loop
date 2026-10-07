// お問い合わせ・フィードバックの Google フォーム（2026-10-07 作成。プロジェクトへの問い合わせが主で、アプリのフィードバックはその1つ）。
// 答えを入れた状態で開く URL（事前入力。?usp=pp_url&entry.<番号>=…）を作る。送るかどうかは、開いたフォームで使う人が決める
// （フォームの編集：https://docs.google.com/forms/d/1Wfv_BCdpHLCp-Wrqmq3omV2gduA1sSCpzoC262VSAfM/edit。欄を変えたら番号もここも直す）

export const FEEDBACK_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSddVHFdbG6Sq75vxj2b6SnCVRllV6cWoM44XobscyH8w5hLsw/viewform'

/** 欄の番号（フォームの FB_PUBLIC_LOAD_DATA_ から読んだもの） */
export const FEEDBACK_ENTRY = { kind: '616376561', body: '964705820', email: '1047216616', env: '1874439526' } as const

/** 「どんなことですか？」の選択肢（フォームと同じ文字にする。違うと入らない） */
export const FEEDBACK_KINDS = ['使い方を知りたい', 'うまく動かない', 'こうしてほしい', '仕事で使いたい・相談したい', 'その他'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** URL の長さの上限の目安（長すぎると開けないブラウザがある）。超えるときは内容を切る */
export const FEEDBACK_URL_MAX = 2000

export interface FeedbackDraft {
  kind?: string
  body?: string
  env?: string
}

/** 答えを入れた状態で開く URL。種類は選択肢に無ければ入れない。内容が長すぎれば、末尾を切って「…（長いので切りました）」を付ける */
export function feedbackUrl(d: FeedbackDraft): string {
  const build = (body: string) => {
    const q = new URLSearchParams({ usp: 'pp_url' })
    if (d.kind && (FEEDBACK_KINDS as readonly string[]).includes(d.kind)) q.set(`entry.${FEEDBACK_ENTRY.kind}`, d.kind)
    if (body) q.set(`entry.${FEEDBACK_ENTRY.body}`, body)
    if (d.env) q.set(`entry.${FEEDBACK_ENTRY.env}`, d.env)
    return `${FEEDBACK_FORM}?${q.toString()}`
  }
  let body = (d.body ?? '').trim()
  let url = build(body)
  const cut = '\n…（長いので切りました）'
  while (url.length > FEEDBACK_URL_MAX && body.length > 0) {
    body = body.slice(0, Math.max(0, Math.floor(body.length * 0.85)))
    url = build(body + cut)
  }
  return url
}

/**
 * AI が書いた報告（loops/.feedback/<日時>.md）を読む。1行目が「種類: …」なら種類、それより後ろが内容。
 * 1行目に種類が無ければ、全体を内容にして種類は「うまく動かない」
 */
export function parseFeedbackFile(text: string): { kind: FeedbackKind; body: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const m = /^種類[:：]\s*(.+)$/.exec(lines[0]?.trim() ?? '')
  const kind = m && (FEEDBACK_KINDS as readonly string[]).includes(m[1].trim()) ? (m[1].trim() as FeedbackKind) : 'うまく動かない'
  const rest = (m ? lines.slice(1) : lines).join('\n').replace(/^\s*---\s*\n/, '').trim()
  return { kind, body: rest }
}

/** 環境の欄に入れる1行（アプリの版・スキルの版・OS・AI・WSL か）。プロジェクトの名前やフォルダは入れない */
export function envLine(e: { app: string; skill: string; platform: string; arch: string; ai: string; wsl: boolean }): string {
  return `アプリ v${e.app} / スキル v${e.skill} / ${e.platform}-${e.arch} / AI: ${e.ai || '－'} / WSL: ${e.wsl ? 'はい' : 'いいえ'}`
}
