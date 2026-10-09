export type ReplayEdit = {
  id: string
  turnId: string
  path: string
  tool: string
  at: number
  diff: string
  added: number
  removed: number
  isNewFile: boolean
  isCut: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'replay-theater': {
      edits: ReplayEdit[]
      /** Index into edits the pane shows. */
      cursor: number
      /** The turn whose Replay button shows above the prompt, or null. */
      bandTurn: string | null
      /** First diff line the pane shows. */
      offset: number
    }
  }
}
