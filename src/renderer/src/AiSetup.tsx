// claude / codex の状態と、公式のインストール・ログインを動かすターミナル。設定のダイアログと、初めての人の画面（App.tsx）で使う
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AiKind, AiStatus } from '@shared/types'
import { Button } from './Button'

const STATE_LABEL: Record<AiStatus['state'], string> = { missing: '入っていません', login: 'ログインしていません', ready: '使えます' }

/** claude / codex の行（状態・版・［入れる］［ログイン］）。状態が分かるたびに onStatus に渡す */
export function AiRows(p: { onStatus?: (s: AiStatus[]) => void }) {
  const [status, setStatus] = useState<AiStatus[] | null>(null)
  const [tool, setTool] = useState<{ ai: AiKind; kind: 'install' | 'login'; done: number | null } | null>(null)
  const refresh = () =>
    void window.rla.aiStatus().then((s) => {
      setStatus(s)
      p.onStatus?.(s)
    })
  useEffect(refresh, [])
  return (
    <>
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
    </>
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
