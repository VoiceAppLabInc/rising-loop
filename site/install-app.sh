#!/bin/sh
# ═══════════════════════════════════════════════════════════════
#  Rising Loop（ライジング・ループのアプリ）を入れる・入れ替える（Mac）
#
#    curl -fsSL https://rising-loop.web.app/install-app.sh | sh
#
#  配る場所（Cloud Storage の rising-loop-dist）の latest.json から最新の .dmg を探して落とし、「アプリケーション」の Rising Loop と入れ替えて開く。
#  ★この置き場所は Firebase Hosting（リポジトリの site/）。リポジトリの根の install-app.sh は、ここを呼ぶだけの古い入口
#  ★ブラウザで落とすと「ダウンロードしたもの」の印が付き、署名していないアプリは「壊れているため開けません」になる。
#    ターミナル（curl）で落とせば印が付かないので、そのまま開ける。2回目からの更新はアプリが自分で入れ替える
#  やらないこと：プロジェクトのフォルダ（loops/）やアプリのデータには触らない
#  RISING_LOOP_INSTALL_DIR で入れる場所を変えられる（既定は /Applications。書けなければ ~/Applications）。RISING_LOOP_NO_OPEN=1 なら最後に開かない
# ═══════════════════════════════════════════════════════════════
set -eu

PAGE="https://rising-loop.web.app/"
LATEST="https://storage.googleapis.com/rising-loop-dist/latest.json"
WIN_URL="https://storage.googleapis.com/rising-loop-dist/latest/Rising-Loop-win-x64.exe"
APP="Rising Loop.app"

case "$(uname -s 2>/dev/null)" in
  Darwin) ;;
  *) printf 'これは Mac 用です。Windows は %s を落として入れてください（入れ方は %s）。\n' "$WIN_URL" "$PAGE" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) printf 'この Mac の CPU（%s）向けの版はありません。\n' "$(uname -m)" >&2; exit 1 ;;
esac

DEST="${RISING_LOOP_INSTALL_DIR:-/Applications}"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

printf '⬇  最新版を探しています…\n'
# latest.json の "mac-arm64": "https://…dmg" を拾う（python が無い Mac もあるので grep と sed で）
URL="$(curl -fsSL "$LATEST" | grep -o "\"mac-${ARCH}\": *\"[^\"]*\"" | sed 's/.*: *"\(.*\)"/\1/' | head -1)"
[ -n "$URL" ] || { printf '最新版のファイルが見つかりませんでした。少し時間をおいて、もう一度この1行を実行してください（入れ方は %s）。\n' "$PAGE" >&2; exit 1; }

TMP="$(mktemp -d)"
MNT="$TMP/mnt"
cleanup() { hdiutil detach -quiet "$MNT" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

printf '⬇  %s を落としています…\n' "$(basename "$URL")"
curl -fL --progress-bar "$URL" -o "$TMP/app.dmg"
mkdir -p "$MNT"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$TMP/app.dmg" >/dev/null

# 動いていれば終わってもらう（入れ替えたあとで開き直す）
if pgrep -xq "Rising Loop"; then
  printf '   動いている Rising Loop を終了します…\n'
  osascript -e 'quit app "Rising Loop"' >/dev/null 2>&1 || true
  i=0
  while pgrep -xq "Rising Loop"; do
    i=$((i+1)); [ "$i" -gt 30 ] && { printf 'Rising Loop が終わりませんでした。終了してから、もう一度実行してください。\n' >&2; exit 1; }
    sleep 1
  done
fi

rm -rf "$DEST/$APP.new"
ditto "$MNT/$APP" "$DEST/$APP.new"
rm -rf "$DEST/$APP"
mv "$DEST/$APP.new" "$DEST/$APP"
# 日時を今にして登録し直す（同じ場所で入れ替えても、Mac は古いアイコンを覚えたままのため）
touch "$DEST/$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/$APP" >/dev/null 2>&1 || true
# 前にブラウザで落として入れていた場合の印も外す
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

VER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/$APP/Contents/Info.plist" 2>/dev/null || printf '?')"
printf '✔ Rising Loop %s を %s に入れました。\n' "$VER" "$DEST"
if [ "${RISING_LOOP_NO_OPEN:-}" != 1 ]; then
  open "$DEST/$APP"
  printf '   開きました。次からの更新は、アプリのお知らせの［アップデート］でできます。\n'
fi
