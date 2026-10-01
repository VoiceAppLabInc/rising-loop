import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectForm } from '../../src/shared/loopsForm'
import { isInstruction } from '../../src/shared/intercept'
import { changelogSummary, planMigration, readTemplates, reworkInstruction, stageOf, type LoopsFiles } from '../../src/shared/migrate'

const SKILL = resolve('skill/skills/rising-loop')
const SHELL_UPDATE = join(SKILL, 'assets', 'shell-update.py')
const tpl = readTemplates((rel) => readFileSync(join(SKILL, rel), 'utf8'))

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 見本の loops/ を一時フォルダに写す。mutate で独自の部品などを足せる */
function copyOf(fixture: string, mutate?: (loops: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'rla-migrate-unit-'))
  dirs.push(root)
  cpSync(resolve('tests/fixtures', fixture, 'loops'), join(root, 'loops'), { recursive: true })
  mutate?.(join(root, 'loops'))
  return join(root, 'loops')
}

function filesOf(loops: string): LoopsFiles {
  const read = (n: string) => {
    try {
      return readFileSync(join(loops, n), 'utf8')
    } catch {
      return null
    }
  }
  return {
    indexHtml: read('index.html')!,
    pages: readdirSync(loops)
      .filter((n) => /^L.*\.html$/.test(n))
      .sort()
      .map((name) => ({ name, html: read(name)! })),
    projectCss: read('project.css')
  }
}

/** Python 版を本当に流し、書いたファイルと出力を返す */
function runPython(loops: string) {
  const out = execFileSync('python3', [SHELL_UPDATE, loops], { encoding: 'utf8' })
  const lost = out
    .split('\n')
    .filter((l) => /^ {6}(id="|独自の <script>)/.test(l))
    .map((l) => l.trim())
  const oldPages = new Set<string>()
  for (const l of out.split('\n')) {
    const m = /^ {2}○ .*頁: (.+)$/.exec(l)
    if (m) m[1].split(' ').forEach((n) => oldPages.add(n))
    const s = /^ {2}○ (L[^:]+\.html): 構造が古い/.exec(l)
    if (s) oldPages.add(s[1])
  }
  return {
    index: readFileSync(join(loops, 'index.html'), 'utf8'),
    css: readFileSync(join(loops, 'rising.css'), 'utf8'),
    js: readFileSync(join(loops, 'rising.js'), 'utf8'),
    common: readFileSync(join(loops, 'update', 'common.py'), 'utf8'),
    lost,
    oldPages: [...oldPages].sort(),
    listOld: out.includes('一覧の行が古い形')
  }
}

describe('planMigration は shell-update.py と同じ結果になる', () => {
  const addOwnParts = (loops: string) => {
    const p = join(loops, 'index.html')
    const html = readFileSync(p, 'utf8')
      .replace('</body>', '<div id="my-own-panel">独自</div>\n<script>window.myOwn = 1</script>\n</body>')
    writeFileSync(p, html)
  }

  for (const fixture of ['versions/1.6.1', 'versions/1.7.5', 'sample-project']) {
    it(fixture, () => {
      const loops = copyOf(fixture, addOwnParts)
      const plan = planMigration(filesOf(loops), tpl)
      if ('error' in plan) throw new Error(plan.error)
      const py = runPython(loops)
      expect(plan.newIndex).toBe(py.index)
      expect(plan.common).toEqual([
        { path: 'rising.css', content: py.css },
        { path: 'rising.js', content: py.js },
        { path: 'update/common.py', content: py.common }
      ])
      expect(plan.lost).toEqual(py.lost)
    })
  }
})

describe('planMigration', () => {
  it('独自の部品と、その見つけ方（id・script）を返す', () => {
    const loops = copyOf('versions/1.7.5', (l) => {
      const p = join(l, 'index.html')
      writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', '<div id="my-own-panel"></div></body>'))
    })
    const plan = planMigration(filesOf(loops), tpl)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.lost).toContain('id="my-own-panel"')
    // 2.0.0 で雛形から消した部品は、移し直させないので出さない
    expect(plan.lost.some((x) => /cc-ask|cc-help|rl-update|toast/.test(x))).toBe(false)
  })

  it('新しい殻は、いまの雛形の版になり、CONST と LOOPS を引き継ぐ', () => {
    const files = filesOf(copyOf('versions/1.7.5'))
    const plan = planMigration(files, tpl)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.newIndex).toContain(`<span class="ver">v${tpl.version}</span>`)
    const between = (h: string, name: string) => h.slice(h.indexOf(`<!-- ${name}:BEGIN -->`), h.indexOf(`<!-- ${name}:END -->`))
    expect(between(plan.newIndex, 'CONST').trim()).toBe(between(files.indexHtml, 'CONST').trim())
    expect(between(plan.newIndex, 'LOOPS').trim()).toBe(between(files.indexHtml, 'LOOPS').trim())
  })

  it('CONST の印が無い殻（1.2.x）は扱わない', () => {
    const plan = planMigration(filesOf(copyOf('versions/1.2.8')), tpl)
    expect(plan).toEqual({ error: 'no-markers' })
  })
})

