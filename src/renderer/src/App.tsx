import { useEffect, useState } from 'react'
import { compareVersions } from '@shared/migrate'
import type { ProjectsSnapshot } from '@shared/types'
import { Button } from './Button'
import { Howto } from './Howto'
import { OldFormDialog, UndoDialog } from './OldForm'
import { OldSkillsDialog } from './OldSkills'
import { Settings } from './Settings'

export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)
  /** 前の版の画面の「⬆ アップデート」を押したプロジェクト（知らせを、記録に関係なくもう一度出す） */
  const [forced, setForced] = useState<string | null>(null)
  const [askUndo, setAskUndo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [howtoOpen, setHowtoOpen] = useState(false)
  /** 使い方を一度見たか（最初の1回だけ自動で開く）。読み終わるまでは null */
  const [howtoSeen, setHowtoSeen] = useState<boolean | null>(null)
  /** ほかの場所に入っている rising-loop（起動したときに1回だけ聞く） */
  const [oldSkills, setOldSkills] = useState<string[]>([])
  // ループが無いフォルダを選んだとき、新しいプロジェクトにしてよいかを聞く
  const [askAdd, setAskAdd] = useState<{ folder: string; name: string } | null>(null)

  useEffect(() => {
    void window.rla.settings().then((s) => setHowtoSeen(!!s.howtoSeen))
    void window.rla.oldSkills().then(setOldSkills)
    void window.rla.getProjects().then(setSnap)
    const off1 = window.rla.onProjects(setSnap)
    const off2 = window.rla.onOpenNotice(setForced)
    // ループの画面の上のカードで［元に戻す］が押されたら、確認をこちらで出す
    const off3 = window.rla.onAskUndo(() => setAskUndo(true))
    return () => {
      off1()
      off2()
      off3()
    }
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  const isOld = !!form && (form.stage === 'old' || form.stage === 'unsupported')
  // 古い形は、そのプロジェクトを開いたときに知らせる（同じ形について1回だけ）。あとは帯で出し続ける
  const notice = !!(current && form && isOld && (current.noticedForm !== form.key || forced === current.id))
  const undoing = askUndo && !!current?.migration
  // 2.1.0 からの殻は、使い方と右の窓の開閉をアプリのタブの列に出す（それより前の殻は自分のボタンを持っている）
  const shellNew = !!form?.shellVersion && compareVersions(form.shellVersion, '2.1.0') >= 0
  const paneOpen = current ? (snap?.panes[current.id] ?? true) : true

  // 使い方は、新しい殻のループを初めて開いたときに1回だけ自動で開く
  useEffect(() => {
    if (shellNew && howtoSeen === false && !notice && !oldSkills.length) setHowtoOpen(true)
  }, [shellNew, howtoSeen, notice, oldSkills.length])

  // ダイアログや設定を出しているあいだは、main が重ねている画面を隠す（ダイアログが下に隠れるため）
  const covered = notice || undoing || settingsOpen || howtoOpen || oldSkills.length > 0 || !!askAdd
  useEffect(() => {
    window.rla.setCovered(covered)
  }, [covered])

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
  const add = () =>
    void window.rla.pickNewProject().then((r) => {
      setSnap(r.snap)
      if (r.ask) setAskAdd(r.ask)
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
              <Button size="sm" onClick={() => setHowtoOpen(true)}>
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
      {settingsOpen && <Settings project={current} snap={snap} onSnap={setSnap} onClose={() => setSettingsOpen(false)} />}
      {howtoOpen && (
        <Howto
          skillVersion={snap.skillVersion}
          appVersion={snap.appVersion}
          onClose={() => {
            setHowtoOpen(false)
            setHowtoSeen(true)
            void window.rla.howtoSeen()
          }}
        />
      )}
      {oldSkills.length > 0 && (
        <OldSkillsDialog
          dirs={oldSkills}
          busy={busy}
          onTrash={() => {
            setBusy(true)
            void window.rla.trashOldSkills().then(setOldSkills).finally(() => setBusy(false))
          }}
          onKeep={() => {
            setOldSkills([])
            void window.rla.keepOldSkills()
          }}
        />
      )}
      {askAdd && (
        <AddProjectDialog
          name={askAdd.name}
          busy={busy}
          onCancel={() => setAskAdd(null)}
          onAdd={() => run(() => window.rla.addProject(askAdd.folder), () => setAskAdd(null))}
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

/** ループが無いフォルダを選んだときの確認 */
function AddProjectDialog(p: { name: string; busy: boolean; onCancel: () => void; onAdd: () => void }) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
        <h2 id="add-project-title">このフォルダにはループがありません</h2>
        <p>「{p.name}」にはループがありません。新しいプロジェクトとして追加しますか？</p>
        <div className="actions">
          <Button onClick={p.onCancel} disabled={p.busy}>
            やめる
          </Button>
          <Button variant="primary" onClick={p.onAdd} disabled={p.busy}>
            追加する
          </Button>
        </div>
      </div>
    </div>
  )
}
