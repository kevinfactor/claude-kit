export type CashTaxWarm = {
  isOn: boolean
  pings: number
  /** Tokens read from cache across all pings, for the honest running cost. */
  readTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'cash-tax': {
      /** When the last request touched the cache (ms, $.clock.now). 0 = none yet. */
      lastHit: number
      /** Context tokens the last response was answered over. */
      tokens: number
      /** Redraw clock, moved by a timer. */
      now: number
      warm: CashTaxWarm
      /** lastHit value the person dismissed the band for. */
      dismissedAt: number
      /** Set when a cold prompt was held once; the next submit goes through. */
      isArmed: boolean
    }
  }
}
