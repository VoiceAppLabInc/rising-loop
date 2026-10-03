import { useEffect, useState } from 'react'
import { compareVersions } from '@shared/migrate'
import type { ProjectsSnapshot } from '@shared/types'
import { AiRows } from './AiSetup'
import { Button } from './Button'
import { Icon } from './Icon'

// アプリの画面（タブの列・プロジェクトが無いときの画面）。ダイアログ（設定も）はループの画面より上の透明な層（Overlay.tsx）に描く。
// ここから出すダイアログ（使い方・設定・ループが無いフォルダの確認）は、main を通して層に頼む
export function App() {
  const [snap, setSnap] = useState<ProjectsSnapshot | null>(null)

  useEffect(() => {
    void window.rla.getProjects().then(setSnap)
    return window.rla.onProjects(setSnap)
  }, [])

  const current = snap?.projects.find((p) => p.id === snap.currentId) ?? null
  const form = current && snap?.hasLoops[current.id] ? snap.forms[current.id] : null
  // 2.1.0 からの殻は、使い方と右の窓の開閉をアプリのタブの列に出す（それより前の殻は自分のボタンを持っている）
  const shellNew = !!form?.shellVersion && compareVersions(form.shellVersion, '2.1.0') >= 0
  const paneOpen = current ? (snap?.panes[current.id] ?? true) : true
  const nav = (current && snap?.nav[current.id]) || { back: false, forward: false }


  if (!snap) return null
  const add = () =>
    void window.rla.pickNewProject().then((r) => {
      setSnap(r.snap)
      if (r.ask) window.rla.openDialog({ kind: 'add', ...r.ask })
    })

  return (
    <div className={`app controls-${window.rla.controls}`}>
      <header className="tabs">
        {/* 戻る・進む。履歴はタブごと（そのタブのループの画面の履歴をたどる） */}
        <div className="nav">
          <Button variant="bar" size="sm" className="btn-icon" aria-label="戻る" title="戻る" disabled={!nav.back} onClick={() => current && void window.rla.go(current.id, -1)}>
            <Icon name="back" />
          </Button>
          <Button variant="bar" size="sm" className="btn-icon" aria-label="進む" title="進む" disabled={!nav.forward} onClick={() => current && void window.rla.go(current.id, 1)}>
            <Icon name="forward" />
          </Button>
        </div>
        {snap.projects.length > 0 && (
          <div className="track" role="tablist">
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
          </div>
        )}
        <Button variant="bar" size="sm" title="フォルダを開く" onClick={add}>
          <Icon name="plus" />
          プロジェクトを追加
        </Button>
        <div className="tab-actions">
          {/* 開発版（pnpm dev）は、普段使いのアプリと見分けられるようにする（データ置き場も別） */}
          {snap.dev && <span className="dev-badge">開発版</span>}
          {/* 新しい版のアプリがあるあいだだけ出す（お知らせを閉じたあとも、ここから開き直せる） */}
          {snap.update && (
            <Button variant="bar" size="sm" title="新しい版のお知らせを開く" onClick={() => window.rla.openDialog({ kind: 'update' })}>
              <Icon name="up" />
              新しい版
            </Button>
          )}
          {current && shellNew && (
            <>
              <Button variant="bar" size="sm" onClick={() => window.rla.openDialog({ kind: 'howto' })}>
                <Icon name="help" />
                使い方
              </Button>
              {/* 開いているとき（オン）だけ白く塗る */}
              <Button
                variant="bar"
                size="sm"
                aria-pressed={paneOpen}
                title={paneOpen ? 'AI の窓を閉じる' : 'AI の窓を開く'}
                onClick={() => void window.rla.setPane(current.id, !paneOpen).then(setSnap)}
              >
                <Icon name="chat" />
                AI
              </Button>
            </>
          )}
          <Button variant="bar" size="sm" className="btn-icon" aria-label="設定" title="設定" onClick={() => window.rla.openDialog({ kind: 'settings' })}>
            <Icon name="gear" />
          </Button>
        </div>
      </header>
      <main className="body">
        {!current ? (
          <Welcome onOpen={add} />
        ) : !snap.hasLoops[current.id] ? (
          // ループが無いあいだは、この下に全面のチャット（main が重ねる）を出す
          <div className="setup-head">
            <p>「{current.name}」をプロジェクトにしました。</p>
            <p className="sub">フォルダ：{current.folder}</p>
            <p>まず、このプロジェクトの目標を決めましょう。</p>
          </div>
        ) : null}
      </main>
    </div>
  )
}

/**
 * プロジェクトが無いときの画面（初めての人の入口）。① AI を使えるようにする（入れる・ログイン）② フォルダを開く。
 * AI はこのアプリに入っていないので、ここで公式の手順を動かす（設定の「AI」と同じ部品）
 */
function Welcome(p: { onOpen: () => void }) {
  const [ready, setReady] = useState<boolean | null>(null)
  return (
    <div className="welcome">
      <div className="welcome-in">
        <h1>ライジング・ループへようこそ</h1>
        <p className="sub">ひとつの数字を測り、それを上げる施策を AI と一緒に回していくアプリです。</p>
        <ol className="welcome-steps">
          <li className={ready ? 'done' : ''}>
            <h2>AI を使えるようにする</h2>
            <p className="sub">Claude Code か Codex の、どちらか1つが使えれば始められます。</p>
            <div className="ai-box">
              <AiRows onStatus={(s) => setReady(s.some((x) => x.state === 'ready'))} />
            </div>
          </li>
          <li>
            <h2>プロジェクトのフォルダを開く</h2>
            <p className="sub">サービスごとにフォルダを1つ選びます（企画書などがあれば入れておくと、AI が読みます）。ループがまだ無ければ、AI と目標を決めるところから始めます。</p>
            <Button variant="primary" onClick={p.onOpen}>
              フォルダを開く…
            </Button>
          </li>
        </ol>
      </div>
    </div>
  )
}
