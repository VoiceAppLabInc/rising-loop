#!/usr/bin/env node
// 本物の claude / codex の代わり。受け取った引数・作業フォルダ・入力を出すだけ（画面の流れのテスト用）
// - 貼り付けの形（ESC[200~ … ESC[201~）の中の改行は ⏎ として1行に入れ、貼り付けの外の Enter で「受信:」を出す
// - RLA_FAKE_DELAY_MS があれば、その分だけ待ってから画面を出す（起動の遅い AI のかわり）
// - RLA_FAKE_DEAF_MS があれば、画面を出してからその分だけ、入力を捨てる（起動直後の claude のかわり）
// - 引数の -- のあとの文は、会話を始めるときに送られた文として「受信:」に出す
// 設定画面が調べる・動かすもの（版・ログインの状態・ログイン）と、codex の会話づくり（exec --json）には、すぐ答えて終わる
const a0 = process.argv.slice(2)
const loggedOut = process.env.RLA_FAKE_LOGGED_OUT === '1'
// RLA_FAKE_INSTALLED_FLAG があれば、そのファイルが無いあいだは「入口だけあって動かない」（nodenv の入口のかわり）。install で作る
const flag = process.env.RLA_FAKE_INSTALLED_FLAG
if (a0[0] === 'install') {
  if (flag) (await import('node:fs')).writeFileSync(flag, 'installed')
  process.stdout.write('INSTALL-OK ' + (a0[1] ?? '') + '\r\n')
  process.exit(0)
}
if (flag && !(await import('node:fs')).existsSync(flag)) {
  process.stderr.write('nodenv: codex: command not found\n')
  process.exit(127)
}
// RLA_FAKE_OLD=1 なら、アプリが使う機能（--plugin-dir・exec の --json）が無い古い版のふり
const old = process.env.RLA_FAKE_OLD === '1'
if (a0.join(' ') === '--help') {
  process.stdout.write(old ? '  --print\n' : '  --plugin-dir <path>  Load a plugin\n')
  process.exit(0)
}
if (a0.join(' ') === 'exec --help') {
  process.stdout.write(old ? '      --json\n' : '      --json\n      --skip-git-repo-check\n')
  process.exit(0)
}
if (a0[0] === '--version') {
  process.stdout.write('fake-ai 9.9.9\n')
  process.exit(0)
}
if (a0.join(' ') === 'auth status') {
  process.stdout.write(JSON.stringify({ loggedIn: !loggedOut }) + '\n')
  process.exit(0)
}
if (a0.join(' ') === 'login status') {
  process.stdout.write(loggedOut ? 'Not logged in\n' : 'Logged in using fake\n')
  process.exit(loggedOut ? 1 : 0)
}
if (a0.join(' ') === 'auth login' || a0.join(' ') === 'login') {
  process.stdout.write('LOGIN-FLOW-OK\r\n')
  process.exit(0)
}
if (a0.includes('exec') && a0.includes('--json')) {
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'fake-thread-1' }) + '\n')
  process.exit(0)
}
const delay = Number(process.env.RLA_FAKE_DELAY_MS || 0)
const deaf = Number(process.env.RLA_FAKE_DEAF_MS || 0)
const argv = process.argv.slice(2)
const startPrompt = argv.includes('--') ? argv[argv.indexOf('--') + 1] : null
setTimeout(() => {
  process.stdout.write('FAKE-AI ' + JSON.stringify({ argv, cwd: process.cwd(), claudecode: process.env.CLAUDECODE ?? null }) + '\r\n')
  if (startPrompt != null) process.stdout.write('受信: ' + startPrompt.replace(/\r?\n/g, '⏎') + '\r\n')
  const deafUntil = Date.now() + deaf
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  let line = ''
  let pasting = false
  let rest = ''
  process.stdin.on('data', (b) => {
    if (Date.now() < deafUntil) return
    rest += b.toString('utf8')
    while (rest) {
      if (rest.startsWith('\x1b[200~')) { pasting = true; rest = rest.slice(6); continue }
      if (rest.startsWith('\x1b[201~')) { pasting = false; rest = rest.slice(6); continue }
      if (rest.startsWith('\x1b') && rest.length < 6) return // 続きを待つ
      const ch = rest[0]
      rest = rest.slice(1)
      if (ch === '\r' && pasting) { line += '⏎'; continue }
      if (ch === '\r') {
        process.stdout.write('\r\n受信: ' + line + '\r\n')
        if (line === 'exit') process.exit(0)
        line = ''
        continue
      }
      line += ch
      process.stdout.write(ch)
    }
  })
}, delay)
