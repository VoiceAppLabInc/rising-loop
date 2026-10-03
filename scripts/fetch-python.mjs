// アプリに同梱する Python を落とす（python-build-standalone）。スキルの数字取りのスクリプト（loops/update/*.py など）は python3 で動くが、
// Mac は Xcode のコマンドラインツールが無いと python3 が無く、Windows にも無い。そういう人のために、単体で動く Python をアプリに入れる。
//
//   node scripts/fetch-python.mjs                 いまの OS・CPU の分だけ
//   node scripts/fetch-python.mjs mac-arm64 mac-x64 win-x64
//
// vendor/python/<os>-<arch>/python/ に置く（electron-builder が extraResources で Resources/python に入れる）。版は固定する（配る中身をそろえるため）
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RELEASE = '20261001'
const PYTHON = '3.12.15'
const TRIPLES = { 'mac-arm64': 'aarch64-apple-darwin', 'mac-x64': 'x86_64-apple-darwin', 'win-x64': 'x86_64-pc-windows-msvc' }

const here = () => `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [here()]
const root = resolve('vendor', 'python')

for (const t of targets) {
  const triple = TRIPLES[t]
  if (!triple) throw new Error(`知らない組み合わせです: ${t}（${Object.keys(TRIPLES).join(' / ')}）`)
  const dir = join(root, t)
  const mark = join(dir, 'python', '.rla-version')
  if (existsSync(mark) && readFileSync(mark, 'utf8') === `${PYTHON}+${RELEASE}`) {
    console.log(`${t}: もうあります（${PYTHON}）`)
    continue
  }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const name = `cpython-${PYTHON}+${RELEASE}-${triple}-install_only_stripped.tar.gz`
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${encodeURIComponent(name)}`
  console.log(`${t}: ${name} を落としています…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`落とせませんでした（${res.status}）: ${url}`)
  const tgz = join(dir, 'python.tar.gz')
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', tgz, '-C', dir])
  rmSync(tgz)
  // Windows の install_only には python.exe しか無い。スキルは python3 で呼ぶので、同じものを python3.exe としても置く
  if (t.startsWith('win')) copyFileSync(join(dir, 'python', 'python.exe'), join(dir, 'python', 'python3.exe'))
  writeFileSync(join(dir, 'python', '.rla-version'), `${PYTHON}+${RELEASE}`)
  console.log(`${t}: ${join(dir, 'python')} に置きました`)
}
