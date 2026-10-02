// 開いたプロジェクトの一覧。アプリのデータ置き場の projects.json に持つ。
// プロジェクトのフォルダ（loops/ を含む）には何も書かない。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { AiKind, Migration, PermMode, Project, ProjectsState } from '@shared/types'

export function emptyState(): ProjectsState {
  return { projects: [], currentId: null }
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** フォルダをプロジェクトにして開く。すでにプロジェクトなら、増やさずにそれを開く */
export function addProject(s: ProjectsState, folder: string, now: string): { state: ProjectsState; project: Project; existed: boolean } {
  const f = trimSlash(folder)
  const found = s.projects.find((p) => p.folder === f)
  if (found) return { state: { ...s, currentId: found.id }, project: found, existed: true }
  const max = s.projects.reduce((m, p) => Math.max(m, parseInt(p.id.slice(1), 10) || 0), 0)
  const project: Project = { id: 'p' + (max + 1), name: basename(f), folder: f, addedAt: now }
  return { state: { projects: [...s.projects, project], currentId: project.id }, project, existed: false }
}

export function selectProject(s: ProjectsState, id: string): ProjectsState {
  return s.projects.some((p) => p.id === id) ? { ...s, currentId: id } : s
}

/**
 * 設定画面で変えるもの。名前は常にフォルダ名にするので、フォルダを変えたら名前も変わる。
 * フォルダを変えたら、前のフォルダについての記録（新しい形にした・知らせた・最初の依頼）は消す
 */
export function updateProject(s: ProjectsState, id: string, patch: { folder?: string; ai?: AiKind; perm?: PermMode }): ProjectsState {
  if (!s.projects.some((p) => p.id === id)) return s
  return {
    ...s,
    projects: s.projects.map((p) => {
      if (p.id !== id) return p
      let next: Project = { ...p }
      if (patch.ai) next.ai = patch.ai
      if (patch.perm) next.perm = patch.perm
      if (patch.folder != null && trimSlash(patch.folder) !== p.folder) {
        const { migration: _m, noticedForm: _n, kickoffAt: _k, ...rest } = next
        const folder = trimSlash(patch.folder)
        next = { ...rest, folder, name: basename(folder) }
      }
      return next
    })
  }
}

/** アプリの一覧から外す（フォルダには触れない）。開いていたら、隣のプロジェクトを開く */
export function removeProject(s: ProjectsState, id: string): ProjectsState {
  const i = s.projects.findIndex((p) => p.id === id)
  if (i < 0) return s
  const projects = s.projects.filter((p) => p.id !== id)
  const currentId = s.currentId !== id ? s.currentId : (projects[Math.min(i, projects.length - 1)]?.id ?? null)
  return { projects, currentId }
}

export function markKickoff(s: ProjectsState, id: string, now: string): ProjectsState {
  if (!s.projects.some((p) => p.id === id)) return s
  return { ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, kickoffAt: now } : p)) }
}

export function markNotice(s: ProjectsState, id: string, formKey: string): ProjectsState {
  if (!s.projects.some((p) => p.id === id)) return s
  return { ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, noticedForm: formKey } : p)) }
}

export function setMigration(s: ProjectsState, id: string, m: Migration | undefined): ProjectsState {
  if (!s.projects.some((p) => p.id === id)) return s
  return {
    ...s,
    projects: s.projects.map((p) => {
      if (p.id !== id) return p
      const { migration: _old, ...rest } = p
      return m ? { ...rest, migration: m } : rest
    })
  }
}

function isProject(v: unknown): v is Project {
  const p = v as Project
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.folder === 'string' && typeof p.addedAt === 'string'
}

/** 読めない中身は空として扱う（次の保存で直る） */
export function parseState(json: string | null): ProjectsState {
  if (json == null) return emptyState()
  let raw: { projects?: unknown; currentId?: unknown }
  try {
    raw = JSON.parse(json)
  } catch {
    return emptyState()
  }
  if (!raw || !Array.isArray(raw.projects)) return emptyState()
  const projects = raw.projects.filter(isProject)
  const currentId = projects.some((p) => p.id === raw.currentId) ? (raw.currentId as string) : (projects[0]?.id ?? null)
  return { projects, currentId }
}

export function loadState(file: string): ProjectsState {
  let json: string | null = null
  try {
    json = readFileSync(file, 'utf8')
  } catch {
    // 初回は無い
  }
  return parseState(json)
}

/** 書きかけのファイルが残らないよう、別名で書いてから置き換える */
export function saveState(file: string, s: ProjectsState): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2))
  renameSync(tmp, file)
}
