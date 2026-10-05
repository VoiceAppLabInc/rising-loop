// claude / codex の状態と、公式のインストール・ログインを動かすターミナル。設定のダイアログと、初めての人の画面（App.tsx）で使う。
// 何も入っていない人を基準にする：動くものが無ければ［入れる］（公式の単体版。Node は要らない）→ 入れ終わったらそのまま［ログイン］へ。
// 失敗しても「command not found」「コード 127」のような中身は見せず、言葉で知らせる（ターミナルの文字は「詳しく見る」で開いたときだけ）
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AiKind, AiStatus } from '@shared/types'
import { Button } from './Button'
import { attachClipboard } from './termClipboard'

const NAME: Record<AiKind, string> = { claude: 'Claude Code', codex: 'Codex' }
const STATE_LABEL: Record<AiStatus['state'], string> = {
  missing: '入っていません',
  broken: '入っていますが動きません',
  old: '古い版です',
  login: 'ログインしていません',
  ready: '使えます'
}
/** 入れる・入れ直すで直る状態 */
const needsInstall = (s: AiStatus['state']) => s === 'missing' || s === 'broken' || s === 'old'

/**
 * claude / codex の行（状態・版・［入れる］［ログイン］）。状態が分かるたびに onStatus に渡す。
 * focus（ようこその画面）のときは Claude Code だけを出し、Codex は「Codex を使う場合」の中にしまう（初めての人に選ばせない）
 */
export function AiRows(p: { onStatus?: (s: AiStatus[]) => void; focus?: AiKind }) {
  const [status, setStatus] = useState<AiStatus[] | null>(null)
  const [tool, setTool] = useState<{ ai: AiKind; kind: 'install' | 'login'; done: number | null } | null>(null)
  const refresh = () =>
    window.rla.aiStatus().then((s) => {
      setStatus(s)
      p.onStatus?.(s)
      return s
    })
  useEffect(() => void refresh(), [])
  const busy = !!tool && tool.done == null
  // 確かめているあいだも行は出しておき、状態だけを「確かめています…」にする（あとから行が増えて高さが変わらないように）
  type Shown = { ai: AiKind; state: AiStatus['state'] | null; version: string | null }
  const shown: Shown[] = status ?? (['claude', 'codex'] as AiKind[]).map((ai) => ({ ai, state: null, version: null }))
  const row = (s: Shown) => (
    <div key={s.ai} className="row ai-row" data-ai={s.ai}>
      <span className="key">{NAME[s.ai]}</span>
      <span className="val">
        {s.state == null ? <span className="state state-checking">確かめています…</span> : <span className={`state state-${s.state}`}>{STATE_LABEL[s.state]}</span>}
        {(s.state === 'ready' || s.state === 'login') && s.version && <span className="sub">{s.version}</span>}
        {(s.state === 'broken' || s.state === 'old') && <span className="sub">［入れ直す］で新しく入れます（ほかのアプリの {NAME[s.ai]} には触りません）</span>}
      </span>
      <span className="act">
        {s.state != null && needsInstall(s.state) && (
          <Button variant={p.focus === s.ai ? 'primary' : undefined} disabled={busy} onClick={() => setTool({ ai: s.ai, kind: 'install', done: null })}>
            {s.state === 'missing' ? '入れる' : '入れ直す'}
          </Button>
        )}
        {s.state === 'login' && (
          <Button variant={p.focus === s.ai ? 'primary' : undefined} disabled={busy} onClick={() => setTool({ ai: s.ai, kind: 'login', done: null })}>
            ログイン
          </Button>
        )}
      </span>
    </div>
  )
  const main = shown.filter((s) => !p.focus || s.ai === p.focus)
  const others = p.focus ? shown.filter((s) => s.ai !== p.focus) : []
  return (
    <>
      {main.map(row)}
      {others.length > 0 && (
        <details className="ai-other" open={others.some((s) => s.state === 'ready') || tool?.ai === others[0].ai}>
          <summary>{others.map((s) => NAME[s.ai]).join('・')} を使う場合</summary>
          {others.map(row)}
        </details>
      )}
      {tool && (
        <ToolTerminal
          key={`${tool.ai}-${tool.kind}`}
          ai={tool.ai}
          kind={tool.kind}
          done={tool.done}
          onExit={(code) => {
            setTool({ ...tool, done: code })
            void refresh().then((s) => {
              // 入れ終わって、まだログインしていなければ、そのままログインへ進む
              if (tool.kind === 'install' && code === 0 && s.find((x) => x.ai === tool.ai)?.state === 'login') setTool({ ai: tool.ai, kind: 'login', done: null })
            })
          }}
          onClose={() => setTool(null)}
        />
      )}
    </>
  )
}

