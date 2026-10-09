import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never
const PANE = { title: 'Replay', isFocused: true, bodyColumns: 80, placement: 'dock' } as never

test('the band offers a replay and the pane draws the diff', async ($, on) => {
  mock.clock(on, { now: 5 })
  on('store.set', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  let content = 'one\ntwo\nthree\n'
  on('fs.read', () => ({ value: content }))
  on('tool.call', { tool: 'Edit' }, () => {
    content = 'one\nTWO\nthree\n'
    return { result: {} as never }
  })
  await $.turn.start({ text: 'go', turnId: 't9' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/a.ts', old_string: 'two', new_string: 'TWO' })
  await $.turn.complete({ text: 'done', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't9' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'replay' })).toBeDefined()
    await band.press({ key: 'replay' })
    const pane = await $.ui.mount({ plugin: 'replay-theater', surface, component: 'Pane', requestId: 'replay', props: PANE })
    expect(await pane.find({ type: 'Code' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /C:\/p\/a\.ts/ })).toBeDefined()
    await pane.unmount()
    await band.unmount()
  }
})
