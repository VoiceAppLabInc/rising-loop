// この画面の使い方。2.1.0 でスキルの殻からアプリのタブの列に移した（中身はスキルの使い方の窓のまま）
import fig from './assets/howto-fig.svg?raw'
import mark from './assets/mark.png'
import { Button } from './Button'

export function Howto(p: { skillVersion: string; appVersion: string; onClose: () => void }) {
  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="dialog howto" role="dialog" aria-modal="true" aria-labelledby="howto-title">
        {/* 左にアイコン（竜巻だけ）とロゴとバージョン、右に見出し */}
        <header className="howto-head">
          <span className="brand">
            <img className="brand-mark" src={mark} alt="" />
            <span className="brand-text">
              <b>RISING LOOP</b>
              <i>
                スキル v{p.skillVersion} · アプリ v{p.appVersion} · Created by Voice App Lab
              </i>
            </span>
          </span>
          <h2 id="howto-title">ライジング・ループの使い方</h2>
        </header>
        <p className="lede">ライジング・ループは、ひとつの指標を計測し、その数字を上げるためのあらゆる施策を AI と共に進めるループシステムです。</p>
        <div className="howto-cols">
          <div className="howto-fig" dangerouslySetInnerHTML={{ __html: fig }} />
          <div>
            <ol className="steps">
              <li>
                <b>施策を始めるには</b>、やりたい施策の<b>［↓ 実行へ移動］</b>を押して送る。実装が全部 ✅ になったら、その施策の
                <b>［↓ 評価へ移動］</b>を押して送る
              </li>
              <li>
                <b>ボタンはぜんぶ、押すと指示文が右のチャットに送られます。</b>カスタマイズ・更新・AIに指示、どれも AI がそれを読んで動きます
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
          <Button variant="primary" onClick={p.onClose}>
            OK
          </Button>
        </div>
      </div>
    </div>
  )
}
