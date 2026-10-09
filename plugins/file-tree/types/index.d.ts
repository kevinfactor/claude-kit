export type FileAct = 'read' | 'edit' | 'commit'

export type FileMark = {
  path: string
  read: number
  edit: number
  commit: number
  last: FileAct
  at: number
  /** Touched in the session now running. */
  isThisSession: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'file-tree': {
      files: FileMark[]
      /** path → what is happening to it right now (a tool call in flight). */
      live: Record<string, FileAct>
      showAll: boolean
    }
  }
}
