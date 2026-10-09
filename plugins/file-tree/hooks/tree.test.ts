import { expect, mock, test } from 'claude-code/testing'

import { gitAddPaths, isCommit, mark, rows } from './tree'

test('folds files into a tree under the working folder', async () => {
  let list = mark([], 'C:\\proj\\src\\a.ts', 'read', 1)
  list = mark(list, 'C:/proj/src/a.ts', 'edit', 2)
  list = mark(list, 'C:/proj/README.md', 'read', 3)
  expect(list.length).toBe(2)
  expect(list.find(m => m.path.endsWith('a.ts'))).toMatchObject({ read: 1, edit: 1, last: 'edit' })
  const r = rows(list, 'C:\\proj')
  expect(r.map(x => `${x.depth}:${x.name}`)).toEqual(['0:README.md', '0:src', '1:a.ts'])
})

test('reads git add and git commit', async () => {
  expect(gitAddPaths('git add src/a.ts "b c.md" -v && git commit -m x')).toEqual(['src/a.ts', 'b c.md'])
  expect(isCommit('git commit -m "x"')).toBe(true)
  expect(isCommit('git status')).toBe(false)
})

test('records a Read and an Edit and keeps them in the store', async ($, on) => {
  const saved: unknown[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', ($, e) => {
    saved.push(e.value)
    return { value: undefined }
  })
  mock.clock(on, { now: 1000 })
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('tool.call', { tool: ['Read', 'Edit'] }, () => ({ result: {} as never }))
  await $.tool.call({ tool: 'Read', file_path: 'C:/proj/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/a.ts', old_string: 'a', new_string: 'b' })
  const last = saved.at(-1) as { path: string }[]
  expect(last[0]).toMatchObject({ path: 'C:/proj/a.ts', read: 1, edit: 1 })
})
