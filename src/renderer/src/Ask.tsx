// コメント・指示の入力の窓（2.3.0 からの殻が window.rlaApp.ask で頼む）。
// 何を聞くか（キッカー・タイトル・説明・札）は殻が決める。指示文の組み立ても殻がやるので、ここは入力された文を返すだけ
import { useEffect, useRef, useState } from 'react'
import type { AskRequest } from '@shared/types'
import { Button } from './Button'

export function AskDialog(p: { req: AskRequest; onAnswer: (value: string | null) => void }) {
  const [value, setValue] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  // 背景で押して背景で離したときだけ閉じる（入力欄で押して背景で離すドラッグでは閉じない）
  const downOnBackdrop = useRef(false)
  const ok = value.trim().length > 0
  const submit = () => {
    if (ok) p.onAnswer(value.trim())
    else input.current?.focus()
  }

  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onAnswer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="backdrop"
      onPointerDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) p.onAnswer(null)
        downOnBackdrop.current = false
      }}
    >
      <div className="dialog ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        {p.req.kick && <div className="ask-kick">{p.req.kick}</div>}
        <h2 id="ask-title">{p.req.title}</h2>
        {p.req.sub && <p className="ask-sub">{p.req.sub}</p>}
        <textarea
          ref={input}
          className="ask-input"
          aria-label="入力"
          placeholder={p.req.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
          }}
        />
        {p.req.chips.length > 0 && (
          // 定型の札。押すと入力欄に入るだけで、送らない
          <div className="ask-chips">
            {p.req.chips.map(([label, text], i) => (
              <Button
                key={i}
                size="sm"
                onClick={() => {
                  setValue(text)
                  input.current?.focus()
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        <div className="actions">
          <span className="sub ask-hint">⌘/Ctrl + Enter でも送れます</span>
          <Button onClick={() => p.onAnswer(null)}>キャンセル</Button>
          <Button variant="primary" disabled={!ok} onClick={submit}>
            送る
          </Button>
        </div>
      </div>
    </div>
  )
}
