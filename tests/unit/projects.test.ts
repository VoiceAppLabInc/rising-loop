import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addProject, emptyState, loadState, markKickoff, markNotice, parseState, saveState, selectProject, setMigration } from '../../src/main/projects'

const NOW = '2026-10-01T10:00:00.000Z'

describe('addProject', () => {
  it('フォルダ名をプロジェクトの名前にし、開いているプロジェクトにする', () => {
    const r = addProject(emptyState(), '/Users/a/yoga-app', NOW)
    expect(r.existed).toBe(false)
    expect(r.project).toEqual({ id: 'p1', name: 'yoga-app', folder: '/Users/a/yoga-app', addedAt: NOW })
    expect(r.state.projects).toHaveLength(1)
    expect(r.state.currentId).toBe('p1')
  })

  it('ID は今ある最大の番号の次にする', () => {
    let s = addProject(emptyState(), '/a/one', NOW).state
    s = addProject(s, '/a/two', NOW).state
    s = { ...s, projects: s.projects.filter((p) => p.id !== 'p1') }
    const r = addProject(s, '/a/three', NOW)
    expect(r.project.id).toBe('p3')
  })

  it('すでにプロジェクトになっているフォルダなら、増やさずにそれを開く', () => {
    let s = addProject(emptyState(), '/a/one', NOW).state
    s = addProject(s, '/a/two', NOW).state
    const r = addProject(s, '/a/one/', NOW)
    expect(r.existed).toBe(true)
    expect(r.project.id).toBe('p1')
    expect(r.state.projects).toHaveLength(2)
    expect(r.state.currentId).toBe('p1')
  })

  it('元の状態を書き換えない', () => {
    const s = emptyState()
    addProject(s, '/a/one', NOW)
    expect(s).toEqual(emptyState())
  })
})

describe('selectProject', () => {
  it('開いているプロジェクトを切り替える', () => {
    let s = addProject(emptyState(), '/a/one', NOW).state
    s = addProject(s, '/a/two', NOW).state
    expect(selectProject(s, 'p1').currentId).toBe('p1')
  })

  it('無い ID なら変えない', () => {
    const s = addProject(emptyState(), '/a/one', NOW).state
    expect(selectProject(s, 'p9')).toBe(s)
  })
})

describe('parseState', () => {
  it('読めない中身なら空にする', () => {
    expect(parseState(null)).toEqual(emptyState())
    expect(parseState('{壊れた')).toEqual(emptyState())
    expect(parseState('{"projects": "x"}')).toEqual(emptyState())
  })

  it('開いているプロジェクトが一覧に無ければ、先頭を開く', () => {
    const json = JSON.stringify({ projects: [{ id: 'p2', name: 'b', folder: '/b', addedAt: NOW }], currentId: 'p1' })
    expect(parseState(json).currentId).toBe('p2')
  })
})

describe('loadState / saveState', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rla-projects-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('保存したものを読み戻せる', () => {
    const file = join(dir, 'projects.json')
    const s = addProject(emptyState(), '/a/one', NOW).state
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
  })

  it('ファイルが無ければ空にする', () => {
    expect(loadState(join(dir, 'none.json'))).toEqual(emptyState())
  })

  it('壊れたファイルは空として読み、次の保存で直る', () => {
    const file = join(dir, 'projects.json')
    writeFileSync(file, '{壊れた')
    const s = addProject(loadState(file), '/a/one', NOW).state
    saveState(file, s)
    expect(JSON.parse(readFileSync(file, 'utf8')).projects).toHaveLength(1)
  })
})

describe('markKickoff', () => {
  it('最初の依頼を送った日時を記録する', () => {
    const s = addProject(emptyState(), '/a/one', NOW).state
    const next = markKickoff(s, 'p1', '2026-10-01T11:00:00.000Z')
    expect(next.projects[0].kickoffAt).toBe('2026-10-01T11:00:00.000Z')
    expect(s.projects[0].kickoffAt).toBeUndefined()
  })

  it('無い ID なら変えない', () => {
    const s = addProject(emptyState(), '/a/one', NOW).state
    expect(markKickoff(s, 'p9', NOW)).toBe(s)
  })

  it('保存して読み戻しても残る', () => {
    const s = markKickoff(addProject(emptyState(), '/a/one', NOW).state, 'p1', NOW)
    expect(parseState(JSON.stringify(s)).projects[0].kickoffAt).toBe(NOW)
  })
})

describe('markNotice', () => {
  it('古い形を知らせたことを、その形ごとに記録する', () => {
    const s = addProject(emptyState(), '/a/one', NOW).state
    const next = markNotice(s, 'p1', '1.5-1.7:1.6.1')
    expect(next.projects[0].noticedForm).toBe('1.5-1.7:1.6.1')
    expect(s.projects[0].noticedForm).toBeUndefined()
    expect(parseState(JSON.stringify(next)).projects[0].noticedForm).toBe('1.5-1.7:1.6.1')
  })

  it('無い ID なら変えない', () => {
    const s = addProject(emptyState(), '/a/one', NOW).state
    expect(markNotice(s, 'p9', 'x')).toBe(s)
  })
})

describe('setMigration', () => {
  const m = { at: NOW, backup: '/data/backups/p1/20261001-100000', from: '1.7.5', lost: ['id="x"'] }
  it('新しい形にしたことを記録し、元に戻したら消す', () => {
    const s = setMigration(addProject(emptyState(), '/a/one', NOW).state, 'p1', m)
    expect(s.projects[0].migration).toEqual(m)
    expect(parseState(JSON.stringify(s)).projects[0].migration).toEqual(m)
    expect(setMigration(s, 'p1', undefined).projects[0].migration).toBeUndefined()
  })
})
