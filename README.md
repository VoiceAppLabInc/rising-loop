# Rising Loop（ライジング・ループ）

ひとつの指標を計測し、その数字を上げるための施策を AI と一緒に回し続けるデスクトップアプリです。
ループの画面と、Claude Code / Codex のチャットを1つのウィンドウにまとめています。

**▶ 解説動画**: https://youtu.be/3b6so58MULM

## 入れ方

### Mac

ターミナル（「アプリケーション」→「ユーティリティ」→「ターミナル」）でこの1行。初回も入れ直しも同じです。

```
curl -fsSL https://raw.githubusercontent.com/toru0325/rising-loop/main/install-app.sh | sh
```

- その Mac に合った版（Apple シリコン／Intel）を落とし、「アプリケーション」に入れて開きます
- ★ **ブラウザで .dmg を落とさないでください。** 署名していないため「壊れているため開けません」と出て開けません
  （ブラウザで落としてしまったときは、「アプリケーション」に入れたあとターミナルで `xattr -dr com.apple.quarantine "/Applications/Rising Loop.app"`）
- Claude Code を使っている人は、チャットで「Rising Loop を入れて」と頼んでも入れられます（スキル版の案内のスキルがあるとき）

### Windows

**[Windows 用のインストーラーを落とす（Rising-Loop-win-x64.exe）](https://github.com/toru0325/rising-loop/releases/latest/download/Rising-Loop-win-x64.exe)** を押して落とし、開きます。
「Windows によって PC が保護されました」と出たら、**「詳細情報」→「実行」**を押してください。

### 新しい版

新しい版が出ると、アプリが起動したときにお知らせを出します（タブの列の「新しい版」からも開けます）。
- **Mac**: ［アップデート］を押すと、アプリが新しい版を落として入れ替え、開き直します
- **Windows**: ［ダウンロード］でインストーラーを落として、上と同じように入れます

プロジェクトとループは、入れ替えてもそのまま使えます。

## 使い始め

1. アプリを開くと、最初に **AI を使えるようにする** 画面が出ます。Claude Code か Codex のどちらか1つを［入れる］→［ログイン］
   （どちらもアプリの中から公式の手順を動かします。Node などを先に入れておく必要はありません）
2. **フォルダを開く…** で、このサービス専用のフォルダを選ぶ（企画書や仕様があれば入れておくと、AI が読みます）
3. ループがまだ無ければ、右のチャットで AI と目標（動かしたい数字）を決めるところから始まります。
   AI がループの画面（`loops/index.html`）を作り、以後はその画面が入口になります

数字取りのスクリプト用の Python もアプリに入っています（Mac・Windows に python3 が無いときだけ使います）。

## 効果を上げるコツ

数字が自動で取れる口を、できるだけ多く AI につなぐこと。GA4・Search Console・Stripe・Shopify・広告管理画面・自社 DB・Google Sheets などの API や MCP をつなぐほど、AI が自分で数字を取りに行けるようになり、更新が速く、評価が正確になります。つなぐ口が無い場合は、都度 CSV を渡したり、Claude Code にブラウザを操作させて数字を取るのもおすすめです。

## スキル版（1.x）を使っていた人へ

ターミナルの Claude Code で `/rising-loop` を使うスキル版は、1.7.5 で終わりました。いまのループはアプリでそのまま使えます。

1. 上の「入れ方」でアプリを入れる
2. **フォルダを開く…** で、ループのあるフォルダを選ぶ
3. 「HTMLを最新版にする」と出たら押す。数字・施策・記録は消えず、控えも残ります（［元に戻す］もできます）

スキル版の「⬆ アップデート」や `install.sh` を実行すると、`~/.claude/skills/rising-loop` は「アプリ版へ案内するだけのスキル」（1.8.1）に置き換わります。このスキルに「入れて」と言えば、アプリを入れてくれます。
アプリは自分の中のスキルを使うので、`~/.claude/skills` の rising-loop は要りません（アプリが見つけたら、ゴミ箱に入れるか聞きます）。

## 開発

```sh
pnpm install                 # node-pty を Electron 用に作り直す
node scripts/fetch-python.mjs # 同梱の Python を vendor/ に落とす（開発中も使う）
pnpm dev                     # 開発中のアプリを開く
pnpm typecheck && pnpm test && pnpm test:e2e
```

- アプリ: `src/`（Electron + React）。同梱のスキル: `skill/skills/rising-loop/`（版の上げ方は `skill/README.md`）
- 手元で配る形を作る: `pnpm dist:mac`（`dist/` に .dmg）
- **リリース**: `package.json` の `version` を上げてコミット → `git tag v<版> && git push origin v<版>`。
  GitHub Actions（`.github/workflows/release.yml`）が Mac・Windows の配る形を作り、Releases に**下書き**で置く。
  下書きの説明（アプリのお知らせに出る）を書いて「公開」すると、使っている人のアプリにお知らせが出る

## ライセンス

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.ja)（表示・非営利）。© Voice App Lab
個人・社内での利用、改変、再配布は自由です。**商用利用（販売・有償サービスへの組み込み）は不可**。利用の際は「Voice App Lab / rising-loop」のクレジットを残してください。
