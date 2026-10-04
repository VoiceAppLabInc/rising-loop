---
name: rising-loop
description: "ライジング・ループ（rising-loop）は、デスクトップアプリ「Rising Loop」に移りました。ユーザーが /rising-loop と打ったとき、「rising-loop」「ライジング・ループ」「loop-manager」「ループを回して」と言ったとき、または loops/index.html のあるフォルダでループの話が出たときに使い、アプリ版への移り方を案内する。"
user-invokable: true
---

# rising-loop はアプリ版に移りました（1.8.3）

ライジング・ループは、1.8.0 から **デスクトップアプリ「Rising Loop」** で使う形になりました。
ターミナルの Claude Code / Codex で使うスキル版（1.7.5 まで）は、これ以上は新しくなりません。

## やること

0. **Rising Loop の中で動いているときは、このスキルは使わない。** 同梱の rising-loop（`rising-loop:rising-loop`）に従う。
   見分け方: 同梱の rising-loop スキルが読み込まれている、または `echo $RISING_LOOP_APP` が `1`
1. **`loops/` には何もしない。** 画面の枠の入れ替え（`shell-update.py`）・移行・数字の更新は、このスキルではやらない。
   このスキルには、それをやるための台本も部品も入っていない（アプリに入っている）
2. ユーザーに、次の文を**そのまま**見せる（言い換えない・足さない）:

   > ライジング・ループは、デスクトップアプリ「Rising Loop」に移りました。
   > いまのループ（`loops/`）は、そのまま使えます。
   >
   > アプリを入れますか？（Mac なら、いまここで入れられます。1分ほどかかります）

3. いまのフォルダのパスを1行添える（アプリで選ぶフォルダ）
4. **「入れて」「はい」と言われたら**:
   - Mac（`uname -s` が `Darwin`）なら、次の1行を実行する。出力の最後の「✔ Rising Loop … を … に入れました」だけを伝える
     ```bash
     curl -fsSL https://raw.githubusercontent.com/toru0325/rising-loop/main/install-app.sh | sh
     ```
     ★ ブラウザで .dmg を落とすと「壊れているため開けません」になる（署名していないため）。**ブラウザでのダウンロードを勧めない**
   - Windows なら、https://github.com/toru0325/rising-loop/releases/latest/download/Rising-Loop-win-x64.exe を落として開いてもらう（入れ方は https://github.com/toru0325/rising-loop）
     （「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」）
   - 入ったら、続けてこれを**そのまま**見せる:
     > アプリが開いたら「フォルダを開く…」でこのフォルダを選び、「HTMLを最新版にする」と出たら押してください。
     > 数字・施策・記録は消えず、控えも残ります。
5. ほかに頼まれたこと（数字の話・施策の相談など）は、普段の Claude Code / Codex として手伝ってよい。
   ただし `loops/` の HTML の作り直し・移行はしない（アプリでやると伝える）

## 古い「⬆ アップデート」から来たとき

画面の「⬆ アップデート」（`task: rising-loop を最新版に更新して、このループを合わせて`）や、
「rising-loop が X.Y.Z になったので、このループを合わせて」から来たときも、上の 2〜4 だけをやる。
`install.sh` はもう実行し終わっている（だからこの版になっている）。**枠の入れ替えはしない。**
