// 前のバージョンの HTML のプロジェクトの知らせ（最初のダイアログ・ループの画面の上のカード・元に戻すときの確認）。
// ［HTMLを最新版にする］・元に戻すのは main の決まった処理（src/main/index.ts の loops:migrate・loops:undo）。
import type { ReactNode } from 'react'
import type { FormInfo, Migration } from '@shared/types'
import { Button } from './Button'

const WARN = '前のバージョンのままだと、AI の作業（更新・指示など）がうまく動かず、画面や数字が崩れることがあります。'

export function OldFormDialog(p: {
  name: string
  label: string
  latest: string
  unsupported: boolean
  busy: boolean
  onLater: () => void
  onMigrate: () => void
}) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="old-form-title">
        <h2 id="old-form-title">HTMLが前のバージョンです</h2>
        <p>
          「{p.name}」のHTMLは {p.label} です。いまのバージョンは {p.latest} です。
        </p>
        {p.unsupported ? (
          <p>このバージョン（1.5 より前）は、アプリでは最新版にできません。{WARN}</p>
        ) : (
          <p>{WARN}最新版にしても、数字・施策・記録は変わりません。</p>
        )}
        <div className="actions">
          {p.unsupported ? (
            <Button variant="primary" onClick={p.onLater}>
              閉じる
            </Button>
          ) : (
            <>
              <Button onClick={p.onLater} disabled={p.busy}>
                あとで
              </Button>
              <Button variant="primary" onClick={p.onMigrate} disabled={p.busy}>
                HTMLを最新版にする
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function UndoDialog(p: { at: string; busy: boolean; onCancel: () => void; onUndo: () => void }) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="undo-title">
        <h2 id="undo-title">最新版にする前に戻しますか</h2>
        <p>{shortTime(p.at)} に最新版にする前のHTMLに戻します。そのあとに増えた数字や記録も、その時点に戻ります。</p>
        <p>いまの画面は控えに残します。</p>
        <div className="actions">
          <Button onClick={p.onCancel} disabled={p.busy}>
            やめる
          </Button>
          <Button variant="primary" onClick={p.onUndo} disabled={p.busy}>
            元に戻す
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * ループの画面の上に浮かぶ小さなカード（1行）。前のバージョン・AI が作業中・直っていない・最新版にした直後で出し分ける。
 * ループの画面の上に重ねた透明な層（main の overlay）に描く。出すものが無ければ null
 */
export function OldFormCard(p: {
  form: FormInfo
  migration: Migration | undefined
  latest: string
  busy: boolean
  onMigrate: () => void
  onRework: () => void
  onUndo: () => void
  onClose: () => void
}) {
  const f = p.form
  const undo = p.migration && (
    <Button size="sm" onClick={p.onUndo} disabled={p.busy}>
      元に戻す
    </Button>
  )
  const card = (kind: string, icon: ReactNode, msg: string, actions?: ReactNode) => (
    <div className={`card ${kind}`} role="status">
      <span className="ico">{icon}</span>
      <span className="msg">{msg}</span>
      {actions}
    </div>
  )
  if (f.stage === 'unsupported') return card('warn', '!', `前のバージョンのHTMLです（${f.label}）。アプリでは最新版にできません`)
  if (f.stage === 'old')
    return card(
      'warn',
      '!',
      `前のバージョンのHTMLです（${f.label}）`,
      <Button variant="dark" size="sm" onClick={p.onMigrate} disabled={p.busy}>
        HTMLを最新版にする
      </Button>
    )
  if (f.stage === 'rework' && f.aiWorking) return card('work', <span className="spin" />, '新しいバージョンに直しています（AI が作業中）')
  if (f.stage === 'rework')
    return card(
      'stop',
      '!',
      f.reworkPages.length
        ? `直っていないループがあります（${f.reworkPages.map((n) => n.replace(/\.html$/, '')).join('・')}）`
        : '直っていないところがあります',
      <>
        {undo}
        <Button variant="danger-solid" size="sm" onClick={p.onRework} disabled={p.busy}>
          続きを AI に頼む
        </Button>
      </>
    )
  if (p.migration && !p.migration.closed)
    return card(
      'done',
      '✓',
      `HTMLを最新版にしました（${p.migration.from} → ${p.latest}）`,
      <>
        {undo}
        <Button variant="quiet" size="sm" className="btn-x" aria-label="閉じる" title="閉じる" onClick={p.onClose} disabled={p.busy}>
          ✕
        </Button>
      </>
    )
  return null
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
