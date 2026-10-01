#!/usr/bin/env node
// 本物の claude / codex の代わり。受け取った引数・作業フォルダ・入力を出すだけ（画面の流れのテスト用）
// - 貼り付けの形（ESC[200~ … ESC[201~）の中の改行は ⏎ として1行に入れ、貼り付けの外の Enter で「受信:」を出す
// - RLA_FAKE_DELAY_MS があれば、その分だけ待ってから画面を出す（起動の遅い AI のかわり）
// - RLA_FAKE_DEAF_MS があれば、画面を出してからその分だけ、入力を捨てる（起動直後の claude のかわり）
// - 引数の -- のあとの文は、会話を始めるときに送られた文として「受信:」に出す
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
