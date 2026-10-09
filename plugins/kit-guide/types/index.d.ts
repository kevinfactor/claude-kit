/** Ids of the kit's mods, as their plugin folders are named. */
export type KitPartId = 'blast-radius' | 'file-tree' | 'replay-theater' | 'cash-tax'

declare module 'claude-code' {
  interface PluginState {
    'kit-guide': {
      /** The one-time welcome band is showing. */
      isWelcomeOpen: boolean
    }
  }
}
