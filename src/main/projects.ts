// 開いたプロジェクトの一覧。アプリのデータ置き場の projects.json に持つ。
// プロジェクトのフォルダ（loops/ を含む）には何も書かない。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { Project, ProjectsState } from '@shared/types'

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
