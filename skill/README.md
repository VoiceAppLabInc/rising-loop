# 同梱する rising-loop スキル

Rising Loop が claude（`--plugin-dir`）と codex（起動時の指示）に読ませるスキル。
**正はここ**（2.0.0 から、スキルはアプリと一緒にだけ配る。`~/.claude/skills` には入れない）。
版を上げるときは `skills/rising-loop/VERSION` と `.claude-plugin/plugin.json` の version をそろえ、台帳 `migrations.json`・`CHANGELOG.md`・見本 `tests/fixtures/versions/<版>` を足す。

1.x（`~/.claude/skills/rising-loop` に入れるスキル版）は 1.7.5 で終わり。いま `install.sh` が入れるのは、アプリ版へ案内するだけの `legacy/rising-loop`（1.8.0）。
