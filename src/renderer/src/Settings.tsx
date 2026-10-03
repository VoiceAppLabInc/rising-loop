// 設定のダイアログ。プロジェクトごと（フォルダ・AI・コマンド実行の確認・外す）と、アプリ全体（claude / codex の状態・版）。
// ほかのダイアログと同じく、ループの画面より上の透明な層（Overlay.tsx）に描き、後ろのループの画面を隠さない
import { useEffect, useRef, useState } from 'react'
import type { AiKind, PermMode, Project, ProjectsSnapshot } from '@shared/types'
import { AiRows } from './AiSetup'
import { Button } from './Button'

/** プロジェクトの設定の下書き。［OK］を押すまで適用しない */
type Draft = { folder: string; ai: AiKind; perm: PermMode }
const draftOf = (pr: Project | null): Draft | null => (pr ? { folder: pr.folder, ai: pr.ai ?? 'claude', perm: pr.perm ?? 'ask' } : null)

export function Settings(p: { project: Project | null; snap: ProjectsSnapshot; onSnap: (s: ProjectsSnapshot) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  // フォルダ・使う AI・確認のモードは、選んでもその場では切り替えない。［OK］でまとめて適用する（［キャンセル］・Esc・背景では何も変えない）
  const [draft, setDraft] = useState<Draft | null>(() => draftOf(p.project))
  const ok = () => {
    const pr = p.project
    const before = draftOf(pr)
    if (!pr || !draft || !before || (draft.folder === before.folder && draft.ai === before.ai && draft.perm === before.perm)) return p.onClose()
    setBusy(true)
    void window.rla
      .updateProject(pr.id, { folder: draft.folder !== before.folder ? draft.folder : undefined, ai: draft.ai, perm: draft.perm })
      .then(p.onSnap)
      .finally(() => {
        setBusy(false)
        p.onClose()
      })
  }
  const run = (f: () => Promise<ProjectsSnapshot>) => {
    setBusy(true)
    void f()
      .then(p.onSnap)
      .finally(() => setBusy(false))
  }
  // Esc で閉じる（外す確認を出しているあいだは、その確認が先に Esc を受け取って閉じる）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])
  // 背景で押して背景で離したときだけ閉じる
  const downOnBackdrop = useRef(false)
  return (
    <div
      className="backdrop"
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) p.onClose()
        downOnBackdrop.current = false
      }}
    >
      <div className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-head">
          <h2 id="settings-title">設定</h2>
        </header>
        {/* 中身だけをスクロールし、見出しと［キャンセル］［OK］は出したままにする */}
        <div className="settings-body">
        {p.project && draft && <ProjectSettings key={p.project.id} project={p.project} draft={draft} onDraft={setDraft} busy={busy} run={run} onRemoved={p.onClose} />}
        <AiSettings />
        <section className="settings-sec">
          <h3>バージョン</h3>
          <div className="row">
            <span className="key">アプリ</span>
            <span className="val">v{p.snap.appVersion}</span>
          </div>
          <div className="row">
            <span className="key">スキル</span>
            <span className="val">v{p.snap.skillVersion}</span>
          </div>
        </section>
        </div>
        {/* 使い方と同じく、ボタンは下の右端 */}
        <div className="actions settings-foot">
          <Button onClick={p.onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={ok} disabled={busy}>
            OK
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProjectSettings(p: {
  project: Project
  draft: Draft
  onDraft: (d: Draft) => void
  busy: boolean
  run: (f: () => Promise<ProjectsSnapshot>) => void
  onRemoved: () => void
}) {
  const pr = p.project
  const d = p.draft
  const set = (patch: Partial<Draft>) => p.onDraft({ ...d, ...patch })
  // 外すのは、確認してから（聞かずに外さない）
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    if (!confirmRemove) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setConfirmRemove(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirmRemove])
  return (
    <section className="settings-sec">
      <h3>プロジェクト「{pr.name}」</h3>
      <div className="row">
        <span className="key">フォルダ</span>
        <span className="val">
          <span className="path" title={d.folder}>
            {d.folder}
          </span>
        </span>
        <span className="act">
          <Button disabled={p.busy} onClick={() => void window.rla.chooseFolder().then((f) => f && set({ folder: f }))}>
            選び直す…
          </Button>
        </span>
      </div>
      <div className="row" role="radiogroup" aria-label="使う AI">
        <span className="key">使う AI</span>
        <span className="val">
        {(['claude', 'codex'] as AiKind[]).map((k) => (
          <label key={k} className="choice">
            <input
              type="radio"
              name="ai"
              checked={d.ai === k}
              onChange={() => set({ ai: k })}
            />
            {k === 'claude' ? 'Claude Code' : 'Codex'}
          </label>
        ))}
        </span>
      </div>
      <div className="row" role="radiogroup" aria-label="コマンド実行の確認">
        <span className="key">コマンド実行の確認</span>
        <span className="val">
        <label className="choice">
          <input
            type="radio"
            name="perm"
            checked={d.perm === 'ask'}
            onChange={() => set({ perm: 'ask' })}
          />
          確認する（いつもの設定のまま）
        </label>
        <label className="choice">
          <input
            type="radio"
            name="perm"
            checked={d.perm === 'auto'}
            onChange={() => set({ perm: 'auto' })}
          />
          すべて自動で許可
        </label>
        </span>
      </div>
      <p className="sub note">OK を押すと、このプロジェクトのチャットを起動し直します（会話は続きます）。</p>
      <div className="danger">
        <div className="row">
          <div className="danger-text">
            <h4>プロジェクトを外す</h4>
            <p className="sub">アプリのタブから外すだけで、フォルダの中身には触れません。</p>
          </div>
          <span className="act">
            <Button variant="danger" disabled={p.busy} onClick={() => setConfirmRemove(true)}>
              外す
            </Button>
          </span>
        </div>
      </div>
      {confirmRemove && (
        // 設定のダイアログの上に重ねて出す
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title">
            <h2 id="remove-title">「{pr.name}」を外しますか？</h2>
            <p>アプリのタブから外すだけで、フォルダの中身には触れません。</p>
            <div className="actions">
              <Button onClick={() => setConfirmRemove(false)} disabled={p.busy}>
                やめる
              </Button>
              <Button variant="danger-solid" disabled={p.busy} onClick={() => p.run(() => window.rla.removeProject(pr.id).finally(p.onRemoved))}>
                外す
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function AiSettings() {
  return (
    <section className="settings-sec">
      <h3>AI</h3>
      <AiRows />
    </section>
  )
}
