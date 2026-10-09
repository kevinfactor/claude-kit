import { expect, mock, test } from 'claude-code/testing'

const PANE = { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 40, title: 'Files', isFocused: false, placement: 'dock' } as never

test('the pane draws an empty state and then the touched file', async ($, on) => {
  mock.clock(on, { now: 1 })
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('store.set', () => ({ value: undefined }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'file-tree', surface, component: 'Pane', requestId: 'file-tree', props: PANE })
    expect(await ui.find({ type: 'Text', text: /Nothing touched/ })).toBeDefined()
    await ui.unmount()
  }
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/src/app.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ plugin: 'file-tree', surface: 'terminal', component: 'Pane', requestId: 'file-tree', props: PANE })
  expect(await ui.find({ type: 'Text', text: /app\.ts/ })).toBeDefined()
})
