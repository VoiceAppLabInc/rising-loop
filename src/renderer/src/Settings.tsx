// 設定画面。プロジェクトごと（名前・フォルダ・AI・コマンド実行の確認・外す）と、アプリ全体（claude / codex の状態・版）
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AiKind, AiStatus, PermMode, Project, ProjectsSnapshot } from '@shared/types'
import { Button } from './Button'

const STATE_LABEL: Record<AiStatus['state'], string> = { missing: '入っていません', login: 'ログインしていません', ready: '使えます' }

export function Settings(p: { project: Project | null; snap: ProjectsSnapshot; onSnap: (s: ProjectsSnapshot) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = (f: () => Promise<ProjectsSnapshot>) => {
    setBusy(true)
    void f()
      .then(p.onSnap)
      .finally(() => setBusy(false))
  }
  return (
    <div className="settings" role="region" aria-label="設定">
      <div className="settings-inner">
        <header className="settings-head">
          <h2>設定</h2>
          <Button onClick={p.onClose}>
            閉じる
          </Button>
        </header>
        {p.project && <ProjectSettings key={p.project.id} project={p.project} busy={busy} run={run} />}
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
    </div>
  )
}

function ProjectSettings(p: { project: Project; busy: boolean; run: (f: () => Promise<ProjectsSnapshot>) => void }) {
  const pr = p.project
  // 押したらすぐ選んだ状態にする（保存とチャットの起動し直しは main が裏でやる）
  const [ai, setAi] = useState<AiKind>(pr.ai ?? 'claude')
  const [perm, setPerm] = useState<PermMode>(pr.perm ?? 'ask')
  return (
    <section className="settings-sec">
      <h3>プロジェクト「{pr.name}」</h3>
      <div className="row">
        <span className="key">フォルダ</span>
        <span className="val">
          <span className="path" title={pr.folder}>
            {pr.folder}
          </span>
        </span>
        <span className="act">
          <Button disabled={p.busy} onClick={() => p.run(() => window.rla.pickFolder(pr.id))}>
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
              checked={ai === k}
              onChange={() => {
                setAi(k)
                p.run(() => window.rla.updateProject(pr.id, { ai: k }))
              }}
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
            checked={perm === 'ask'}
            onChange={() => {
              setPerm('ask')
              p.run(() => window.rla.updateProject(pr.id, { perm: 'ask' }))
            }}
          />
          確認する（いつもの設定のまま）
        </label>
        <label className="choice">
          <input
            type="radio"
            name="perm"
            checked={perm === 'auto'}
            onChange={() => {
              setPerm('auto')
              p.run(() => window.rla.updateProject(pr.id, { perm: 'auto' }))
            }}
          />
          すべて自動で許可
        </label>
        </span>
      </div>
      <p className="sub note">変えると、このプロジェクトのチャットを起動し直します（会話は続きます）。</p>
      <div className="danger">
        <div className="row">
          <div className="danger-text">
            <h4>プロジェクトを外す</h4>
            <p className="sub">アプリの一覧から外すだけで、フォルダの中身には触れません。</p>
          </div>
          <span className="act">
            <Button variant="danger" disabled={p.busy} onClick={() => p.run(() => window.rla.removeProject(pr.id))}>
              外す
            </Button>
          </span>
        </div>
      </div>
    </section>
  )
}

function AiSettings() {
  const [status, setStatus] = useState<AiStatus[] | null>(null)
  const [tool, setTool] = useState<{ ai: AiKind; kind: 'install' | 'login'; done: number | null } | null>(null)
  const refresh = () => void window.rla.aiStatus().then(setStatus)
  useEffect(refresh, [])
  return (
    <section className="settings-sec">
      <h3>AI</h3>
      {!status && <p className="sub">確かめています…</p>}
      {status?.map((s) => (
        <div key={s.ai} className="row ai-row" data-ai={s.ai}>
          <span className="key">{s.ai === 'claude' ? 'Claude Code' : 'Codex'}</span>
          <span className="val">
            <span className={`state state-${s.state}`}>{STATE_LABEL[s.state]}</span>
            {s.version && <span className="sub">{s.version}</span>}
          </span>
          <span className="act">
            {s.state === 'missing' && (
              <Button disabled={!!tool && tool.done == null} onClick={() => setTool({ ai: s.ai, kind: 'install', done: null })}>
                入れる
              </Button>
            )}
            {s.state === 'login' && (
              <Button disabled={!!tool && tool.done == null} onClick={() => setTool({ ai: s.ai, kind: 'login', done: null })}>
                ログイン
              </Button>
            )}
          </span>
        </div>
      ))}
      {tool && (
        <ToolTerminal
          key={`${tool.ai}-${tool.kind}`}
          ai={tool.ai}
          kind={tool.kind}
          onExit={(code) => {
            setTool({ ...tool, done: code })
            refresh()
          }}
          onClose={() => setTool(null)}
          done={tool.done}
        />
      )}
    </section>
  )
}

/** 公式のインストールとログインを動かすターミナル。終わったら状態を確かめ直す */
function ToolTerminal(p: { ai: AiKind; kind: 'install' | 'login'; done: number | null; onExit: (code: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const term = new Terminal({ fontSize: 12, fontFamily: '"SF Mono", Menlo, "Cascadia Mono", Consolas, monospace', theme: { background: '#16171a' }, convertEol: false })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(box.current!)
    try {
      fit.fit()
    } catch {
      // 大きさが測れないときは決まった大きさで始める
    }
    ;(window as unknown as { __rlaToolTerm: Terminal }).__rlaToolTerm = term // 画面の流れのテストで中身を読む
    const offData = window.rla.onToolData((d) => term.write(d))
    const offExit = window.rla.onToolExit((code) => p.onExit(code))
    term.onData((d) => window.rla.toolInput(d))
    void window.rla.runTool(p.ai, p.kind, term.cols, term.rows)
    return () => {
      offData()
      offExit()
      window.rla.toolStop()
      term.dispose()
    }
    // 起動は1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="tool">
      <div className="tool-head">
        <span>
          {p.ai === 'claude' ? 'Claude Code' : 'Codex'}を{p.kind === 'install' ? '入れています' : 'ログインしています'}
          {p.done != null && (p.done === 0 ? '（終わりました）' : `（終わりました。コード ${p.done}）`)}
        </span>
        <Button size="sm" onClick={p.onClose}>
          {p.done == null ? '止める' : '閉じる'}
        </Button>
      </div>
      <div className="tool-term" ref={box} />
    </div>
  )
}
