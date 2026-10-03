// ほかの場所に入っている rising-loop。アプリは同梱のスキルを使うので、版に関係なく［OK］だけでゴミ箱に入れる
// （残しておくと、アプリの中のチャットで古い手順が動くおそれがある。ユーザーの判断で［残す］は出さない）
import { Button } from './Button'
export function OldSkillsDialog(p: { dirs: string[]; busy: boolean; onTrash: () => void }) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="old-skills-title">
        <h2 id="old-skills-title">ほかの場所に rising-loop が入っています</h2>
        <p>このままだと、アプリの中の AI が古い手順で動いてしまうので、ゴミ箱に入れます。</p>
        <ul className="paths">
          {p.dirs.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="sub">アプリでは同梱のバージョンを使います。ゴミ箱から「戻す」で元に戻せます。</p>
        <div className="actions">
          <Button variant="primary" onClick={p.onTrash} disabled={p.busy}>
            OK
          </Button>
        </div>
      </div>
    </div>
  )
}