describe('stageOf（版で判定する。頁の書き方は見ない）', () => {
  const stage = (loops: string, version = tpl.version) => {
    const f = filesOf(loops)
    return stageOf(detectForm({ indexHtml: f.indexHtml, pages: f.pages.map((p) => p.html) }), version)
  }
  const withVer = (fixture: string, ver: string) =>
    copyOf(fixture, (l) => {
      const p = join(l, 'index.html')
      writeFileSync(p, readFileSync(p, 'utf8').replace(/<span class="ver">[^<]*<\/span>/, `<span class="ver">${ver}</span>`))
    })

  it('1.5 より前の形は、アプリでは新しい形にできない', () => {
    expect(stage(copyOf('versions/1.4.0'))).toBe('unsupported')
    expect(stage(copyOf('versions/1.2.8'))).toBe('unsupported')
  })

  it('アプリ以前（1.5〜1.7）の形は古い。版の表示は見ない', () => {
    expect(stage(copyOf('versions/1.7.5'))).toBe('old')
    expect(stage(withVer('versions/1.7.5', 'v2.0.0'))).toBe('old')
  })

  it('2.0 以降は、殻の版と同梱のスキルの版を比べる', () => {
    expect(stage(copyOf('versions/2.0.0'), '2.0.0')).toBe('current')
    expect(stage(copyOf('versions/2.0.0'), '2.0.1')).toBe('old')
    expect(stage(copyOf('versions/2.0.0'), '2.1.0')).toBe('old')
  })

  it('殻の版のほうが新しければ、何も変えない（別の PC で新しいアプリが合わせたなど）', () => {
    expect(stage(withVer('versions/2.0.0', 'v2.1.0'), '2.0.0')).toBe('current')
  })

  it('2.0 以降の形で版の表示が無い（v0.0.0）ものは古いとする（入れ替えで版が入る）', () => {
    expect(stage(withVer('versions/2.0.0', 'v0.0.0'), '2.0.0')).toBe('old')
  })

  it('頁の書き方（施策の番号など）が雛形と違っても、いまの形', () => {
    const loops = copyOf('versions/2.0.0', (l) => writeFileSync(join(l, 'L01.html'), readFileSync(join(l, 'L01.html'), 'utf8').replace(/tid-pill/g, 'my-pill').replace(/data-rl/g, 'data-x')))
    expect(stage(loops, '2.0.0')).toBe('current')
  })
})

describe('reworkInstruction（AI に送る作業）', () => {
  const base = { version: '2.0.0', ledgerPath: '/app/skill/skills/rising-loop/migrations.json', backupIndex: '/data/b/loops/index.html' }

  it('頁ごと・一覧の、台帳の項目と、反映し終えた印の書き方を並べる', () => {
    const t = reworkInstruction({
      ...base,
      work: {
        pages: [{ name: 'L01.html', from: '1.7.0', changes: [{ id: '1.7.1-goal-bullet' }, { id: '2.0.0-page-ver' }] }],
        list: { from: '1.7.0', changes: [{ id: '1.7.4-list-rows' }] }
      },
      lost: []
    })
    expect(isInstruction(t)).toBe(true)
    expect(t).toContain('台帳：/app/skill/skills/rising-loop/migrations.json')
    expect(t).toContain('- L01.html（1.7.0 から）：1.7.1-goal-bullet、2.0.0-page-ver')
    expect(t).toContain('一覧（1.7.0 から）：1.7.4-list-rows')
    expect(t).toContain('頁は <html data-loop-ver="2.0.0">、一覧は <!-- list-ver: 2.0.0 --> にする')
    // 殻から消えたものが無ければ、控えの場所は書かない（AI に控えを読ませない）
    expect(t).not.toContain('/data/b/loops/index.html')
  })

  it('殻から消えたものがあれば、元の殻の場所と一緒に並べる', () => {
    const t = reworkInstruction({ ...base, work: { pages: [], list: null }, lost: ['id="my-own-panel"'] })
    expect(t).toContain('殻から消えたもの：id="my-own-panel"')
    expect(t).toContain('元の殻：/data/b/loops/index.html（このファイルの、上に挙げた部品だけを読む）')
    expect(t).not.toContain('頁：')
  })
})

describe('changelogSummary（新しい会話の最初に出す、版の要点）', () => {
  const md = '# CHANGELOG\n\n説明\n\n## 2.1.0 — 2026-11-01\n\n**移行が必要**\n\n- ★ **ボタンを足した。** 押すと送る\n  続きの行\n- 文を短くした\n\n## 2.0.0 — 2026-10-01\n\n- 前の版\n'
  it('その版の箇条書きの1行目だけを、飾りを外して返す', () => {
    expect(changelogSummary(md, '2.1.0')).toEqual(['ボタンを足した。 押すと送る', '文を短くした'])
  })
  it('その版が無ければ空', () => {
    expect(changelogSummary(md, '9.9.9')).toEqual([])
  })
  it('同梱のスキルの CHANGELOG に、いまの版の項がある', () => {
    expect(changelogSummary(readFileSync(join(SKILL, 'CHANGELOG.md'), 'utf8'), tpl.version).length).toBeGreaterThan(0)
  })
})
