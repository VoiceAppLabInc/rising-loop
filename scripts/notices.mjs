#!/usr/bin/env node
// アプリに入っている、ほかの人のソフトのライセンス表示（THIRD_PARTY_NOTICES.txt）を作る。
//   node scripts/notices.mjs
// 書くところ：resources/notices/THIRD_PARTY_NOTICES.txt（アプリに入れる。electron-builder の extraResources）と
//            site/third-party.txt（LP から見られるように）
// 対象：package.json の dependencies（とその下の依存）・Electron・同梱の Python。
// Chromium のライセンスは Electron がアプリの中に LICENSES.chromium.html として入れている
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const require = createRequire(join(root, 'package.json'))

/** パッケージのフォルダの LICENSE・LICENCE・COPYING を読む（無ければ null） */
function licenseText(dir) {
  if (!dir || !existsSync(dir)) return null
  const f = readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n))
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null
}

/** pnpm の一覧（本番の依存だけ）からパッケージのフォルダを探す */
function packages() {
  const json = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, encoding: 'utf8' }))
  const out = []
  for (const [license, list] of Object.entries(json)) {
    for (const p of list) {
      let dir = null
      // pnpm は node_modules/.pnpm/ を抜いた形でパスを出すことがあるので、両方を見る
      for (const cand of p.paths ?? []) {
        const inStore = cand.startsWith(root) ? join(root, 'node_modules', '.pnpm', cand.slice(root.length)) : cand
        if (existsSync(cand)) dir = cand
        else if (existsSync(inStore)) dir = inStore
      }
      if (!dir) {
        try {
          dir = dirname(require.resolve(`${p.name}/package.json`))
        } catch {
          dir = null
        }
      }
      out.push({ name: p.name, version: (p.versions ?? []).join(', '), license, homepage: p.homepage ?? '', text: licenseText(dir) })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const parts = []
const add = (title, license, homepage, text) => {
  parts.push(`${'='.repeat(72)}\n${title}\nライセンス：${license}${homepage ? `\n${homepage}` : ''}\n${'-'.repeat(72)}\n${text ?? '（ライセンス文はパッケージに含まれていません。上の URL を見てください）'}\n`)
}

const electronVersion = JSON.parse(readFileSync(join(dirname(require.resolve('electron/package.json')), 'package.json'), 'utf8')).version
add(`Electron ${electronVersion}`, 'MIT', 'https://github.com/electron/electron', licenseText(join(dirname(require.resolve('electron/package.json')), 'dist')) ?? licenseText(dirname(require.resolve('electron/package.json'))))
for (const p of packages()) add(`${p.name} ${p.version}`, p.license, p.homepage, p.text)

const py = join(root, 'vendor', 'python')
const pyLicense = existsSync(py)
  ? readdirSync(py)
      .map((d) => join(py, d, 'python', 'lib'))
      .flatMap((lib) => (existsSync(lib) ? readdirSync(lib).filter((n) => /^python3/.test(n)).map((n) => join(lib, n, 'LICENSE.txt')) : []))
      .find((f) => existsSync(f))
  : null
add('Python（同梱。python-build-standalone）', 'PSF License Version 2 ほか', 'https://www.python.org/', pyLicense ? readFileSync(pyLicense, 'utf8').trim() : null)

const head = `Rising Loop に入っている、ほかの人のソフトウェアのライセンス表示
（Rising Loop 本体の利用条件は https://rising-loop.web.app/terms.html を見てください）
Chromium のライセンスは、アプリの中の LICENSES.chromium.html にあります。

`
const body = head + parts.join('\n')
mkdirSync(join(root, 'resources', 'notices'), { recursive: true })
writeFileSync(join(root, 'resources', 'notices', 'THIRD_PARTY_NOTICES.txt'), body)
writeFileSync(join(root, 'site', 'third-party.txt'), body)
console.log(`書いた：${parts.length} 件（resources/notices/THIRD_PARTY_NOTICES.txt・site/third-party.txt）`)
