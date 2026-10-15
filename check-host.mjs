// Host-half checks: peak/off-peak classification, the fold, retry replacement,
// and the money in the wire view.
//
// The host half imports `@deepseek-ai/schemastery` and `zod`, which DeepSeek
// Harness supplies. Run this against an INSTALLED copy unless those resolve
// here:
//   node check-host.mjs "<profile>\plugins\session-cost\host.js"
import { pathToFileURL } from 'node:url'

/** Host half under test: an explicit path, or this package's own host half. */
const PLUGIN = process.argv[2] !== undefined
  ? pathToFileURL(process.argv[2]).href
  : new URL('./host.js', import.meta.url).href

let mod
try {
  mod = await import(PLUGIN)
} catch (error) {
  console.error('cannot import ' + PLUGIN)
  console.error(error.message)
  console.error('')
  console.error('The host half resolves @deepseek-ai/schemastery and zod from its own location.')
  console.error('Point this script at an installed copy instead, for example:')
  console.error('  node check-host.mjs "%DSH_PROFILE_DIR%\\plugins\\session-cost\\host.js"')
  process.exit(1)
}

const results = []
const check = (label, ok, detail) => {
  results.push([label, ok, detail])
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail === undefined ? '' : '   -> ' + detail))
}

/** Beijing wall-clock instant -> epoch ms. Beijing is UTC+8 year round. */
const bj = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi)

const events = []
const register = (config) => {
  let def
  mod.apply({ sessionProjections: { register: value => { def = value } } }, config)
  return def
}
const message = (turn, step, time, usage) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, usage, stream: [] }
})
const feed = (def, list) => list.reduce((state, event) => def.apply(state, event), def.init())

const def = register(undefined)
check('key is sessionCost', def.key === 'sessionCost', def.key)
check('stateVersion is 1', def.stateVersion === 1)

// --- peak windows, asserted through the fold (isPeak is not exported) ---
const tierOf = (time, holidays) => {
  const unit = register(holidays === undefined ? undefined : { holidays })
  const state = feed(unit, [message(1, 1, time, { inputTokens: 1, outputTokens: 0 })])
  return state.peak.requests === 1 ? 'peak' : 'offPeak'
}
// 2026-10-19 is a Monday; 2026-10-17 a Saturday.
check('Mon 09:00 Beijing (window start) is peak', tierOf(bj(2026, 10, 19, 9)) === 'peak')
check('Mon 08:59 Beijing is off-peak', tierOf(bj(2026, 10, 19, 8, 59)) === 'offPeak')
check('Mon 11:59 Beijing is peak', tierOf(bj(2026, 10, 19, 11, 59)) === 'peak')
check('Mon 12:00 Beijing (window end) is off-peak', tierOf(bj(2026, 10, 19, 12)) === 'offPeak')
check('Mon 13:00 Beijing (between windows) is off-peak', tierOf(bj(2026, 10, 19, 13)) === 'offPeak')
check('Mon 14:00 Beijing is peak', tierOf(bj(2026, 10, 19, 14)) === 'peak')
check('Mon 17:59 Beijing is peak', tierOf(bj(2026, 10, 19, 17, 59)) === 'peak')
check('Mon 18:00 Beijing (window end) is off-peak', tierOf(bj(2026, 10, 19, 18)) === 'offPeak')
check('Sat 10:00 Beijing is off-peak', tierOf(bj(2026, 10, 17, 10)) === 'offPeak')
check('Sun 10:00 Beijing is off-peak', tierOf(bj(2026, 10, 18, 10)) === 'offPeak')
check('configured holiday is off-peak all day', tierOf(bj(2026, 10, 19, 10), ['2026-10-19']) === 'offPeak')
check('a different holiday date does not leak', tierOf(bj(2026, 10, 19, 10), ['2026-10-20']) === 'peak')

// --- the fold, with the real session shape ---
const fold = register({ holidays: [] })
const state = feed(fold, [
  message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 1000000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1000000 }),
  message(1, 2, bj(2026, 10, 19, 20), { inputTokens: 0, cacheReadTokens: 2000000, cacheWriteTokens: 0, outputTokens: 0 })
])
check('peak request counted', state.peak.requests === 1, JSON.stringify(state.peak))
check('off-peak request counted', state.offPeak.requests === 1, JSON.stringify(state.offPeak))
check('peak bucket split is right', state.peak.miss === 1000000 && state.peak.output === 1000000)
check('off-peak bucket split is right', state.offPeak.hit === 2000000)

