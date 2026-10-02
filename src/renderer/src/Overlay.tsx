// ループの画面の上に重ねる透明な層の中身（いまのプロジェクトのカード）。
// ループの画面は別の層なので、アプリの画面に描いた部品はその下に隠れる。カードの大きさだけの層を main が上に重ねる
import { useEffect, useRef, useState } from 'react'
import type { ProjectsSnapshot } from '@shared/types'
import { OldFormCard } from './OldForm'

export function Overlay() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    return window.rla.onProjects(setSnap)
  }, [])

  // カードの大きさを main に伝える（main は層をその大きさにして、ループの画面の上の真ん中に置く）
  useEffect(() => {
    const el = box.current
    if (!el) return
    // カードの周りの余白（影の分）も含めた大きさ。カードが無ければ 0（層を隠す）
    const report = () => {
      const r = el.getBoundingClientRect()
      const has = !!el.firstElementChild
      window.rla.overlaySize(has ? Math.ceil(r.width) : 0, has ? Math.ceil(r.height) : 0)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    const mo = new MutationObserver(report)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  const run = (f: () => Promise<ProjectsSnapshot>) => {
    setBusy(true)
    void f()
      .then(setSnap)
      .finally(() => setBusy(false))
  }
  return (
    <div className="overlay-box" ref={box}>
      {current && form && snap && (
        <OldFormCard
          form={form}
          migration={current.migration}
          latest={snap.skillVersion}
          busy={busy}
          onMigrate={() => run(() => window.rla.migrate(current.id))}
          onRework={() => run(() => window.rla.rework(current.id))}
          onUndo={() => window.rla.askUndo()}
          onClose={() => run(() => window.rla.closeMigrated(current.id))}
        />
      )}
    </div>
  )
}
