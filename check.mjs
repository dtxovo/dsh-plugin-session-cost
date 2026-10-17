// Renders the session-cost client half with a minimal React stand-in, so the
// markup, both tier layouts, hover behaviour, and every branch are verified
// without a browser.
//
// The stand-in covers exactly the React surface the component uses:
// createElement, useState, useRef, useEffect, useCallback, plus react-dom's
// createPortal. Effects never run, which also proves the panel stays hidden
// until it has been measured rather than flashing at an unpositioned origin.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Bundle under test: an explicit path, or this package's own client half. */
const BUNDLE = process.argv[2] ?? fileURLToPath(new URL('./client.js', import.meta.url))
/**
 * The manifest beside the bundle. `dsh-client-modules` rejects a bundle whose
 * registered id differs from the package name, so the two are asserted equal
 * rather than hardcoded: renaming the package once produced a mismatch.
 */
const MANIFEST = JSON.parse(readFileSync(join(dirname(BUNDLE), 'package.json'), 'utf8'))

/** React prop name -> DOM attribute, for the few that differ. */
const ATTRIBUTE = { className: 'class', htmlFor: 'for' }

/** Minimal createElement: flattens children and drops null/false like React does. */
function createElement(type, props, ...children) {
  return {
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true)
  }
}

/** Render a tree to a string; function components are called with their props. */
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node.type === 'function') return render(node.type(node.props))
  const attrs = Object.entries(node.props)
    .filter(([key]) => key !== 'key' && key !== 'children' && key !== 'ref')
    .map(([key, value]) => {
      const name = ATTRIBUTE[key] ?? key
      if (typeof value === 'function') return ` ${name}="[fn]"`
      if (value === true) return ` ${name}`
      if (value !== null && typeof value === 'object') return ` ${name}='${JSON.stringify(value)}'`
      return ` ${name}="${value}"`
    })
    .join('')
  return `<${node.type}${attrs}>${node.children.map(render).join('')}</${node.type}>`
}

let captured
globalThis.window = { __ModuleLoader__: { load: entry => { captured = entry } } }
/** Document stub: the createPortal target, plus a head that must stay untouched. */
const headNodes = []
globalThis.document = {
  body: { tag: 'body' },
  head: { appendChild: node => headNodes.push(node) },
  addEventListener: () => {},
  removeEventListener: () => {}
}
new Function(readFileSync(BUNDLE, 'utf8'))()
console.log('bundle id:', captured.id)

// The component's boolean states, in hook-call order: [open, hover]. Anything
// else (the panel position) keeps its real initial value.
let booleanQueue = []
let booleanCursor = 0
const reactStub = {
  createElement,
  useState: initial => {
    if (typeof initial !== 'boolean') return [initial, () => {}]
    const forced = booleanQueue[booleanCursor++]
    return [forced === undefined ? initial : forced, () => {}]
  },
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useCallback: fn => fn
}
const required = []
const mod = captured.factory(name => {
  required.push(name)
  if (name === 'react') return reactStub
  if (name === 'react-dom') return { createPortal: node => node }
  throw new Error('unexpected require: ' + name)
})

let slotName, slotOptions, Component
const ctx = {
  effect: fn => { fn(); return () => {} },
  locale: {
    register: (ns, dict) => {
      const zh = Object.keys(dict.zh).sort().join(',')
      const en = Object.keys(dict.en).sort().join(',')
      console.log('locale ns:', ns, '| zh and en declare identical key sets:', zh === en, '| keys:', Object.keys(dict.zh).length)
      return () => {}
    }
  },
  slots: {
    inject: (name, cb) => { slotName = name; cb(); return () => {} },
    register: (options, component) => { slotOptions = options; Component = component; return () => {} }
  }
}
mod.apply(ctx)
console.log('registered -> slot:', slotName, '| id:', slotOptions.id, '| order:', slotOptions.order, '| locale:', slotOptions.locale)

