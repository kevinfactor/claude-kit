import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileAct, FileMark } from '../types'
import { gitAddPaths, isCommit, join, mark, norm, rows } from './tree'

const PANE = 'file-tree'
const files = atom({ plugin: 'file-tree', key: 'files' } as const, [])
const live = atom({ plugin: 'file-tree', key: 'live' } as const, {})
const showAll = atom({ plugin: 'file-tree', key: 'showAll' } as const, false)

type $ = EngineInterface

const COLOR: Record<FileAct, 'cyan' | 'yellow' | 'green'> = { read: 'cyan', edit: 'yellow', commit: 'green' }
const GLYPH: Record<FileAct, string> = { read: 'R', edit: 'E', commit: 'C' }

async function setLive($: $, paths: readonly string[], act: FileAct | null): Promise<void> {
  await update($, live, cur => {
    const nextLive: Record<string, FileAct> = { ...cur }
    for (const p of paths) {
      if (act === null) delete nextLive[norm(p)]
      else nextLive[norm(p)] = act
    }
    return nextLive
  })
}

async function record($: $, paths: readonly string[], act: FileAct): Promise<void> {
  const at = await $.clock.now()
  const list = await update($, files, cur => paths.reduce((acc, p) => mark(acc, p, act, at), cur))
  await $.store.set('files', list)
}

async function gitLines($: $, args: string[]): Promise<string[]> {
  try {
    const run = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
    return run.exitCode === 0 ? run.stdout.split(/\r?\n/).filter(Boolean) : []
  } catch {
    return []
  }
}

async function repoRoot($: $): Promise<string | null> {
  return (await gitLines($, ['rev-parse', '--show-toplevel']))[0] ?? null
}

function pathOf(e: { tool: string } & Record<string, unknown>): string | null {
  const p = e.file_path ?? e.notebook_path
  return typeof p === 'string' ? p : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('files')) as FileMark[] | undefined
    await update($, files, () => (saved ?? []).map(m => ({ ...m, isThisSession: false })))
    await update($, live, () => ({}))
    await $.command.register({ name: 'filetree', description: 'Show the files Claude reads, edits and commits' })
    const opened = await $.ui.open({ id: PANE, title: 'Files' })
    void opened
    return next(e)
  })

  on('command.run', { command: 'filetree' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Files' })
    return { text: 'File tree opened.' }
  })

  on('tool.call', { tool: ['Read', 'Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const path = pathOf(e as never)
    if (path === null) return next(e)
    const act: FileAct = e.tool === 'Read' ? 'read' : 'edit'
    await setLive($, [path], act)
    try {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true) await record($, [path], act)
      return ran
    } finally {
      await setLive($, [path], null)
    }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const command = String((e as { command?: unknown }).command ?? '')
    const adds = gitAddPaths(command)
    const commits = isCommit(command)
    if (adds === null && !commits) return next(e)

    const root = (await repoRoot($)) ?? (await $.session.cwd())
    const cwd = await $.session.cwd()
    let touched: string[] = []
    if (adds !== null) touched = adds.filter(a => a !== '.' && a !== '-A').map(a => join(cwd, a))
    if (commits) {
      const staged = await gitLines($, ['diff', '--cached', '--name-only'])
      const tracked = /\s-[a-zA-Z]*a\b|--all\b/.test(command) ? await gitLines($, ['diff', '--name-only']) : []
      touched = [...touched, ...[...staged, ...tracked].map(r => join(root, r))]
    }
    await setLive($, touched, 'commit')
    try {
      const ran = await next(e)
      if (ran.deny === undefined && ran.isError !== true && commits) {
        const done = await gitLines($, ['show', '--name-only', '--pretty=format:', 'HEAD'])
        await record($, done.map(r => join(root, r)), 'commit')
      }
      return ran
    } finally {
      await setLive($, touched, null)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, files)
    const now = await read($, live)
    const isAll = await read($, showAll)
    const cwd = await $.session.cwd()
    const width = Math.max(16, e.props.bodyColumns)
    const room = Math.max(4, (e.viewport?.rows ?? 30) - 8)

    // In-flight paths not yet in the list still show.
    const liveOnly: FileMark[] = Object.entries(now)
      .filter(([p]) => !all.some(m => norm(m.path).toLowerCase() === p.toLowerCase()))
      .map(([p, act]) => ({ path: p, read: 0, edit: 0, commit: 0, last: act, at: 0, isThisSession: true }))
    const shown = [...liveOnly, ...all.filter(m => isAll || m.isThisSession)]
    const tree = rows(shown, cwd)
    const counts = shown.reduce(
      (c, m) => ({ read: c.read + (m.read > 0 ? 1 : 0), edit: c.edit + (m.edit > 0 ? 1 : 0), commit: c.commit + (m.commit > 0 ? 1 : 0) }),
      { read: 0, edit: 0, commit: 0 },
    )

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="cyan">R {counts.read}</Text>
          <Text color="yellow">E {counts.edit}</Text>
          <Text color="green">C {counts.commit}</Text>
          <Button key="scope" plain label={isAll ? '[all time]' : '[this session]'} onPress={() => update($, showAll, v => !v)} />
          <Button
            key="clear"
            plain
            label="[clear]"
            onPress={async () => {
              await update($, files, () => [])
              await $.store.set('files', [])
            }}
          />
        </Box>
        {tree.length === 0 && <Text dimColor>Nothing touched yet{isAll ? '.' : ' this session.'}</Text>}
        {tree.slice(0, room).map(r => {
          const pad = '  '.repeat(r.depth)
          if (r.kind === 'dir') return <Text dimColor>{`${pad}${r.name}/`.slice(0, width)}</Text>
          const active = now[norm(r.mark.path)]
          const act = active ?? r.mark.last
          const tags = (['read', 'edit', 'commit'] as const)
            .filter(a => r.mark[a] > 0)
            .map(a => GLYPH[a])
            .join('')
          return (
            <Text color={COLOR[act]} bold={active !== undefined} dimColor={!r.mark.isThisSession && active === undefined} wrap="truncate-end">
              {`${pad}${active !== undefined ? '▶ ' : ''}${r.name}`}
              <Text dimColor>{` ${tags}`}</Text>
            </Text>
          )
        })}
        {tree.length > room && <Text dimColor>{`… ${tree.length - room} more rows`}</Text>}
      </Box>
    )
  })
}
