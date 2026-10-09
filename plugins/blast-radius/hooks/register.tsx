import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BlastPending } from '../types'
import { detect, globToRegExp, keyOf, resolvePath } from './detect'
import type { Danger } from './detect'

const pending = atom({ plugin: 'blast-radius', key: 'pending' } as const, null)
const approved = atom({ plugin: 'blast-radius', key: 'approved' } as const, [])

const SHOW = 40 // lines listed in the deny text and the band
const WALK = 2000 // entries counted before giving up and saying "at least"

type $ = EngineInterface

async function home($: $): Promise<string | undefined> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? undefined
}

/** Lists every file under path (or path itself), up to WALK. */
async function walk($: $, path: string, out: string[]): Promise<void> {
  if (out.length >= WALK) return
  const stat = await $.fs.stat(path)
  if (stat.kind !== 'dir') {
    out.push(path)
    return
  }
  out.push(`${path}/`)
  for (const entry of await $.fs.list(path)) {
    if (out.length >= WALK) return
    const child = `${path}/${entry.name}`
    if (entry.kind === 'dir') await walk($, child, out)
    else out.push(child)
  }
}

async function expand($: $, cwd: string, target: string, homeDir: string | undefined): Promise<string[]> {
  const full = resolvePath(cwd, target, homeDir)
  if (full === null) return [`? ${target}  (can't resolve: variable or expression)`]
  const slash = full.lastIndexOf('/')
  const leaf = full.slice(slash + 1)
  if (/[*?]/.test(leaf)) {
    const dir = full.slice(0, slash)
    const re = globToRegExp(leaf)
    const hits = (await $.fs.list(dir)).filter(e => re.test(e.name))
    if (hits.length === 0) return [`- ${full}  (matches nothing)`]
    const out: string[] = []
    for (const hit of hits) await walk($, `${dir}/${hit.name}`, out)
    return out
  }
  if (!(await $.fs.exists(full))) return [`- ${full}  (does not exist)`]
  const out: string[] = []
  await walk($, full, out)
  return out
}

async function git($: $, args: string[]): Promise<string[]> {
  const run = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
  return run.stdout.split(/\r?\n/).filter(Boolean)
}

async function radius($: $, d: Danger, cwd: string, homeDir: string | undefined): Promise<string[]> {
  if (d.kind === 'delete') {
    if (d.targets.length === 0) return ['? target computed at run time, cannot list']
    const out: string[] = []
    for (const t of d.targets) out.push(...(await expand($, cwd, t, homeDir)))
    return out
  }
  switch (d.git) {
    case 'clean':
      return (await git($, ['clean', '-nd'])).map(l => l.replace(/^Would remove /, 'delete '))
    case 'reset-hard':
    case 'discard':
      return (await git($, ['status', '--porcelain'])).filter(l => !l.startsWith('??')).map(l => `lose changes in ${l.slice(3)}`)
    case 'push-force':
      return ['remote branch history will be overwritten with your local branch']
    case 'branch-delete':
      return ['the named branch and any commits only it holds']
  }
}

function denyText(p: BlastPending): string {
  const shown = p.lines.slice(0, SHOW).map(l => `  ${l}`).join('\n')
  const more = p.total > SHOW ? `\n  ... and ${p.total - SHOW} more` : ''
  return [
    `BLAST RADIUS: this command is destructive and needs a person's approval. ${p.labels.join('; ')}.`,
    `It would affect ${p.total}${p.total >= WALK ? '+' : ''} item(s):`,
    shown + more,
    'Do NOT retry, rephrase, or use another command or tool to do the same thing.',
    'Stop and tell the person what you wanted to run and why. They approve it with the Approve button above their prompt; the identical command will then run once.',
  ].join('\n')
}

export const register: Register = (on, options) => {
  const isStrict = options.strict === true

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const dangers = detect(command)
    if (dangers.length === 0) return next(e)

    const key = keyOf(e.tool, command)
    const allowed = await read($, approved)
    if (allowed.includes(key)) {
      await update($, approved, list => list.filter(k => k !== key))
      await update($, pending, () => null)
      return next(e)
    }

    const cwd = await $.session.cwd()
    const homeDir = await home($)
    const lines: string[] = []
    for (const d of dangers) {
      try {
        lines.push(...(await radius($, d, cwd, homeDir)))
      } catch (err) {
        lines.push(`? could not list (${String(err).slice(0, 80)})`)
      }
    }
    // One plain file that exists: let it through; this mod is for blasts, not single deletes.
    const isOneFile =
      dangers.every(d => d.kind === 'delete' && d.targets.length === 1 && !/^-[a-zA-Z]*[rR]|^-recurse$/i.test(d.label)) &&
      !/\s-(r|R|rf|fr|Recurse)|\/s/i.test(command) &&
      lines.length === 1 &&
      !/^[?-] |\/$/.test(lines[0] ?? '')
    if (isOneFile && !isStrict) return next(e)

    const p: BlastPending = {
      key,
      tool: e.tool,
      command,
      labels: dangers.map(d => d.label),
      lines: lines.slice(0, 500),
      total: lines.length,
    }
    await update($, pending, () => p)
    $.ui.toast(`Blast Radius: held "${command.slice(0, 60)}" (${p.total} items). Approve above the prompt.`)
    void $.ui.notify(`Held a destructive command: ${command.slice(0, 80)}`, { title: 'Blast Radius' }).catch(() => undefined)
    return { deny: denyText(p) }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: 'BLAST RADIUS: the safety check failed, so the command was held. Do not retry; ask the person to run it themselves.' },
  )

  // An approval is for the very next run; once the person types something new it lapses.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && !e.text.startsWith('Blast Radius: I approved')) {
      await update($, approved, () => [])
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, pending)
    if (p === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 2)
    const room = 8

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">
          Blast Radius: held a destructive command
        </Text>
        <Text>{`$ ${p.command}`.slice(0, width * 2)}</Text>
        <Text dimColor>{p.labels.join('; ')}</Text>
        <Text>
          {p.total}
          {p.total >= WALK ? '+' : ''} item(s) affected:
        </Text>
        {p.lines.slice(0, room).map(l => (
          <Text dimColor>{`  ${l}`.slice(0, width)}</Text>
        ))}
        {p.total > room && <Text dimColor>{`  ... and ${p.total - room} more (the model saw the first ${SHOW})`}</Text>}
        <Box gap={1}>
          <Button
            key="approve"
            label="Approve once"
            variant="primary"
            onPress={async () => {
              await update($, approved, list => [...list.filter(k => k !== p.key), p.key])
              await update($, pending, () => null)
              await $.prompt.submit({ text: `Blast Radius: I approved \`${p.command}\`. Run it now, exactly as written.` })
            }}
          />
          <Button
            key="reject"
            label="Reject"
            onPress={async () => {
              await update($, pending, () => null)
              $.ui.toast('Blast Radius: rejected. The command stays blocked.')
            }}
          />
        </Box>
      </Box>
    )
  })
}
