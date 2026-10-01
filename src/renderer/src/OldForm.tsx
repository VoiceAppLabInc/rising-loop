// 古い形のプロジェクトの知らせ（最初のダイアログ・タブの下の帯・元に戻すときの確認）。
// 新しい形にする・元に戻すのは main の決まった処理（src/main/index.ts の loops:migrate・loops:undo）。
import type { FormInfo, Migration } from '@shared/types'

const WARN = '古い形のままだと、AI の作業（更新・指示など）がうまく動かず、画面や数字が崩れることがあります。'

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
        <h2 id="old-form-title">画面が前の版の形です</h2>
        <p>
          「{p.name}」の画面は {p.label} です。いまの版は {p.latest} です。
        </p>
        {p.unsupported ? (
          <p>この形（1.5 より前）は、アプリでは新しい形にできません。{WARN}</p>
        ) : (
          <p>{WARN}新しい形にしても、数字・施策・記録は変わりません。</p>
        )}
        <div className="actions">
          {p.unsupported ? (
            <button className="primary" onClick={p.onLater}>
              閉じる
            </button>
          ) : (
            <>
              <button className="secondary" onClick={p.onLater} disabled={p.busy}>
                あとで
              </button>
              <button className="primary" onClick={p.onMigrate} disabled={p.busy}>
                新しい形にする
              </button>
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
        <h2 id="undo-title">新しい形にする前に戻しますか</h2>
        <p>{shortTime(p.at)} に新しい形にする前の画面に戻します。そのあとに増えた数字や記録も、その時点に戻ります。</p>
        <p>いまの画面は控えに残します。</p>
        <div className="actions">
          <button className="secondary" onClick={p.onCancel} disabled={p.busy}>
            やめる
          </button>
          <button className="primary" onClick={p.onUndo} disabled={p.busy}>
            元に戻す
          </button>
        </div>
      </div>
    </div>
  )
}

/** タブの下の帯。古い・作り直しが残る・新しい形にした直後で出し分ける */
export function OldFormBar(p: {
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
    <button className="link" onClick={p.onUndo} disabled={p.busy}>
      元に戻す
    </button>
  )
  if (f.stage === 'unsupported')
    return (
      <div className="old-bar" role="status">
        <span>この画面は前の版の形です（{f.label}）。アプリでは新しい形にできません。AI の作業がうまく動かないことがあります。</span>
      </div>
    )
  if (f.stage === 'old')
    return (
      <div className="old-bar" role="status">
        <span>この画面は前の版の形です（{f.label}）。AI の作業がうまく動かないことがあります。</span>
        <button className="link" onClick={p.onMigrate} disabled={p.busy}>
          新しい形にする
        </button>
      </div>
    )
  if (f.stage === 'rework' && f.aiWorking)
    return (
      <div className="old-bar" role="status">
        <span>画面を新しい版に直しています。右のチャットで AI が作業中です。</span>
      </div>
    )
  if (f.stage === 'rework')
    return (
      <div className="old-bar" role="status">
        <span>
          {f.reworkPages.length
            ? `新しい版に直っていないループがあります（${f.reworkPages.map((n) => n.replace(/\.html$/, '')).join('・')}）。`
            : '新しい版に直っていないところがあります。'}
        </span>
        <button className="link" onClick={p.onRework} disabled={p.busy}>
          続きを AI に頼む
        </button>
        {undo}
      </div>
    )
  if (p.migration && !p.migration.closed)
    return (
      <div className="old-bar done" role="status">
        <span>新しい形にしました（{p.migration.from} → {p.latest}）。</span>
        {undo}
        <button className="link" onClick={p.onClose} disabled={p.busy}>
          閉じる
        </button>
      </div>
    )
  return null
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
