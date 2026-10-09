import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReplayEdit } from '../types'
import { hunkStarts, rowsOf, unified, windowed } from './diff'

const PANE = 'replay'
const edits = atom({ plugin: 'replay-theater', key: 'edits' } as const, [])
const cursor = atom({ plugin: 'replay-theater', key: 'cursor' } as const, 0)
const bandTurn = atom({ plugin: 'replay-theater', key: 'bandTurn' } as const, null)
const offset = atom({ plugin: 'replay-theater', key: 'offset' } as const, 0)

const KEEP = 60
const MAX_DIFF = 20_000

type $ = EngineInterface

async function readText($: $, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function openAt($: $, index: number): Promise<void> {
  await update($, cursor, () => index)
  await update($, offset, () => 0)
  await $.ui.open({ id: PANE, title: 'Replay Theater', focus: true, closeOnEscape: true })
}

/** Index of the first edit of the newest turn. */
function lastTurnStart(list: readonly ReplayEdit[]): number {
  const last = list.at(-1)
  if (last === undefined) return 0
  const i = list.findIndex(x => x.turnId === last.turnId)
  return i < 0 ? 0 : i
}

export const register: Register = on => {
  let turnId = 'turn-0'

  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('edits')) as ReplayEdit[] | undefined
    await update($, edits, () => saved ?? [])
    await $.command.register({ name: 'replay', description: 'Step through the file edits of the last turn as diffs' })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    turnId = e.turnId
    return next(e)
  })

  on('command.run', { command: 'replay' }, async $ => {
    const list = await read($, edits)
    if (list.length === 0) return { text: 'Replay Theater: no edits recorded yet.' }
    await openAt($, lastTurnStart(list))
    return { text: 'Replay Theater opened.' }
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const raw = (e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path
    if (typeof raw !== 'string') return next(e)
    const before = await readText($, raw)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    let after = await readText($, raw)
    let prior = before ?? ''
    if (after === null && e.tool === 'Edit') {
      // Unreadable (over 4 MiB): fall back to the edit's own strings.
      const ed = e as { old_string?: string; new_string?: string }
      prior = ed.old_string ?? ''
      after = ed.new_string ?? ''
    }
    const d = unified(prior, after ?? '')
    if (d.text === '') return ran
    const isCut = d.text.length > MAX_DIFF
    const edit: ReplayEdit = {
      id: `${await $.clock.now()}-${Math.random().toString(36).slice(2, 7)}`,
      turnId,
      path: raw.replace(/\\/g, '/'),
      tool: e.tool,
      at: await $.clock.now(),
      // Cut at a line boundary so the hunks stay parseable.
      diff: isCut ? d.text.slice(0, d.text.lastIndexOf('\n@@', MAX_DIFF) > 0 ? d.text.lastIndexOf('\n@@', MAX_DIFF) : MAX_DIFF) : d.text,
      added: d.added,
      removed: d.removed,
      isNewFile: before === null,
      isCut,
    }
    const list = await update($, edits, cur => [...cur, edit].slice(-KEEP))
    await $.store.set('edits', list)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const list = await read($, edits)
      if (list.some(x => x.turnId === e.turnId)) await update($, bandTurn, () => e.turnId)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, bandTurn, () => null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const turn = await read($, bandTurn)
    if (turn === null || e.props.hasSurvey) return next(e)
    const list = await read($, edits)
    const mine = list.filter(x => x.turnId === turn)
    if (mine.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const files = new Set(mine.map(x => x.path)).size
    const added = mine.reduce((n, x) => n + x.added, 0)
    const removed = mine.reduce((n, x) => n + x.removed, 0)

    return (
      <Box gap={1}>
        <Button
          key="replay"
          label={`▶ Replay ${mine.length} edit${mine.length === 1 ? '' : 's'}`}
          variant="primary"
          onPress={() => openAt($, list.findIndex(x => x.turnId === turn))}
        />
        <Text dimColor>
          {files} file{files === 1 ? '' : 's'}{' '}
        </Text>
        <Text color="green">+{added}</Text>
        <Text color="red">-{removed}</Text>
        <Button key="dismiss" plain label="  ✕" onPress={() => update($, bandTurn, () => null)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const list = await read($, edits)
    const i = Math.min(Math.max(0, await read($, cursor)), Math.max(0, list.length - 1))
    const edit = list[i]
    if (edit === undefined) return <Text dimColor>No edits recorded yet.</Text>

    const total = rowsOf(edit.diff).length
    const room = Math.max(6, (e.viewport?.rows ?? 30) - 9)
    const start = Math.min(await read($, offset), Math.max(0, total - room))
    // Re-headed per hunk so a window into a long diff still draws as a diff.
    const view = windowed(edit.diff, start, room)
    const sameTurn = list.filter(x => x.turnId === edit.turnId)
    const step = sameTurn.indexOf(edit) + 1
    const nextHunk = hunkStarts(edit.diff).find(k => k > start) ?? -1

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{`${i + 1}/${list.length}`}</Text>
          <Text dimColor>{`(edit ${step} of ${sameTurn.length} this turn)`}</Text>
          <Text color="green">+{edit.added}</Text>
          <Text color="red">-{edit.removed}</Text>
          {edit.isNewFile && <Text color="cyan">new file</Text>}
        </Box>
        <Text wrap="truncate-start">{edit.path}</Text>
        <Code source={view} format="diff" path={edit.path} wrap="truncate-end" />
        {edit.isCut && <Text dimColor>Diff cut at {MAX_DIFF} characters.</Text>}
        <Box gap={1}>
          <Button key="prev" hotkey="p" label="Prev" onPress={() => update($, cursor, c => Math.max(0, c - 1)).then(() => update($, offset, () => 0))} />
          <Button key="next" hotkey="n" label="Next" variant="primary" onPress={() => update($, cursor, c => Math.min(list.length - 1, c + 1)).then(() => update($, offset, () => 0))} />
          {nextHunk > 0 && total > room && (
            <Button key="hunk" hotkey="j" label="Next hunk" onPress={() => update($, offset, () => nextHunk)} />
          )}
          {start > 0 && <Button key="top" hotkey="k" label="Top" onPress={() => update($, offset, () => 0)} />}
          <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
