// ほかの場所に入っている rising-loop。アプリは同梱のスキルを使うので、ゴミ箱に入れるか聞く（［残す］なら次からは聞かない）
import { Button } from './Button'
export function OldSkillsDialog(p: { dirs: string[]; busy: boolean; onTrash: () => void; onKeep: () => void }) {
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="old-skills-title">
        <h2 id="old-skills-title">ほかの場所に rising-loop が入っています</h2>
        <p>アプリでは同梱のバージョンを使います。ゴミ箱に入れますか？</p>
        <ul className="paths">
          {p.dirs.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="sub">ゴミ箱に入れると、ターミナルでは rising-loop を使えなくなります。ゴミ箱から「戻す」で元に戻せます。</p>
        <div className="actions">
          <Button onClick={p.onKeep} disabled={p.busy}>
            残す
          </Button>
          <Button variant="primary" onClick={p.onTrash} disabled={p.busy}>
            ゴミ箱に入れる
          </Button>
        </div>
      </div>
    </div>
  )
}