const view = fold.wire.view(state)
check('view passes its own schema', JSON.stringify(fold.wire.viewSchema.parse(view)) === JSON.stringify(view))
check('peak cost uses peak rates (2 and 8)', Math.abs(view.peak.cost - 10) < 1e-9, '¥' + view.peak.cost)
check('off-peak cost uses off-peak rate (0.02)', Math.abs(view.offPeak.cost - 0.04) < 1e-9, '¥' + view.offPeak.cost)
check('total is the sum', Math.abs(view.total - 10.04) < 1e-9, '¥' + view.total)
check('mixed flags two tiers', view.mixed === true)

// --- replacement rules ---
const replace = register()
const once = feed(replace, [message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 100, outputTokens: 10 })])
const twice = replace.apply(once, message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 100, outputTokens: 10 }))
check('an identical repeat returns the same state reference', twice === once)
const replaced = feed(replace, [
  message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 100, outputTokens: 10 }),
  message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 100, outputTokens: 10 })
])
check('a changed sample for the same step replaces it', replaced.peak.miss === 100 && replaced.peak.requests === 1,
  JSON.stringify(replaced.peak))

const retried = feed(register(), [
  message(2, 1, bj(2026, 10, 19, 10), { inputTokens: 500, outputTokens: 50 }),
  { type: 'llm/retry-started', time: bj(2026, 10, 19, 10), data: { turn: 2, step: 1 } },
  message(2, 1, bj(2026, 10, 19, 10), { inputTokens: 700, outputTokens: 70 })
])
check('a retried attempt adds instead of replacing', retried.peak.miss === 1200 && retried.peak.requests === 2,
  JSON.stringify(retried.peak))

const crossed = feed(register(), [
  message(3, 1, bj(2026, 10, 19, 10), { inputTokens: 900, outputTokens: 0 }),
  message(3, 1, bj(2026, 10, 19, 20), { inputTokens: 900, outputTokens: 0 })
])
check('a sample that moves tier leaves the old tier', crossed.peak.miss === 0 && crossed.peak.requests === 0,
  JSON.stringify(crossed.peak))
check('a sample that moves tier lands in the new tier', crossed.offPeak.miss === 900 && crossed.offPeak.requests === 1,
  JSON.stringify(crossed.offPeak))

// --- usage fallback: no data.usage, only a usage chunk in the stream ---
const fromStream = feed(register(), [{
  type: 'assistant/message',
  time: bj(2026, 10, 19, 20),
  data: {
    turn: 4, step: 1,
    stream: [{ type: 'chunk', chunk: { type: 'text-delta', text: 'x' } },
             { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 42, outputTokens: 7 } } }]
  }
}])
check('usage falls back to the stream chunk', fromStream.offPeak.miss === 42 && fromStream.offPeak.output === 7,
  JSON.stringify(fromStream.offPeak))

// --- config: explicit peak override, and a rate change not touching the fold ---
const overridden = register({ peak: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 } })
const overriddenView = overridden.wire.view(feed(overridden, [
  message(1, 1, bj(2026, 10, 19, 10), { inputTokens: 1000000, outputTokens: 0 })
]))
check('an explicit peak row overrides the 2x default', Math.abs(overriddenView.peak.cost - 5) < 1e-9, '¥' + overriddenView.peak.cost)

const oldFold = feed(def, [message(1, 1, bj(2026, 10, 19, 20), { inputTokens: 1000000, outputTokens: 0 })])
const repriced = register({ input: 3 }).wire.view(oldFold)
check('the same fold state re-prices under new config', Math.abs(repriced.total - 3) < 1e-9, '¥' + repriced.total)
check('the default config prices it at 1', Math.abs(def.wire.view(oldFold).total - 1) < 1e-9,
  '¥' + def.wire.view(oldFold).total)

// --- rejected config surfaces ---
let rejected = false
try { def.wire.viewSchema.parse({ ...view, per: -1 }) } catch { rejected = true }
check('a negative per is rejected', rejected)

const passed = results.filter(([, ok]) => ok).length
console.log('\n' + passed + '/' + results.length + ' host checks passed')
process.exit(passed === results.length ? 0 : 1)
