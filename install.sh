#!/bin/sh
# 古い入口（README や動画の概要欄に載っていた URL）。いまの入れ方は https://rising-loop.web.app/ の install.sh。
# リポジトリを非公開にするまでのつなぎ。中身は Firebase Hosting（リポジトリの site/install.sh）にある
set -eu
curl -fsSL https://rising-loop.web.app/install.sh | sh
