// ほかの場所に入っている rising-loop。アプリは同梱のスキルを使うので、ゴミ箱に入れるか聞く（［残す］なら次からは聞かない）。
// 1.8.0 より前のスキル版が1つでもあれば、アプリの中の AI が古い手順で動いてしまうので、聞かずに［OK］だけでゴミ箱に入れる
import type { FoundSkill } from '@shared/types'
import { Button } from './Button'
export function OldSkillsDialog(p: { found: FoundSkill[]; busy: boolean; onTrash: () => void; onKeep: () => void }) {
  const mustTrash = p.found.some((f) => f.old)
  return (
    <div className="backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="old-skills-title">
        <h2 id="old-skills-title">{mustTrash ? '古い rising-loop が入っています' : 'ほかの場所に rising-loop が入っています'}</h2>
        {mustTrash ? (
          <p>このままだと、アプリの中の AI が古い手順で動いてしまうので、ゴミ箱に入れます。</p>
        ) : (
          <p>アプリでは同梱のバージョンを使います。ゴミ箱に入れますか？</p>
        )}
        <ul className="paths">
          {p.found.map((f) => (
            <li key={f.dir}>{f.dir}</li>
          ))}
        </ul>
        <p className="sub">
          {mustTrash
            ? 'ゴミ箱から「戻す」で元に戻せます。'
            : 'ゴミ箱に入れると、ターミナルでは rising-loop を使えなくなります。ゴミ箱から「戻す」で元に戻せます。'}
        </p>
        <div className="actions">
          {mustTrash ? (
            <Button variant="primary" onClick={p.onTrash} disabled={p.busy}>
              OK
            </Button>
          ) : (
            <>
              <Button onClick={p.onKeep} disabled={p.busy}>
                残す
              </Button>
              <Button variant="primary" onClick={p.onTrash} disabled={p.busy}>
                ゴミ箱に入れる
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
