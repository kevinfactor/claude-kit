// Pure helpers: path normalising and folding a flat file list into tree rows.

import type { FileMark } from '../types'

export function norm(path: string): string {
  let p = path.replace(/\\/g, '/')
  const drive = /^\/([a-zA-Z])\//.exec(p)
  if (drive) p = `${(drive[1] ?? '').toUpperCase()}:/${p.slice(3)}`
  if (/^[a-z]:\//.test(p)) p = p[0]?.toUpperCase() + p.slice(1)
  return p.replace(/\/+$/, '')
}

export function join(root: string, rel: string): string {
  const r = norm(rel)
  if (/^[a-zA-Z]:\//.test(r) || r.startsWith('/')) return r
  return `${norm(root)}/${r}`
}

export type Row =
  | { kind: 'dir'; depth: number; name: string }
  | { kind: 'file'; depth: number; name: string; mark: FileMark }

/** Rows for a tree under root; files outside root go under their own top-level path. */
export function rows(files: readonly FileMark[], root: string): Row[] {
  const base = norm(root).toLowerCase() + '/'
  const sorted = [...files]
    .map(m => {
      const p = norm(m.path)
      const rel = p.toLowerCase().startsWith(base) ? p.slice(base.length) : p
      return { rel, mark: m }
    })
    .sort((a, b) => a.rel.localeCompare(b.rel))
  const out: Row[] = []
  let prev: string[] = []
  for (const { rel, mark } of sorted) {
    const parts = rel.split('/')
    const name = parts.pop() ?? rel
    let same = 0
    while (same < parts.length && same < prev.length && parts[same] === prev[same]) same++
    for (let d = same; d < parts.length; d++) out.push({ kind: 'dir', depth: d, name: parts[d] ?? '' })
    out.push({ kind: 'file', depth: parts.length, name, mark })
    prev = parts
  }
  return out
}

/** Pulls file arguments out of `git add a b c` (skipping flags). */
export function gitAddPaths(command: string): string[] | null {
  const m = /\bgit\s+add\s+([^;&|\n]*)/.exec(command)
  if (!m) return null
  const out: string[] = []
  for (const hit of (m[1] ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const w = hit[1] ?? hit[2] ?? hit[3] ?? ''
    if (w && !w.startsWith('-')) out.push(w)
  }
  return out
}

export function isCommit(command: string): boolean {
  return /\bgit\s+(-C\s+\S+\s+)?commit\b/.test(command)
}

/** Records one act on a path in a list, newest first. */
export function mark(list: readonly FileMark[], path: string, act: 'read' | 'edit' | 'commit', at: number, cap = 400): FileMark[] {
  const p = norm(path)
  const key = p.toLowerCase()
  const old = list.find(m => norm(m.path).toLowerCase() === key)
  const next: FileMark = {
    path: p,
    read: (old?.read ?? 0) + (act === 'read' ? 1 : 0),
    edit: (old?.edit ?? 0) + (act === 'edit' ? 1 : 0),
    commit: (old?.commit ?? 0) + (act === 'commit' ? 1 : 0),
    last: act,
    at,
    isThisSession: true,
  }
  return [next, ...list.filter(m => m !== old)].slice(0, cap)
}
