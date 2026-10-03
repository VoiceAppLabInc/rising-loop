// 新しい版のアプリのお知らせ。自動では入れ替えない（署名していないので、使う人がダウンロードして入れ替える）。
// 新しい版を見つけたら1回だけ自動で開き、あとはタブの列の「新しい版」から開く
import type { AppUpdate } from '@shared/types'
import { Button } from './Button'

export function UpdateDialog(p: { update: AppUpdate; appVersion: string; onLater: () => void; onDownload: () => void }) {
  const mac = window.rla.controls === 'left'
  return (
    <div className="backdrop">
      <div className="dialog update" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h2 id="update-title">新しい版 v{p.update.version} があります</h2>
        <p className="sub">いまの版は v{p.appVersion} です。プロジェクトとループは、入れ替えてもそのまま使えます。</p>
        {p.update.notes && <div className="update-notes">{p.update.notes}</div>}
        <ol className="steps">
          <li>［ダウンロード］を押して、{mac ? '.dmg のファイル' : 'インストーラー'}を落とす</li>
          {mac ? (
            <>
              <li>このアプリを終了して、落とした .dmg を開き、Rising Loop を「アプリケーション」に入れる（置き換える）</li>
              <li>
                開くときに「開発元を確認できない」と出たら、<b>システム設定 → プライバシーとセキュリティ</b>のいちばん下にある<b>「このまま開く」</b>を押す
              </li>
            </>
          ) : (
            <>
              <li>このアプリを終了して、落としたインストーラーを開く</li>
              <li>
                「Windows によって PC が保護されました」と出たら、<b>「詳細情報」→「実行」</b>を押す
              </li>
            </>
          )}
        </ol>
        <div className="actions">
          <Button onClick={p.onLater}>あとで</Button>
          <Button variant="primary" onClick={p.onDownload}>
            ダウンロード
          </Button>
        </div>
      </div>
    </div>
  )
}
