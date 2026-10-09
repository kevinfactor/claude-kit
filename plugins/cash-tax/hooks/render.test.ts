import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never

test('the band shows the cost while cooling', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [] } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: undefined as never }))
  await $.session.start({ source: 'startup' } as never).catch(() => undefined)
  await $.turn.complete({ text: 'd', reason: 'answer', answer: 'd', durationMs: 1, isAborted: false, turnId: 't' } as never)
  await clock.advance(55 * 60_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'cash-tax', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /\$3\.20/ })).toBeDefined()
    expect(await ui.find({ key: 'warm' })).toBeDefined()
    await ui.unmount()
  }
})
