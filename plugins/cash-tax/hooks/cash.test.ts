import { expect, mock, test } from 'claude-code/testing'

import { phase, usd } from './money'

test('prices and phases', async () => {
  expect(usd(400_000, 8)).toBe('$3.20')
  expect(usd(400_000, 0.2)).toBe('$0.08')
  expect(phase(10 * 60_000, 60, 10)).toBe('fresh')
  expect(phase(55 * 60_000, 60, 10)).toBe('cooling')
  expect(phase(61 * 60_000, 60, 10)).toBe('cold')
})

test('holds the first message after the cache went cold, sends the second', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 400_000, window: 1_000_000 }, rateLimits: [] },
  }))
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  let entered = 0
  on('prompt.submit', ($, e) => {
    entered += 1
    return { text: e.text }
  })

  await $.turn.complete({ text: 'done', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  await clock.advance(61 * 60_000)

  const first = await $.prompt.submit({ text: 'hello again', origin: { kind: 'composer' }, wait: false } as never)
  expect(String(first.drop)).toContain('$3.20')
  expect(entered).toBe(0)

  const second = await $.prompt.submit({ text: 'hello again', origin: { kind: 'composer' }, wait: false } as never)
  expect(second.drop).toBe(undefined)
  expect(entered).toBe(1)
})
