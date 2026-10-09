import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { kTokens, mins, phase, usd } from './money'

const lastHit = atom({ plugin: 'cash-tax', key: 'lastHit' } as const, 0)
const tokens = atom({ plugin: 'cash-tax', key: 'tokens' } as const, 0)
const now = atom({ plugin: 'cash-tax', key: 'now' } as const, 0)
const warm = atom({ plugin: 'cash-tax', key: 'warm' } as const, { isOn: false, pings: 0, readTokens: 0 })
const dismissedAt = atom({ plugin: 'cash-tax', key: 'dismissedAt' } as const, -1)
const isArmed = atom({ plugin: 'cash-tax', key: 'isArmed' } as const, false)

type $ = EngineInterface

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)

type Cfg = { ttlMin: number; readRate: number; maxPings: number; pingLeadMs: number }

// Module state: lost on a hot reload, which only means one missed ping window.
const flags = { isTurnRunning: false, isPinging: false }

async function keepWarm($: $, cfg: Cfg): Promise<void> {
  const { ttlMin, readRate, maxPings, pingLeadMs } = cfg
  const w = await read($, warm)
  const hit = await read($, lastHit)
  const t = await $.clock.now()
  if (!w.isOn || flags.isTurnRunning || flags.isPinging || hit === 0) return
  if (t - hit < ttlMin * 60_000 - pingLeadMs) return
  flags.isPinging = true
  try {
    const reply = await $.model.fork({ prompt: 'Cache keep-alive ping. Reply with the single word: ok' })
    if (!reply.isAnswered && reply.reason === 'nothing-to-fork') return
    const cached = reply.usage?.cache_read_input_tokens ?? 0
    const at = await $.clock.now()
    await update($, lastHit, () => at)
    const next = await update($, warm, cur => ({ ...cur, pings: cur.pings + 1, readTokens: cur.readTokens + cached }))
    if (cached === 0) $.ui.toast('Cash Tax: the keep-warm ping found no cache to read; it had already gone cold.')
    if (next.pings >= maxPings) {
      await update($, warm, cur => ({ ...cur, isOn: false }))
      $.ui.toast(`Cash Tax: keep-warm stopped after ${next.pings} pings (${usd(next.readTokens, readRate)} in cache reads).`)
    }
  } finally {
    flags.isPinging = false
  }
}

export const register: Register = (on, options) => {
  const ttlMin = num(options.ttlMinutes, 60)
  const warnMin = Math.min(num(options.warnMinutes, 10), ttlMin)
  const writeRate = num(options.writePerMTok, 8)
  const readRate = num(options.readPerMTok, 0.2)
  const minTokens = num(options.minTokens, 30_000)
  const confirmCold = options.confirmCold !== false
  const maxPings = Math.max(1, num(options.maxPings, 6))
  // Ping this long before expiry; never less than a minute of margin.
  const pingLeadMs = Math.max(60_000, Math.min(5 * 60_000, ttlMin * 60_000 * 0.2))
  const cfg: Cfg = { ttlMin, readRate, maxPings, pingLeadMs }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache alive while you are away (costs a cache read per ping)' })
    await $.command.register({ name: 'cashtax', description: 'Show what the next message would cost if the cache went cold' })
    const started = await $.clock.now()
    await update($, now, () => started)
    $.clock.every(30_000, () => {
      void (async () => {
        const t = await $.clock.now()
        await update($, now, () => t)
        await keepWarm($, cfg)
      })()
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    flags.isTurnRunning = true
    await update($, isArmed, () => false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      flags.isTurnRunning = false
      const usage = await $.session.usage()
      const at = await $.clock.now()
      await update($, tokens, () => usage.context.tokens ?? 0)
      await update($, lastHit, () => at)
    }
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (!confirmCold || e.origin.kind !== 'composer' || e.turnId !== undefined) return next(e)
    const hit = await read($, lastHit)
    const size = await read($, tokens)
    const idle = (await $.clock.now()) - hit
    if (hit === 0 || size < minTokens || phase(idle, ttlMin, warnMin) !== 'cold') return next(e)
    if (await read($, isArmed)) {
      await update($, isArmed, () => false)
      return next(e)
    }
    await update($, isArmed, () => true)
    const text = e.text
    $.clock.after(150, () => {
      void $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)
    })
    return {
      drop:
        `Cash Tax: the cache went cold ${mins(idle - ttlMin * 60_000)} ago. Sending re-reads ${kTokens(size)} tokens ` +
        `at full price: about ${usd(size, writeRate)} (warm would be ${usd(size, readRate)}). ` +
        'Your message is back in the box: press Enter to send it anyway, or /compact first to shrink it.',
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'keepwarm' }, async $ => {
    const w = await update($, warm, cur => ({ isOn: !cur.isOn, pings: 0, readTokens: cur.isOn ? cur.readTokens : 0 }))
    const size = await read($, tokens)
    return {
      text: w.isOn
        ? `Keep-warm on: one ping ${mins(pingLeadMs)} before each expiry, at most ${maxPings}. ` +
          `Each ping reads ~${kTokens(size)} tokens from cache (~${usd(size, readRate)}); not zero tokens, but a cold reload would be ~${usd(size, writeRate)}. Run /keepwarm again to stop.`
        : 'Keep-warm off.',
    }
  })

  on('command.run', { command: 'cashtax' }, async $ => {
    const size = await read($, tokens)
    const hit = await read($, lastHit)
    const idle = hit === 0 ? 0 : (await $.clock.now()) - hit
    const left = ttlMin * 60_000 - idle
    return {
      text:
        `Context: ${kTokens(size)} tokens. Cache ${left > 0 ? `expires in ${mins(left)}` : `expired ${mins(-left)} ago`} (lifetime ${ttlMin} min). ` +
        `Next message warm: ~${usd(size, readRate)}; cold: ~${usd(size, writeRate)}. API-equivalent prices; on a subscription it is usage, not cash.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hit = await read($, lastHit)
    const size = await read($, tokens)
    const t = await read($, now)
    if (e.props.hasSurvey || e.props.isWorking || hit === 0 || size < minTokens) return next(e)
    const idle = t - hit
    const p = phase(idle, ttlMin, warnMin)
    if (p === 'fresh' || (await read($, dismissedAt)) === hit) return next(e)
    const w = await read($, warm)
    const { Box, Button, Text } = $.ui.resolve(e)
    const left = ttlMin * 60_000 - idle

    return (
      <Box gap={1} flexWrap="wrap">
        <Text color={p === 'cold' ? 'red' : 'yellow'} bold>
          {p === 'cold' ? `$ Cache cold ${mins(-left)}` : `$ Cache cools in ${mins(left)}`}
        </Text>
        <Text>
          next message re-reads {kTokens(size)} tokens ≈ {usd(size, writeRate)}
        </Text>
        <Text dimColor>(warm {usd(size, readRate)})</Text>
        {p === 'cooling' && (
          <Button
            key="warm"
            label={w.isOn ? `keeping warm (${w.pings}/${maxPings})` : 'Keep warm'}
            variant={w.isOn ? 'secondary' : 'primary'}
            onPress={() => update($, warm, cur => ({ isOn: !cur.isOn, pings: 0, readTokens: cur.isOn ? cur.readTokens : 0 }))}
          />
        )}
        <Button key="dismiss" plain label="✕" onPress={() => update($, dismissedAt, () => hit)} />
      </Box>
    )
  })
}
