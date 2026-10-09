// Pure maths for the band and the hold message.

export function usd(tokens: number, perMTok: number): string {
  const v = (tokens / 1_000_000) * perMTok
  return v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`
}

export function kTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : `${Math.round(tokens / 1000)}k`
}

export function mins(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`
}

export type Phase = 'fresh' | 'cooling' | 'cold'

export function phase(idleMs: number, ttlMin: number, warnMin: number): Phase {
  const ttl = ttlMin * 60_000
  if (idleMs >= ttl) return 'cold'
  if (idleMs >= ttl - warnMin * 60_000) return 'cooling'
  return 'fresh'
}