const rates = {
  peak: { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 0, output: 4 }
}
/** The real session: everything off-peak. */
const single = {
  currency: '¥', per: 1000000, total: 1.08526892, mixed: false, rates,
  peak: { miss: 0, hit: 0, write: 0, output: 0, requests: 0, cost: 0 },
  offPeak: { miss: 187431, hit: 20772096, write: 0, output: 120599, requests: 110, cost: 1.08526892 }
}
/** A session that spans both windows. */
const mixed = {
  currency: '¥', per: 1000000, total: 3.3, mixed: true, rates,
  peak: { miss: 1000000, hit: 0, write: 0, output: 100000, requests: 3, cost: 2.8 },
  offPeak: { miss: 0, hit: 5000000, write: 0, output: 100000, requests: 7, cost: 0.5 }
}
const empty = {
  currency: '¥', per: 1000000, total: 0, mixed: false, rates,
  peak: { miss: 0, hit: 0, write: 0, output: 0, requests: 0, cost: 0 },
  offPeak: { miss: 0, hit: 0, write: 0, output: 0, requests: 0, cost: 0 }
}

const dict = {
  'cost.label': '花费', 'cost.title': '标题',
  'tier.peak': '高峰时段', 'tier.offPeak': '空闲时段', 'tier.requests': '{count} 次请求',
  'tier.peak.hint': 'PEAKHINT', 'tier.offPeak.hint': 'OFFPEAKHINT',
  'row.miss': '未缓存输入', 'row.hit': '缓存读取', 'row.write': '缓存写入', 'row.output': '输出',
  'row.subtotal': '小计', 'value.tokens': '{tokens} tok'
}
const fakeT = (key, params) => {
  let text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
  if (params != null) for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]))
  return text
}

/** Render the component with the open/hover state it would have at runtime. */
const draw = (value, options = {}) => {
  booleanQueue = [options.open === true, options.hover === true]
  booleanCursor = 0
  return render(Component({ useProjection: () => value, t: fakeT }))
}
const drawNoSeat = options => {
  booleanQueue = [options.open === true, options.hover === true]
  booleanCursor = 0
  return render(Component({ useProjection: () => single }))
}

const collapsed = draw(single)
const hovered = draw(single, { hover: true })
const expanded = draw(single, { open: true })
const mixedExpanded = draw(mixed, { open: true })
const emptyCollapsed = draw(empty)
const noSeatExpanded = drawNoSeat({ open: true })
booleanQueue = [false, false]
booleanCursor = 0
const noSeat = render(Component({ useProjection: () => single }))
const inert = render(Component({ useProjection: () => undefined, t: fakeT }))

const HOVER_BG = '"background":"var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2))"'

console.log('\n--- collapsed ---\n' + collapsed)
console.log('\n--- hovered trigger ---\n' + hovered.slice(0, 320))
console.log('\n--- expanded (both tiers) ---\n' + mixedExpanded)

