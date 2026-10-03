// ループの画面の上に重ねる透明な層の中身。いまのプロジェクトのカードと、アプリのダイアログをここに描く。
// ループの画面と右のチャットは別の層で、アプリの画面に描いた部品はその下に隠れる。
// カードだけのときは、main が層をカードの大きさにして上の真ん中に置く。ダイアログを出すあいだは窓いっぱいに広げ、
// 後ろのループの画面とチャットは動いたまま薄暗く見せる
import { useEffect, useRef, useState } from 'react'
import { compareVersions } from '@shared/migrate'
import type { AskRequest, DialogRequest, ProjectsSnapshot } from '@shared/types'
import { AskDialog } from './Ask'
import { Button } from './Button'
import { Howto } from './Howto'
import { OldFormCard, OldFormDialog, UndoDialog } from './OldForm'
import { OldSkillsDialog } from './OldSkills'
import { Settings } from './Settings'
import { UpdateDialog } from './Update'

export function Overlay() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  /** 前の版の画面の「⬆ アップデート」を押したプロジェクト（知らせを、記録に関係なくもう一度出す） */
  const [forced, setForced] = useState<string | null>(null)
  const [askUndo, setAskUndo] = useState(false)
  const [howtoOpen, setHowtoOpen] = useState(false)
  /** 使い方を一度見たか（最初の1回だけ自動で開く）。読み終わるまでは null */
  const [howtoSeen, setHowtoSeen] = useState<boolean | null>(null)
  /** ほかの場所に入っている rising-loop（起動したときに1回だけ聞く） */
  const [oldSkills, setOldSkills] = useState<string[]>([])
  // ループが無いフォルダを選んだとき、新しいプロジェクトにしてよいかを聞く
  const [askAdd, setAskAdd] = useState<{ folder: string; name: string } | null>(null)
  // ループの画面（2.3.0 からの殻）が頼んだ、コメント・指示の入力の窓
  const [ask, setAsk] = useState<(AskRequest & { id: number }) | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 新しい版のお知らせ。updateSeen は、自動で出した版（読み終わるまでは null） */
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateSeen, setUpdateSeen] = useState<string | null | undefined>(null)
  /** 設定を開いたときのプロジェクト。いまのプロジェクトがこれと違うものになったら、設定を閉じる（別のプロジェクトの設定を開いたままにしない） */
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const currentIdRef = useRef<string | null>(null)
  currentIdRef.current = snap?.currentId ?? null
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.rla.settings().then((s) => {
      setHowtoSeen(!!s.howtoSeen)
      setUpdateSeen(s.updateSeen)
    })
    void window.rla.oldSkills().then(setOldSkills)
    void window.rla.getProjects().then(setSnap)
    const offs = [
      window.rla.onProjects(setSnap),
      window.rla.onOpenNotice(setForced),
      window.rla.onAsk(setAsk),
      // アプリの画面（タブの列）から頼まれたダイアログ
      window.rla.onOpenDialog((req: DialogRequest) => {
        if (req.kind === 'howto') setHowtoOpen(true)
        if (req.kind === 'update') setUpdateOpen(true)
        if (req.kind === 'settings') {
          setSettingsFor(currentIdRef.current)
          setSettingsOpen(true)
        }
        if (req.kind === 'add') setAskAdd({ folder: req.folder, name: req.name })
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  const isOld = !!form && (form.stage === 'old' || form.stage === 'unsupported')
  // 古い形は、そのプロジェクトを開いたときに知らせる（同じ形について1回だけ）。あとはカードで出し続ける
  const notice = !!(current && form && isOld && (current.noticedForm !== form.key || forced === current.id))
  const undoing = askUndo && !!current?.migration
  // 2.1.0 からの殻は、使い方をアプリのタブの列に出す（それより前の殻は自分で持っている）
  const shellNew = !!form?.shellVersion && compareVersions(form.shellVersion, '2.1.0') >= 0

  // 使い方は、新しい殻のループを初めて開いたときに1回だけ自動で開く
  useEffect(() => {
    if (shellNew && howtoSeen === false && !notice && !oldSkills.length) setHowtoOpen(true)
  }, [shellNew, howtoSeen, notice, oldSkills.length])

  // 新しい版は、見つけたときに1回だけ自動で開く（同じ版については二度と自動では出さない）。ほかのお知らせが先
  const update = snap?.update ?? null
  useEffect(() => {
    if (update && updateSeen !== null && updateSeen !== update.version && !notice && !oldSkills.length && !howtoOpen) {
      setUpdateOpen(true)
      setUpdateSeen(update.version)
      void window.rla.updateSeen(update.version)
    }
  }, [update, updateSeen, notice, oldSkills.length, howtoOpen])

  // ダイアログを出しているかを main に伝える（main が層を窓いっぱいに広げ、層に入力を向ける）
  useEffect(() => {
    if (settingsOpen && (snap?.currentId ?? null) !== settingsFor) setSettingsOpen(false)
  }, [settingsOpen, settingsFor, snap?.currentId])

  const showUpdate = updateOpen && !!update
  const dialog = notice || undoing || howtoOpen || oldSkills.length > 0 || !!askAdd || !!ask || settingsOpen || showUpdate
  useEffect(() => {
    window.rla.overlayDialog(dialog)
  }, [dialog])

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

  return (
    <>
      <div className="overlay-box" ref={box}>
        {/* ダイアログのあいだは、層が窓いっぱいになるのでカードは出さない */}
        {!dialog && current && form && snap && (
          <OldFormCard
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
      </div>
      {settingsOpen && snap && <Settings project={current} snap={snap} onSnap={setSnap} onClose={() => setSettingsOpen(false)} />}
      {notice && current && form && snap && (
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
      {howtoOpen && snap && (
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
      {showUpdate && update && snap && (
        <UpdateDialog
          update={update}
          appVersion={snap.appVersion}
          onLater={() => setUpdateOpen(false)}
          onDone={() => setUpdateOpen(false)}
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
        />
      )}
      {ask && (
        <AskDialog
          key={ask.id}
          req={ask}
          onAnswer={(v) => {
            window.rla.askReply(ask.id, v)
            setAsk(null)
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
    </>
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
