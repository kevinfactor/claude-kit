// Pure command parsing, no `$`, so the tests call it directly.

export type GitDanger = 'clean' | 'reset-hard' | 'discard' | 'push-force' | 'branch-delete'

export type Danger =
  | { kind: 'delete'; targets: string[]; label: string }
  | { kind: 'git'; git: GitDanger; label: string }

/** Splits a command line into words, honouring single and double quotes. */
export function words(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let started = false
  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started || cur !== '') out.push(cur)
      cur = ''
      started = false
      continue
    }
    cur += ch
  }
  if (started || cur !== '') out.push(cur)
  return out
}

/** Splits on ; && || | and newlines. Quote-blind, which errs towards checking more. */
export function segments(command: string): string[] {
  return command
    .split(/\r?\n|;|&&|\|\||\|/)
    .map(s => s.trim())
    .filter(Boolean)
}

const WRAPPERS = new Set(['bash', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd'])
const PS_DELETE = new Set(['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'])
const PS_VALUE_FLAGS = new Set(['-filter', '-include', '-exclude', '-credential', '-stream'])

function stripLead(ws: string[]): string[] {
  let i = 0
  while (i < ws.length && (ws[i] === 'sudo' || ws[i] === '&' || ws[i] === 'xargs' || /^[A-Za-z_]+=/.test(ws[i] ?? ''))) i++
  return ws.slice(i)
}

// PowerShell drives that hold no files: clearing a variable or alias deletes nothing on disk. Registry drives stay held.
const NOT_FILES = /^(env|variable|function|alias):/i

function psTargets(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const w = args[i] ?? ''
    const lw = w.toLowerCase()
    if (lw === '-path' || lw === '-literalpath') {
      const value = args[i + 1]
      if (value !== undefined) out.push(...value.split(','))
      i++
      continue
    }
    if (PS_VALUE_FLAGS.has(lw)) {
      i++
      continue
    }
    // PowerShell switches, and cmd switches like /s /q
    if (w.startsWith('-') || /^\/[a-zA-Z]$/.test(w)) continue
    out.push(...w.split(','))
  }
  return out.map(s => s.trim()).filter(t => t !== '' && !NOT_FILES.test(t.replace(/^['"]|['"]$/g, '')))
}

export function detectSegment(seg: string): Danger | null {
  const ws = stripLead(words(seg))
  const first = ws[0]
  if (first === undefined) return null
  const head = first.toLowerCase().replace(/\.exe$/, '')
  const rest = ws.slice(1)

  // bash -c "...", powershell -Command "...", cmd /c ...: judge the payload.
  if (WRAPPERS.has(head)) {
    const at = rest.findIndex(w => /^(-c|\/c|\/k|-command|-encodedcommand)$/i.test(w))
    if (at >= 0) {
      if (/^-encodedcommand$/i.test(rest[at] ?? '')) return { kind: 'delete', targets: [], label: `${head} -EncodedCommand (cannot inspect)` }
      const inner = detect(rest.slice(at + 1).join(' '))
      return inner[0] ?? null
    }
  }

  if (head === 'git') {
    const verb = rest.find(w => !w.startsWith('-'))
    if (verb === 'clean' && rest.some(w => /^-[a-zA-Z]*f/.test(w) || w === '--force'))
      return { kind: 'git', git: 'clean', label: 'git clean (deletes untracked files)' }
    if (verb === 'reset' && rest.includes('--hard'))
      return { kind: 'git', git: 'reset-hard', label: 'git reset --hard (discards uncommitted changes)' }
    if ((verb === 'checkout' || verb === 'restore') && rest.includes('.') && !rest.includes('--staged'))
      return { kind: 'git', git: 'discard', label: `git ${verb} . (discards working-tree changes)` }
    if (verb === 'push' && rest.some(w => w === '--force' || w === '-f' || w.startsWith('--force-with-lease') || /^\+/.test(w)))
      return { kind: 'git', git: 'push-force', label: 'git push --force (rewrites remote history)' }
    if (verb === 'branch' && rest.some(w => w === '-D' || w === '--delete'))
      return { kind: 'git', git: 'branch-delete', label: 'git branch -D (deletes a branch)' }
    return null
  }

  if (head === 'find' && rest.includes('-delete')) {
    const root = rest.find(w => !w.startsWith('-') && !w.startsWith('('))
    return { kind: 'delete', targets: [root ?? '.'], label: 'find -delete' }
  }

  if (head === 'rm' || head === 'unlink' || head === 'shred') {
    // Git Bash rm, or PowerShell's rm alias for Remove-Item.
    const isPs = rest.some(f => /^-(recurse|force|path|literalpath)$/i.test(f))
    const targets = isPs ? psTargets(rest) : rest.filter(w => !w.startsWith('-'))
    return targets.length > 0 ? { kind: 'delete', targets, label: head } : null
  }

  if (PS_DELETE.has(head)) {
    const targets = psTargets(rest)
    return targets.length > 0 ? { kind: 'delete', targets, label: head } : null
  }

  if (/^\[system\.io\.(directory|file)\]::delete/i.test(first)) {
    return { kind: 'delete', targets: [], label: '[System.IO] Delete' }
  }

  return null
}

export function detect(command: string): Danger[] {
  return segments(command)
    .map(detectSegment)
    .filter((d): d is Danger => d !== null)
}

/** Normalises a command so an identical retry matches its approval. */
export function keyOf(tool: string, command: string): string {
  return `${tool}:${command.trim().replace(/\s+/g, ' ')}`
}

/** Makes a target absolute against cwd; Git Bash /c/... becomes C:/...; null when it can't tell. */
export function resolvePath(cwd: string, target: string, home?: string): string | null {
  let t = target.replace(/\\/g, '/')
  if (t.includes('$') || t.includes('`')) return null
  if (t === '~' || t.startsWith('~/')) {
    if (home === undefined) return null
    t = home.replace(/\\/g, '/') + t.slice(1)
  }
  const drive = /^\/([a-zA-Z])(\/|$)/.exec(t)
  if (drive) t = `${(drive[1] ?? '').toUpperCase()}:/${t.slice(3)}`
  const isAbs = /^[a-zA-Z]:\//.test(t) || t.startsWith('/')
  const full = isAbs ? t : `${cwd.replace(/\\/g, '/').replace(/\/$/, '')}/${t}`
  const parts: string[] = []
  for (const p of full.split('/')) {
    if (p === '.') continue
    if (p === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(p)
  }
  const joined = parts.join('/').replace(/\/+$/, '')
  return /^[a-zA-Z]:$/.test(joined) ? `${joined}/` : joined || '/'
}

/** A glob on the last path segment: * and ? only. */
export function globToRegExp(pattern: string): RegExp {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}