const checks = [
  ['trigger is a native-shaped button pill', collapsed.includes('class="dsc-trigger"') && collapsed.includes('aria-haspopup="dialog"')],
  ['trigger carries the shared 15px icon slot', collapsed.includes('<svg') && collapsed.includes('viewBox="0 0 16 16"')],
  ['trigger shows the bare amount, as the usage pill does', collapsed.includes('>¥1.09<') && !collapsed.includes('花费')],
  ['collapsed renders no panel', !collapsed.includes('dsc-panel')],

  ['expanded adds the dialog panel', expanded.includes('class="dsc-panel"') && expanded.includes('role="dialog"')],
  ['panel stays hidden until measured', expanded.includes('"visibility":"hidden"')],
  ['panel title carries the label and the total', expanded.includes('dsc-titleLabel') && expanded.includes('>花费</span>') && expanded.includes('>¥1.09</span>')],
  ['panel has the title rule divider', expanded.includes('class="dsc-titleRule"')],
  ['panel uses the native two-column details grid', expanded.includes('<dl class="dsc-details"') && expanded.includes('>未缓存输入</dt>') && expanded.includes('>187K tok · ¥0.187</dd>')],
  ['details price the cache reads at the off-peak rate', expanded.includes('>20.77M tok · ¥0.415</dd>')],
  ['details price the output bucket', expanded.includes('>121K tok · ¥0.482</dd>')],
  ['details hide the zero cache-write bucket', !expanded.includes('缓存写入')],
  ['a single tier omits the subtotal', !expanded.includes('小计')],
  ['a single tier names itself with its request count', expanded.includes('空闲时段 · 110 次请求')],
  ['the tier header carries its window as a tooltip', expanded.includes('OFFPEAKHINT')],

  ['mixed names both tiers', mixedExpanded.includes('高峰时段 · 3 次请求') && mixedExpanded.includes('空闲时段 · 7 次请求')],
  ['mixed prices peak tokens at peak rates', mixedExpanded.includes('>1.00M tok · ¥2.00</dd>')],
  ['mixed prices peak output at peak rates', mixedExpanded.includes('>100K tok · ¥0.800</dd>')],
  ['mixed prices off-peak tokens at off-peak rates', mixedExpanded.includes('>5.00M tok · ¥0.100</dd>')],
  ['mixed gives each tier a subtotal', (mixedExpanded.match(/小计/g) ?? []).length === 2],
  ['mixed shows both subtotals', mixedExpanded.includes('>¥2.80<') && mixedExpanded.includes('>¥0.500<')],
  ['mixed still shows one grand total', mixedExpanded.includes('>¥3.30</span>')],

  ['zero usage renders ¥0', emptyCollapsed.includes('>¥0<')],
  ['zero usage drops the panel rows', !draw(empty, { open: true }).includes('<dt')],

  ['missing locale seat still renders Chinese', noSeat.includes('花费') && noSeatExpanded.includes('空闲时段')],
  ['missing locale seat does not leak raw keys', !noSeat.includes('cost.label') && !noSeatExpanded.includes('tier.')],
  ['absent projection renders nothing', inert === ''],
  ['requires only platform-seeded modules', [...required].sort().join(',') === 'react,react-dom'],
  ['the bundle id equals the package name', captured.id === MANIFEST.name],

  ['trigger mirrors the sibling usage pill, not the taller one', ['"borderRadius":"24px"', '"padding":"1px 8px"', '"gap":"6px"', '"fontSize":"12px"', '"lineHeight":"18px"', '"display":"inline-flex"'].every(d => collapsed.includes(d))],
  ['the trigger sets no fixed height', !collapsed.includes('"height":"2')],
  ['the trigger takes the app font instead of the UA button font', collapsed.includes('"fontFamily":"inherit"') && collapsed.includes('"fontWeight":"inherit"')],
  ['the pill icon is stepped down to 13px', collapsed.includes('"width":"13px"') && collapsed.includes('"height":"13px"')],
  ['panel keeps the native metrics inline', ['"borderRadius":"12px"', '"padding":"16px"', '"maxWidth":"min(440px, 100vw - 24px)"'].every(d => expanded.includes(d))],
  ['the details grid is inline', expanded.includes('"display":"grid"') && expanded.includes('"gridTemplateColumns":"minmax(76px,auto) minmax(0,1fr)"')],

  ['injects no stylesheet at all', headNodes.length === 0],
  ['the resting trigger is transparent', collapsed.includes('"background":"none"')],
  ['hover fills the trigger', hovered.includes(HOVER_BG)],
  ['an open trigger stays filled', expanded.includes(HOVER_BG)],
  ['hover is wired to pointer state, not to CSS', ['onMouseEnter="[fn]"', 'onMouseLeave="[fn]"', 'onFocus="[fn]"', 'onBlur="[fn]"'].every(d => collapsed.includes(d))],
  ['the popover paints an opaque base layer', expanded.includes('"backgroundColor":"var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))"')],
  ['the menu tint rides a gradient, so a missing token cannot erase the base', expanded.includes('"backgroundImage":"linear-gradient(var(--dsw-specific-menu, transparent), var(--dsw-specific-menu, transparent))"')],
  ['the elevation has a fallback shadow', expanded.includes('"boxShadow":"var(--dsw-elevation-prominent, 0 10px 30px rgb(0 0 0 / 0.35), 0 0 0 1px var(--dsw-alias-border-l1))"')],
  ['label colours carry fallbacks', collapsed.includes('var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))')]
]

console.log('')
let passed = 0
for (const [label, ok] of checks) {
  if (ok) passed += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
}
console.log('\n' + passed + '/' + checks.length + ' client checks passed')
process.exit(passed === checks.length ? 0 : 1)
