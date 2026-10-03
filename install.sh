#!/bin/sh
# ═══════════════════════════════════════════════════════════════
#  rising-loop インストーラ（スキル版 → アプリ版への案内）
#
#    curl -fsSL https://raw.githubusercontent.com/toru0325/rising-loop/main/install.sh | sh
#
#  ライジング・ループは 1.8.0 からデスクトップアプリ「Rising Loop」で使う形になった。
#  このスクリプトは、~/.claude/skills/rising-loop を「アプリ版へ案内するだけのスキル」（legacy/rising-loop）に置き換え、
#  アプリのダウンロード先を表示する。
#  やらないこと:
#    - 各プロジェクトの loops/ には触らない（アプリでフォルダを開けば、そのまま使える）
#    - バックアップは取らない（古い版は GitHub にある）
# ═══════════════════════════════════════════════════════════════
set -eu

REPO="toru0325/rising-loop"
BRANCH="main"
DEST="${HOME}/.claude/skills/rising-loop"
TGZ_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
APP_URL="https://github.com/${REPO}/releases/latest"

case "$(uname -s 2>/dev/null)" in
  Darwin|Linux) ;;
  *) printf 'このスクリプトは macOS 用です。アプリは %s からダウンロードしてください。\n' "$APP_URL" >&2; exit 1 ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || { printf '%s が見つかりません。入れてから再実行してください。\n' "$1" >&2; exit 1; }; }
need curl; need tar

guide() {
  cat <<GUIDE

── ライジング・ループはアプリ版に移りました ───────────
いまのループ（loops/）は、そのまま使えます。

1. アプリを入れる（Mac はターミナルでこの1行）:
     curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install-app.sh | sh
   ★ ブラウザで .dmg を落とすと「壊れているため開けません」になります（署名していないため）
   Windows は ${APP_URL} の .exe を落として開く
2. アプリの「フォルダを開く…」でループのあるフォルダを選ぶ
3. 「新しい形にする」と出たら押す。数字・施策・記録は消えず、控えも残ります

Claude Code のチャットで「Rising Loop を入れて」と言っても入れられます。
──────────────────────────────────────
GUIDE
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ★zip ではなく tar.gz。macOS の unzip は日本語ファイル名で壊れる
curl -fsSL "$TGZ_URL" -o "$TMP/repo.tgz"
tar -xzf "$TMP/repo.tgz" -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d -name 'rising-loop-*' | head -1)"
[ -n "$SRC" ] && [ -f "$SRC/legacy/rising-loop/SKILL.md" ] || { printf 'アーカイブの中身が想定と違います。\n' >&2; exit 1; }

NEW="$(cat "$SRC/legacy/rising-loop/VERSION" 2>/dev/null || printf '?')"
OLD="(未導入)"
if [ -d "$DEST" ] || [ -L "$DEST" ]; then
  OLD="$(cat "$DEST/VERSION" 2>/dev/null || printf '1.0.0 より前')"
fi

# 開発者のシンボリックリンクは壊さない
if [ -L "$DEST" ]; then
  printf '⚠ %s はシンボリックリンクです（開発環境）。置き換えずに終わります。\n' "$DEST"
  guide
  exit 0
fi

if [ "$OLD" != "$NEW" ]; then
  mkdir -p "$(dirname "$DEST")"
  # ★バックアップは取らない。同じ階層に残すと SKILL.md が拾われて別スキルとして登録される。古い版は GitHub にある
  rm -rf "$DEST"
  for b in "${DEST}".bak-*; do [ -d "$b" ] && rm -rf "$b"; done
  mv "$SRC/legacy/rising-loop" "$DEST"
  printf '✔ rising-loop を %s → %s にしました（アプリ版への案内だけをするスキルです）。\n' "$OLD" "$NEW"
else
  printf '✔ すでに %s です。\n' "$NEW"
fi
guide
