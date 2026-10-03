// 新しい版のアプリのお知らせ。新しい版を見つけたら1回だけ自動で開き、あとはタブの列の「新しい版」から開く。
// Mac は［アップデート］で、アプリが自分で新しい版を落として入れ替え、開き直す（ブラウザで落とすと、署名していないアプリは「壊れている」と言われて開けないため）。
// Windows は［ダウンロード］でインストーラーを落としてもらう
import { useState } from 'react'
import type { AppUpdate } from '@shared/types'
import { Button } from './Button'

export function UpdateDialog(p: { update: AppUpdate; appVersion: string; onLater: () => void; onDone: () => void }) {
  const mac = window.rla.controls === 'left'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = () => {
    setBusy(true)
    setError(null)
    void window.rla.installUpdate().then((r) => {
      setBusy(false)
      if (r.ok) p.onDone()
      else setError(r.message ?? 'うまくいきませんでした。')
    })
  }
  return (
    <div className="backdrop">
      <div className="dialog update" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h2 id="update-title">新しい版 v{p.update.version} があります</h2>
        <p className="sub">いまの版は v{p.appVersion} です。プロジェクトとループは、入れ替えてもそのまま使えます。</p>
        {p.update.notes && <div className="update-notes">{p.update.notes}</div>}
        {mac ? (
          <p>［アップデート］を押すと、新しい版を落として入れ替え、開き直します（1分ほど）。右のチャットの会話は、開き直したあとも続きから使えます。</p>
        ) : (
          <ol className="steps">
            <li>［ダウンロード］を押して、インストーラーを落とす</li>
            <li>このアプリを終了して、落としたインストーラーを開く</li>
            <li>
              「Windows によって PC が保護されました」と出たら、<b>「詳細情報」→「実行」</b>を押す
            </li>
          </ol>
        )}
        {error && <p className="update-error">{error}</p>}
        <div className="actions">
          <Button onClick={p.onLater} disabled={busy}>
            あとで
          </Button>
          <Button variant="primary" onClick={go} disabled={busy}>
            {busy ? '落としています…' : mac ? 'アップデート' : 'ダウンロード'}
          </Button>
        </div>
      </div>
    </div>
  )
}
