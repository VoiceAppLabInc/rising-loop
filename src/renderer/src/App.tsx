import { useEffect, useState } from 'react'
import { compareVersions } from '@shared/migrate'
import type { ProjectsSnapshot } from '@shared/types'
import { Button } from './Button'
import { Settings } from './Settings'

// アプリの画面（タブの列・設定・プロジェクトが無いときの画面）。ダイアログはループの画面より上の透明な層（Overlay.tsx）に描く。
// ここから出すダイアログ（使い方・ループが無いフォルダの確認）は、main を通して層に頼む
export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    return window.rla.onProjects(setSnap)
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  // 2.1.0 からの殻は、使い方と右の窓の開閉をアプリのタブの列に出す（それより前の殻は自分のボタンを持っている）
  const shellNew = !!form?.shellVersion && compareVersions(form.shellVersion, '2.1.0') >= 0
  const paneOpen = current ? (snap?.panes[current.id] ?? true) : true

  // 設定は画面全体をおおうので、そのあいだは main が重ねている画面を隠す（設定が下に隠れるため）
  useEffect(() => {
    window.rla.setCovered(settingsOpen)
  }, [settingsOpen])

  if (!snap) return null
  const add = () =>
    void window.rla.pickNewProject().then((r) => {
      setSnap(r.snap)
      if (r.ask) window.rla.openDialog({ kind: 'add', ...r.ask })
    })

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
        <Button variant="quiet" size="sm" className="tab-add" title="フォルダを開く" onClick={add}>
          <span className="plus">＋</span>プロジェクトを追加
        </Button>
        <div className="tab-actions">
          {current && shellNew && (
            <>
              <Button size="sm" onClick={() => window.rla.openDialog({ kind: 'howto' })}>
                ? 使い方
              </Button>
              <Button size="sm" className="btn-ai" aria-pressed={paneOpen} onClick={() => void window.rla.setPane(current.id, !paneOpen).then(setSnap)}>
                {paneOpen ? 'AI ▸' : 'AI ◂'}
              </Button>
            </>
          )}
          <Button size="sm" className="btn-gear" aria-label="設定" title="設定" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>
            ⚙
          </Button>
        </div>
      </header>
      <main className="body">
        {!current ? (
          <div className="empty">
            <h1>プロジェクトのフォルダを開きましょう</h1>
            <p>サービスのフォルダを選ぶと、そのフォルダのループを開きます。</p>
            <Button variant="primary" onClick={add}>
              フォルダを開く…
            </Button>
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
      {settingsOpen && <Settings project={current} snap={snap} onSnap={setSnap} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
