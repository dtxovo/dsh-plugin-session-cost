/**
 * Session cost — host half.
 *
 * Two jobs.
 *
 * **Fold the log into per-tier token totals.** DeepSeek bills `deepseek-flash`
 * at two rates: peak (Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00,
 * excluding Chinese public holidays) and off-peak (everything else). Which rate
 * a token was billed at depends on *when its request ran*, so the split cannot
 * be read off an aggregate counter — it has to be folded event by event, where
 * each settlement still carries its own timestamp. That is why pricing lives
 * here rather than in the browser.
 *
 * The fold mirrors `dsh-token-meter`'s `tokenUsage` unit rule for rule: the last
 * usage sample of a step replaces any earlier sample of the same turn/step, an
 * `llm/retry-started` inside that step clears the slot, and an
 * `assistant/message` without `usage` falls back to the last `usage` chunk in
 * its embedded stream. Token totals therefore agree with the shipped usage pill.
 *
 * **Price them.** The rate table stays in this half, so a rate change is a
 * config edit. Because prices are applied in the *view* and never stored in the
 * fold state, changing a rate cannot invalidate a persisted checkpoint.
 *
 * @module dsh-plugin-session-cost
 */
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-cost'

/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Rate table. The four bare fields are the OFF-PEAK price of each bucket;
 * `peak` overrides the peak row and defaults to exactly twice off-peak, which is
 * DeepSeek's published relationship. `holidays` lists Beijing calendar dates
 * (YYYY-MM-DD) billed off-peak all day.
 */
export const Config = z.object({
  currency: z.string(),
  per: z.number(),
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  peak: z.object({
    input: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    output: z.number(),
  }),
  holidays: z.array(z.string()),
})

/**
 * DeepSeek `deepseek-flash` off-peak list prices, CNY per million tokens,
 * copied from the official pricing page
 * (api-docs.deepseek.com/zh-cn/quick_start/pricing) on 2026-10-15.
 *
 * DeepSeek does not bill cache writes separately, hence 0 rather than a price.
 * Only `deepseek-flash` is covered; another model needs its own numbers here.
 */
const DEFAULT_OFF_PEAK = {
  currency: '¥',
  per: 1_000_000,
  input: 1,
  cacheRead: 0.02,
  cacheWrite: 0,
  output: 4,
}

/** Beijing is UTC+8 with no daylight saving, so wall-clock fields are UTC fields of a shifted instant. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** Peak windows in Beijing hours, as `[startInclusive, endExclusive)` pairs. */
const PEAK_WINDOWS = [[9, 12], [14, 18]]

/** The four token buckets this plugin bills, in display order. */
const BUCKETS = ['miss', 'hit', 'write', 'output']

/** A zeroed bucket record. */
const zeroBuckets = () => ({ miss: 0, hit: 0, write: 0, output: 0 })

const bucketSchema = zod.object({
  miss: zod.number().nonnegative(),
  hit: zod.number().nonnegative(),
  write: zod.number().nonnegative(),
  output: zod.number().nonnegative(),
}).strict()

const tierStateSchema = bucketSchema.extend({ requests: zod.number().int().nonnegative() }).strict()

const stateSchema = zod.object({
  peak: tierStateSchema,
  offPeak: tierStateSchema,
  last: zod.object({
    turn: zod.number(),
    step: zod.number(),
    tier: zod.enum(['peak', 'offPeak']),
    buckets: bucketSchema,
  }).strict().nullable(),
}).strict()

const tierViewSchema = tierStateSchema.extend({ cost: zod.number().nonnegative() }).strict()

const rateSchema = zod.object({
  input: zod.number().nonnegative(),
  cacheRead: zod.number().nonnegative(),
  cacheWrite: zod.number().nonnegative(),
  output: zod.number().nonnegative(),
}).strict()

const viewSchema = zod.object({
  currency: zod.string(),
  per: zod.number().positive(),
  total: zod.number().nonnegative(),
  peak: tierViewSchema,
  offPeak: tierViewSchema,
  mixed: zod.boolean(),
  rates: zod.object({ peak: rateSchema, offPeak: rateSchema }).strict(),
}).strict()

/**
 * Whether one instant falls in a DeepSeek peak window.
 * @param time - epoch milliseconds of the settlement.
 * @param holidays - Beijing calendar dates billed off-peak all day.
 * @returns true when the request is billed at the peak rate.
 */
function isPeak(time, holidays) {
  const beijing = new Date(time + BEIJING_OFFSET_MS)
  const weekday = beijing.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  if (holidays.has(beijing.toISOString().slice(0, 10))) return false
  const hour = beijing.getUTCHours()
  return PEAK_WINDOWS.some(([from, to]) => hour >= from && hour < to)
}

/**
 * The provider usage one settlement reports, mirroring `dsh-token-meter`.
 * @param event - a committed `assistant/message` or `assistant/attempt`.
 * @returns the usage record, or undefined when the adapter reported none.
 */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  let found
  for (const record of event.data.stream ?? []) {
    const chunk = record.chunk ?? record
    if (chunk.type === 'usage') found = chunk
  }
  return found?.usage
}

