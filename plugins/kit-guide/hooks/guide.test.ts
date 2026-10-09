import { expect, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, bodyColumns: 80 } as never
const PANE = { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 50, title: 'X Factor kit', isFocused: true, placement: 'dock' } as never

test('welcomes once, then stays quiet', async ($, on) => {
  let welcomed: unknown = undefined
  on('store.get', () => ({ value: welcomed }))
  on('store.set', ($, e) => {
    welcomed = e.value
    return { value: undefined }
  })
  on('env.get', () => ({ value: 'C:/Users/x/.claude/kits/claude-kit/plugins/blast-radius;C:/Users/x/.claude/kits/claude-kit/plugins/replay-theater' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // What the engine draws when no plugin has a band to show.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'prompt') as never
  })

  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'kit-guide', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /Blast Radius/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cash Tax/ })).toBe(undefined)
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'kit-guide', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await ui.press({ key: 'ok' })
  expect(welcomed).toBe(true)
  await ui.unmount()

  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ plugin: 'kit-guide', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await again.find({ type: 'Text', text: /X Factor kit is on/ })).toBe(undefined)
})

test('/kit pane lists every part when it cannot tell which are installed', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'kit-guide', surface, component: 'Pane', requestId: 'kit', props: PANE })
    for (const name of [/Blast Radius/, /File Tree/, /Replay Theater/, /Cash Tax/]) {
      expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
    }
    await ui.unmount()
  }
})
