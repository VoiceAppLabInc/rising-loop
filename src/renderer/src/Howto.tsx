// この画面の使い方。2.1.0 でスキルの殻からアプリのタブの列に移した（中身はスキルの使い方の窓のまま）
import fig from './assets/howto-fig.svg?raw'
import { Button } from './Button'

export function Howto(p: { skillVersion: string; appVersion: string; onClose: () => void }) {
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="dialog howto" role="dialog" aria-modal="true" aria-labelledby="howto-title">
        <header className="howto-head">
          <h2 id="howto-title">ライジング・ループの使い方</h2>
          <span className="brand">
            <b>RISING LOOP</b>
            <i>
              スキル v{p.skillVersion} · アプリ v{p.appVersion} · Created by Voice App Lab
            </i>
          </span>
        </header>
        <p className="lede">ライジング・ループは、ひとつの指標を計測し、その数字を上げるためのあらゆる施策を AI と共に進めるループシステムです。</p>
        <p className="lede">
          この画面は<b>見るだけ</b>です。ボタンを押すと<b>指示文が右のチャットに送られ</b>、AI が動いてこの画面を書き換えます。
        </p>
        <div className="howto-cols">
          <div className="howto-fig" dangerouslySetInnerHTML={{ __html: fig }} />
          <div>
            <ol className="steps">
              <li>
                <b>施策を始めるには</b>、やりたい施策の「📋 指示する」を押して<b>「TRIAL に移す」</b>を選んで送る。実装が全部 ✅ になったら、同じ「指示する」から
                <b>「完了にして（評価に移す）」</b>
              </li>
              <li>
                <b>ボタンはぜんぶ、押すと指示文が右のチャットに送られます。</b>コメント・更新・指示、どれも AI がそれを読んで動きます
              </li>
              <li>
                <b>ループの期間を決めて</b>（1日1回、週1回、など）、都度「更新」を押して AI に指示。全体のステータスが更新されるので、次の施策に進みます
              </li>
            </ol>
            <div className="free">
              <b>右のチャットはただの Claude Code（Codex）です。普段どおりに使いましょう</b>
              <ul>
                <li>（スクショを貼って）「ここをグラフにして」「この説明は短く」「GOAL の下にメモを入れて」</li>
                <li>「施策案が弱い。別案で5案だして」「プランを別の md にまとめてから実装して」</li>
                <li>「GA4 の API から数字取って」「Google Drive に保存して」</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="actions">
          <span className="note">上の「? 使い方」でいつでも開けます</span>
          <Button variant="primary" onClick={p.onClose}>
            わかった
          </Button>
        </div>
      </div>
    </div>
  )
}
