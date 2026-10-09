import { expect, mock, test } from 'claude-code/testing'

import { rowsOf, unified, windowed } from './diff'

test('emits parseable unified hunks', async () => {
  const d = unified('a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 'a\nb\nC\nd\ne\nf\ng\nh\ni\nj\nk\n')
  expect(d.added).toBe(2)
  expect(d.removed).toBe(1)
  expect(d.text.split('\n')[0]).toBe('@@ -1,6 +1,6 @@')
  expect(d.text).toContain('-c\n+C')
  expect(d.text).toContain('@@ -8,4 +8,5 @@')
  expect(unified('same', 'same').text).toBe('')
  expect(unified('', 'new\n').text.split('\n')[0]).toBe('@@ -0,0 +1,2 @@')
})

test('records an edit with its diff and keeps it', async ($, on) => {
  mock.clock(on, { now: 5 })
  const saved: unknown[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($, e) => {
    saved.push(e.value)
    return { value: undefined }
  })
  let content = 'one\ntwo\n'
  on('fs.read', () => ({ value: content }))
  on('tool.call', { tool: 'Edit' }, () => {
    content = 'one\nTWO\n'
    return { result: {} as never }
  })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\p\\a.txt', old_string: 'two', new_string: 'TWO' })
  const list = saved.at(-1) as { path: string; diff: string; added: number }[]
  expect(list[0]?.path).toBe('C:/p/a.txt')
  expect(list[0]?.diff).toContain('-two\n+TWO')
})

test('a window into a long diff is still a valid diff', async () => {
  const before = Array.from({ length: 80 }, (_, k) => `line ${k}`).join('\n')
  const after = before.replace(/line (\d+)/g, (m, k) => (Number(k) % 2 === 0 ? `LINE ${k}` : m))
  const d = unified(before, after)
  const w = windowed(d.text, 7, 20)
  const parts = w.split('\n')
  const head = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(parts[0] ?? '')
  expect(head).not.toBe(null)
  const body = parts.slice(1)
  expect(body.length).toBe(20)
  expect(body.filter(l => !l.startsWith('+')).length).toBe(Number(head?.[2]))
  expect(body.filter(l => !l.startsWith('-')).length).toBe(Number(head?.[4]))
  expect(rowsOf(w).length).toBe(20)
})
