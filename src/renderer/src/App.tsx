import { useEffect, useState } from 'react'
import type { ProjectsSnapshot } from '@shared/types'

export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    return window.rla.onProjects(setSnap)
  }, [])

  if (!snap) return null
  const current = snap.projects.find((p) => p.id === snap.currentId) ?? null
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
          <div className="empty">
            <h1>{current.name}</h1>
            <p>このフォルダには、まだループがありません。</p>
          </div>
        ) : null}
      </main>
    </div>
  )
}
