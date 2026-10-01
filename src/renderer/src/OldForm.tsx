// 古い形のプロジェクトの知らせ（最初のダイアログと、タブの下の帯）。
// ［新しい形にする］の中身（入れ替え・控え・元に戻す）は次の段階で作るので、いまは押せない。

export function OldFormDialog(p: { name: string; label: string; latest: string; onLater: () => void }) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="old-form-title">
        <h2 id="old-form-title">画面が前の版の形です</h2>
        <p>
        「{p.name}」の画面は {p.label} です。いまの版は {p.latest} です。
        </p>
        <p>古い形のままだと、AI の作業（更新・指示など）がうまく動かず、画面や数字が崩れることがあります。新しい形にしても、数字・施策・記録は変わりません。</p>
        <div className="actions">
          <button className="secondary" onClick={p.onLater}>
            あとで
          </button>
          <button className="primary" disabled>
            新しい形にする
          </button>
        </div>
      </div>
    </div>
  )
}

export function OldFormBar(p: { label: string }) {
  return (
    <div className="old-bar" role="status">
      <span>この画面は前の版の形です（{p.label}）。AI の作業がうまく動かないことがあります。</span>
      <button className="link" disabled>
        新しい形にする
      </button>
    </div>
  )
}
