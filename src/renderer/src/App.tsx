import { useEffect, useState } from 'react'
import type { ProjectsSnapshot } from '@shared/types'
import { OldFormBar, OldFormDialog, UndoDialog } from './OldForm'

export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)
  /** 前の版の画面の「⬆ アップデート」を押したプロジェクト（知らせを、記録に関係なくもう一度出す） */
  const [forced, setForced] = useState<string | null>(null)
  const [askUndo, setAskUndo] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    const off1 = window.rla.onProjects(setSnap)
    const off2 = window.rla.onOpenNotice(setForced)
    return () => {
      off1()
      off2()
    }
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  const isOld = !!form && (form.stage === 'old' || form.stage === 'unsupported')
  // 古い形は、そのプロジェクトを開いたときに知らせる（同じ形について1回だけ）。あとは帯で出し続ける
  const notice = !!(current && form && isOld && (current.noticedForm !== form.key || forced === current.id))
  const undoing = askUndo && !!current?.migration

  // ダイアログを出しているあいだは、main が重ねている画面を隠す（ダイアログが下に隠れるため）
  useEffect(() => {
    window.rla.setCovered(notice || undoing)
  }, [notice, undoing])

  /** main の処理を1つずつ走らせる（押しているあいだはボタンを押せなくする） */
  const run = (f: () => Promise<ProjectsSnapshot>, after?: () => void) => {
    setBusy(true)
    void f()
      .then((s) => {
        setSnap(s)
        after?.()
      })
      .finally(() => setBusy(false))
  }

  if (!snap) return null
  const add = () => void window.rla.addProject().then(setSnap)

  return (
    <div className={`app controls-${window.rla.controls}`}>
      <header className="tabs" role="tablist">
        {snap.projects.map((p) => (
          <button
            key={p.id}
            role="tab"
            className="tab"
            aria-selected={p.id === snap.currentId}
            title={p.folder}
            onClick={() => void window.rla.selectProject(p.id).then(setSnap)}
          >
            {p.name}
          </button>
        ))}
        <button className="tab-add" title="フォルダを開く" aria-label="プロジェクトを追加" onClick={add}>
          ＋
        </button>
      </header>
      {current && form && (
        <OldFormBar
          form={form}
          migration={current.migration}
          latest={snap.skillVersion}
          busy={busy}
          onMigrate={() => run(() => window.rla.migrate(current.id))}
          onRework={() => run(() => window.rla.rework(current.id))}
          onUndo={() => setAskUndo(true)}
          onClose={() => run(() => window.rla.closeMigrated(current.id))}
        />
      )}
      <main className="body">
        {!current ? (
          <div className="empty">
            <h1>プロジェクトのフォルダを開きましょう</h1>
            <p>サービスのフォルダを選ぶと、そのフォルダのループを開きます。</p>
            <button className="primary" onClick={add}>
              フォルダを開く…
            </button>
          </div>
        ) : !snap.hasLoops[current.id] ? (
          // ループが無いあいだは、この下に全面のチャット（main が重ねる）を出す
          <div className="setup-head">
            <p>「{current.name}」をプロジェクトにしました。</p>
            <p className="sub">フォルダ：{current.folder}</p>
            <p>まず、このプロジェクトの目標を決めましょう。</p>
          </div>
        ) : null}
      </main>
      {notice && current && form && (
        <OldFormDialog
          name={current.name}
          label={form.label}
          latest={snap.skillVersion}
          unsupported={form.stage === 'unsupported'}
          busy={busy}
          onLater={() => run(() => window.rla.noticed(current.id, form.key), () => setForced(null))}
          onMigrate={() => run(() => window.rla.migrate(current.id), () => setForced(null))}
        />
      )}
      {undoing && current?.migration && (
        <UndoDialog
          at={current.migration.at}
          busy={busy}
          onCancel={() => setAskUndo(false)}
          onUndo={() => run(() => window.rla.undo(current.id), () => setAskUndo(false))}
        />
      )}
    </div>
  )
}