/** Normalize one provider usage record into this plugin's buckets. */
function bucketsFrom(usage) {
  return {
    miss: usage.inputTokens ?? 0,
    hit: usage.cacheReadTokens ?? 0,
    write: usage.cacheWriteTokens ?? 0,
    output: usage.outputTokens ?? 0,
  }
}

/** Whether two bucket records are identical, so the fold can return the same state reference. */
function bucketsEqual(left, right) {
  return BUCKETS.every(bucket => left[bucket] === right[bucket])
}

/** Add one record into a running total, in place. */
function addInto(target, source) {
  for (const bucket of BUCKETS) target[bucket] += source[bucket]
}

/** Subtract one record from a running total, in place. */
function subtractFrom(target, source) {
  for (const bucket of BUCKETS) target[bucket] -= source[bucket]
}

/** Bill one bucket record. */
function costOf(buckets, rates, per) {
  return (buckets.miss * rates.input
    + buckets.hit * rates.cacheRead
    + buckets.write * rates.cacheWrite
    + buckets.output * rates.output) / per
}

/**
 * Narrow a rate table to the four billable fields. The off-peak table also
 * carries `currency` and `per`, which `rateSchema` rejects as unknown keys, so
 * the wire view must not forward the table verbatim.
 */
function rateRow(rates) {
  return {
    input: rates.input,
    cacheRead: rates.cacheRead,
    cacheWrite: rates.cacheWrite,
    output: rates.output,
  }
}

/**
 * Resolve the effective rate table: config wins per field, off-peak defaults
 * otherwise, and peak defaults to twice the off-peak row.
 * @param config - the loader entry's validated config, or undefined.
 * @returns off-peak rates, peak rates, and the holiday set.
 */
function resolveRates(config) {
  const offPeak = { ...DEFAULT_OFF_PEAK }
  if (config != null) {
    for (const key of Object.keys(DEFAULT_OFF_PEAK)) {
      if (config[key] !== undefined) offPeak[key] = config[key]
    }
  }
  const override = config?.peak
  const peak = {
    input: override?.input ?? offPeak.input * 2,
    cacheRead: override?.cacheRead ?? offPeak.cacheRead * 2,
    cacheWrite: override?.cacheWrite ?? offPeak.cacheWrite * 2,
    output: override?.output ?? offPeak.output * 2,
  }
  const holidays = new Set(Array.isArray(config?.holidays) ? config.holidays : [])
  return { offPeak, peak, holidays }
}

/**
 * Register the `sessionCost` projection unit.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - rate overrides and the holiday list for this profile.
 */
export function apply(ctx, config) {
  const { offPeak, peak, holidays } = resolveRates(config)

  ctx.sessionProjections.register({
    key: 'sessionCost',
    stateVersion: 1,
    stateSchema,
    init: () => ({
      peak: { ...zeroBuckets(), requests: 0 },
      offPeak: { ...zeroBuckets(), requests: 0 },
      last: null,
    }),
    apply: (state, event) => {
      if (event.type === 'llm/retry-started') {
        const last = state.last
        if (last === null || last.turn !== event.data.turn || last.step !== event.data.step) return state
        return { ...state, last: null }
      }
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
      const usage = usageOf(event)
      if (usage === undefined) return state

      const { turn, step } = event.data
      const tier = isPeak(event.time, holidays) ? 'peak' : 'offPeak'
      const buckets = bucketsFrom(usage)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : undefined
      if (previous !== undefined && previous.tier === tier && bucketsEqual(previous.buckets, buckets)) return state

      const nextPeak = { ...state.peak }
      const nextOffPeak = { ...state.offPeak }
      const tiers = { peak: nextPeak, offPeak: nextOffPeak }
      if (previous !== undefined) {
        subtractFrom(tiers[previous.tier], previous.buckets)
        tiers[previous.tier].requests -= 1
      }
      addInto(tiers[tier], buckets)
      tiers[tier].requests += 1
      return {
        peak: nextPeak,
        offPeak: nextOffPeak,
        last: { turn, step, tier, buckets },
      }
    },
    wire: {
      viewSchema,
      view: (state) => {
        const per = offPeak.per > 0 ? offPeak.per : 1_000_000
        const peakView = { ...state.peak, cost: costOf(state.peak, peak, per) }
        const offPeakView = { ...state.offPeak, cost: costOf(state.offPeak, offPeak, per) }
        return {
          currency: offPeak.currency,
          per,
          total: peakView.cost + offPeakView.cost,
          peak: peakView,
          offPeak: offPeakView,
          mixed: peakView.requests > 0 && offPeakView.requests > 0,
          rates: { peak: rateRow(peak), offPeak: rateRow(offPeak) },
        }
      },
    },
  })
}
