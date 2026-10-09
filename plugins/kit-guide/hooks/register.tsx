import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'kit'
const isWelcomeOpen = atom({ plugin: 'kit-guide', key: 'isWelcomeOpen' } as const, false)

type $ = EngineInterface

type Part = { id: string; name: string; what: string; how: string }

const PARTS: readonly Part[] = [
  {
    id: 'blast-radius',
    name: 'Blast Radius',
    what: 'Stops risky deletes and git commands, shows exactly what they would remove, and waits for you.',
    how: 'A red box appears above the prompt: press Approve once or Reject.',
  },
  {
    id: 'file-tree',
    name: 'File Tree',
    what: 'A side pane listing the files Claude reads, edits and commits, as it happens.',
    how: 'Type /filetree to open it.',
  },
  {
    id: 'replay-theater',
    name: 'Replay Theater',
    what: 'After Claude edits files, step through each change as before and after.',
    how: 'Press Replay above the prompt, or type /replay.',
  },
  {
    id: 'cash-tax',
    name: 'Cash Tax',
    what: 'Warns before a long conversation you left idle gets expensive to pick up again.',
    how: 'Type /cashtax to see the cost, /keepwarm to keep it cheap while you are away.',
  },
]

/** The kit's parts this session loaded, read from the plugin folders the installer set. All four when that can't be told. */
async function installed($: $): Promise<readonly Part[]> {
  const dirs = ((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').replace(/\\/g, '/')
  const found = PARTS.filter(p => dirs.includes(`/${p.id}`))
  return found.length === 0 ? PARTS : found
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kit', description: 'What the X Factor kit does and how to use each part' })
    const seen = (await $.store.get('welcomed')) === true
    if (!seen) await update($, isWelcomeOpen, () => true)
    return next(e)
  })

  on('command.run', { command: 'kit' }, async $ => {
    await $.ui.open({ id: PANE, title: 'X Factor kit', focus: true, closeOnEscape: true })
    return { text: 'Kit guide opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await read($, isWelcomeOpen)) || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const parts = await installed($)
    const close = async () => {
      await update($, isWelcomeOpen, () => false)
      await $.store.set('welcomed', true)
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          The X Factor kit is on. Here is what it does:
        </Text>
        {parts.map(p => (
          <Text>
            <Text bold>{p.name}</Text>
            <Text dimColor>{`  ${p.what}`}</Text>
          </Text>
        ))}
        <Text dimColor>Type /kit any time to see this again.</Text>
        <Box gap={1}>
          <Button key="ok" label="Got it" variant="primary" onPress={close} />
          <Button
            key="more"
            label="Show me how"
            onPress={async () => {
              await close()
              await $.ui.open({ id: PANE, title: 'X Factor kit', focus: true, closeOnEscape: true })
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const parts = await installed($)
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>X Factor kit</Text>
        {parts.map(p => (
          <Box flexDirection="column">
            <Text bold>{p.name}</Text>
            <Text>{p.what}</Text>
            <Text color="cyan">{p.how}</Text>
          </Box>
        ))}
        <Text dimColor>To turn a part on or off, ask Claude: "turn off Cash Tax in the X Factor kit". Settings for each part are in /config.</Text>
        <Button key="close" role="dismiss" label="Close" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )
  })
}
