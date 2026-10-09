export type BlastPending = {
  key: string
  tool: string
  command: string
  labels: string[]
  lines: string[]
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    'blast-radius': {
      pending: BlastPending | null
      approved: string[]
    }
  }
}
