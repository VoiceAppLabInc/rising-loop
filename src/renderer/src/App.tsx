import { useEffect, useState } from 'react'
import type { ProjectsSnapshot } from '@shared/types'
import { OldFormBar, OldFormDialog } from './OldForm'

export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    return window.rla.onProjects(setSnap)
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  // 古い形は、そのプロジェクトを開いたときに知らせる（同じ形について1回だけ）。あとは帯で出し続ける
  const notice = !!(current && form && !form.current && current.noticedForm !== form.key)

  // ダイアログを出しているあいだは、main が重ねている画面を隠す（ダイアログが下に隠れるため）
  useEffect(() => {
    window.rla.setCovered(notice)
  }, [notice])

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
      {current && form && !form.current && <OldFormBar label={form.label} />}
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
          onLater={() => void window.rla.noticed(current.id, form.key).then(setSnap)}
        />
      )}
    </div>
  )
}