/**
 * 公式のインストールとログインを動かすターミナル。入れるあいだは中身を畳んで「入れています…」だけを出す。
 * ログインは、ブラウザが開かないときにコードを貼ることがあるので、ターミナルを出したままにする
 */
function ToolTerminal(p: { ai: AiKind; kind: 'install' | 'login'; done: number | null; onExit: (code: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [showLog, setShowLog] = useState(p.kind === 'login')
  useEffect(() => {
    const term = new Terminal({ fontSize: 12, fontFamily: '"SF Mono", Menlo, "Cascadia Mono", Consolas, monospace', theme: { background: '#16171a' }, convertEol: false, cols: 100, rows: 16 })
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(box.current!)
    try {
      if (box.current!.offsetHeight > 0) fit.fit()
    } catch {
      // 大きさが測れないときは決まった大きさで始める
    }
    ;(window as unknown as { __rlaToolTerm: Terminal }).__rlaToolTerm = term // 画面の流れのテストで中身を読む
    const offData = window.rla.onToolData((d) => term.write(d))
    const offExit = window.rla.onToolExit((code) => p.onExit(code))
    term.onData((d) => window.rla.toolInput(d))
    // ログインのコードを貼れるように（Windows は Ctrl+V・右クリック。Mac は ⌘V）
    const offClip = attachClipboard(term, box.current!, window.rla.clip)
    void window.rla.runTool(p.ai, p.kind, term.cols, term.rows)
    return () => {
      offClip()
      offData()
      offExit()
      window.rla.toolStop()
      term.dispose()
    }
    // 起動は1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 「詳しく見る」で開いたら、大きさを合わせ直す
  useEffect(() => {
    if (!showLog) return
    try {
      fitRef.current?.fit()
    } catch {
      // 測れなければそのまま
    }
  }, [showLog])
  const name = NAME[p.ai]
  const message =
    p.done == null
      ? p.kind === 'install'
        ? `${name}を入れています…（1〜2分）`
        : 'ブラウザが開いたら、ログインしてください。ブラウザにコードが出たら、下に貼って Enter を押します'
      : p.done === 0
        ? p.kind === 'install'
          ? `${name}を入れました`
          : 'ログインしました'
        : p.kind === 'install'
          ? `うまく入りませんでした。ネットにつながっているか確かめて、もう一度［入れる］を押してください`
          : 'ログインできませんでした。もう一度［ログイン］を押してください'
  return (
    <div className={`tool tool-${p.done == null ? 'running' : p.done === 0 ? 'ok' : 'failed'}`}>
      <div className="tool-head">
        <span className="tool-msg">{message}</span>
        <span className="tool-acts">
          <Button size="sm" onClick={() => setShowLog(!showLog)}>
            {showLog ? '畳む' : '詳しく見る'}
          </Button>
          <Button size="sm" onClick={p.onClose}>
            {p.done == null ? '止める' : '閉じる'}
          </Button>
        </span>
      </div>
      <div className={`tool-term${showLog ? '' : ' folded'}`} ref={box} />
    </div>
  )
}
