import { expect, mock, test } from 'claude-code/testing'

import { detect, resolvePath } from './detect'

test('spots destructive commands in bash, PowerShell and git', async () => {
  expect(detect('rm -rf build dist')[0]).toEqual({ kind: 'delete', targets: ['build', 'dist'], label: 'rm' })
  expect(detect('Remove-Item -Recurse -Force "C:\\tmp\\old stuff"')[0]).toEqual({
    kind: 'delete',
    targets: ['C:\\tmp\\old stuff'],
    label: 'remove-item',
  })
  expect(detect('cd x && git reset --hard HEAD~1')[0]?.kind).toBe('git')
  expect(detect('git clean -fd')[0]?.kind).toBe('git')
  expect(detect('git push origin master --force')[0]?.kind).toBe('git')
  expect(detect('rmdir /s /q node_modules')[0]).toEqual({ kind: 'delete', targets: ['node_modules'], label: 'rmdir' })
  expect(detect('ls -la; git status; git push origin master')).toEqual([])
  expect(detect('echo rm is a word')).toEqual([])
  expect(detect('bash -c "rm -rf build"')[0]).toMatchObject({ kind: 'delete', targets: ['build'] })
  expect(detect('powershell -Command "Remove-Item -Recurse x"')[0]).toMatchObject({ kind: 'delete', targets: ['x'] })
  expect(detect('Remove-Item Env:CLAUDE_CONFIG_DIR')).toEqual([])
  expect(detect('Remove-Item -Path Variable:x, Alias:y')).toEqual([])
  expect(detect('Remove-Item HKCU:\Software\Old -Recurse')[0]).toMatchObject({ kind: 'delete' })
  expect(detect('cmd /c rmdir /s /q out')[0]).toMatchObject({ kind: 'delete', targets: ['out'] })
  expect(detect('pwsh -c "git reset --hard"')[0]?.kind).toBe('git')
})

test('resolves relative, Git Bash and parent paths', async () => {
  expect(resolvePath('C:\\proj', 'build')).toBe('C:/proj/build')
  expect(resolvePath('C:/proj/src', '../dist')).toBe('C:/proj/dist')
  expect(resolvePath('C:/proj', '/c/Users/Kevin/tmp')).toBe('C:/Users/Kevin/tmp')
  expect(resolvePath('C:/proj', '$env:TEMP\\x')).toBe(null)
})

test('holds rm -rf with the files listed, then runs it once after Approve', async ($, on) => {
  mock.env(on, { USERPROFILE: 'C:/Users/Kevin' })
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', ($, e) => ({
    value: { kind: String(e.path).endsWith('build') ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false },
  }))
  on('fs.list', () => ({
    value: [
      { name: 'a.js', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
      { name: 'b.js', kind: 'file', size: 1, mtimeMs: 0, isLink: false },
    ],
  }))
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => {
    ran += 1
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))

  const held = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(String(held.deny)).toContain('C:/proj/build/a.js')
  expect(String(held.deny)).toContain('Do NOT retry')
  expect(ran).toBe(0)

  const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
  await ui.press({ key: 'approve' })

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran).toBe(1)

  const again = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(String(again.deny)).toContain('BLAST RADIUS')
  expect(ran).toBe(1)
})

test('lets a single plain file delete through', async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => {
    ran += 1
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm notes.tmp' })
  expect(r.deny).toBe(undefined)
  expect(ran).toBe(1)
})

test('strict mode holds even a single file', { options: { strict: true } }, async ($, on) => {
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  let ran = 0
  on('tool.call', { tool: 'Bash' }, () => {
    ran += 1
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm notes.tmp' })
  expect(String(r.deny)).toContain('C:/proj/notes.tmp')
  expect(ran).toBe(0)
})

test('lets harmless commands straight through', async ($, on) => {
  let ran = 0
  on('tool.call', { tool: 'PowerShell' }, () => {
    ran += 1
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'PowerShell', command: 'Get-ChildItem' })
  expect(ran).toBe(1)
})
