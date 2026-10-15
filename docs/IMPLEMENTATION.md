# Implementation notes

Why this plugin is built the way it is, and which DeepSeek Harness internals shaped it.
For what it does and how to configure it, see the [README](../README.md).

## Where the numbers come from

**The durable log, not the screen.** The host half registers a session projection
(`sessionCost`) that folds committed `assistant/message` and `assistant/attempt` events. It
reads the whole log rather than the loaded transcript, so paging, compaction, and resuming a
session cannot change the figure, and an inherited fork prefix is counted once.

**It mirrors `dsh-token-meter`'s `tokenUsage` unit rule for rule.** Token accounting has
non-obvious corners, and the shipped unit already settled them:

- a step's last usage sample replaces an earlier sample of the same turn/step, so a
  re-settled attempt is not billed twice;
- `llm/retry-started` clears that slot, so the retried attempt adds rather than replaces —
  both attempts really were billed;
- an `assistant/message` without `data.usage` falls back to the last `usage` chunk in its
  embedded stream.

Mirroring rather than re-deriving keeps this plugin's totals equal to the shipped usage pill.
Any future divergence is a bug in this fold, not a difference of opinion.

**Pricing cannot happen in the browser.** DeepSeek bills the same token differently depending
on *when its request ran*, and the four aggregate buckets carry no timestamps. The tier has to
be decided per settlement from `event.time`, which only a host-side fold can do. That is the
single reason the client half does not simply multiply two numbers.

## The pricing model

**Windows.** Peak is Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00, minus any dates
listed in `holidays`. Everything else is off-peak. Beijing is UTC+8 year round with no
daylight saving, so the classification shifts the instant by eight hours and reads the UTC
fields of the result — no locale database, no dependency on the host's time zone.

Note what the published rule does *not* say: weekends worked as make-up days stay off-peak,
because the rule looks only at Monday-Friday plus the holiday list.

**Rates.** The four bare config fields are the off-peak price of each bucket. Peak defaults to
exactly twice off-peak, which is DeepSeek's published relationship, and an explicit `peak`
block overrides it per field.

The buckets are treated as **additive components**: an uncached-input token, a cache-read
token, a cache-write token, and an output token are billed independently and summed. That is
consistent with how the same numbers are used elsewhere in DSH — `dsh-token-meter` computes
prompt-side pressure as `inputTokens + cacheReadTokens + cacheWriteTokens`, which only makes
sense if `inputTokens` excludes the cached traffic.

**Rates live in the view, not in the fold.** The projection's state holds token counts only;
the money is computed when the state is projected to its wire value. Two consequences: a rate
change needs no re-fold, and it cannot invalidate a persisted checkpoint.

## The client half

### Nothing is injected as CSS

`dsh-client-modules` adopts style tags at materialization:

```js
function claimStyles(id) {
  for (const el of document.querySelectorAll("style:not([data-plugin])"))
    el.setAttribute("data-plugin", id);
}
```

Its own comment states the rule: *"preset-emitted tags arrive pre-tagged with `data-plugin`;
any untagged tag is claimed for the materializing plugin."* `dsh-client-hmr` then removes a
plugin's adopted tags when that plugin reloads.

So an untagged `<style>` belongs to whichever plugin happens to materialize next, and dies
with it. An earlier version of this plugin injected one and lost it exactly that way: the pill
fell back to the browser's default `<button>` rendering. Every metric here is therefore an
inline style, and hover is React state (`onMouseEnter` / `onMouseLeave` / `onFocus` /
`onBlur`) rather than a `:hover` rule, for the same reason.

### Every custom property carries a fallback

The Theme Inspect provider reports 14 tokens for the current theme, and the shipped
`stat-dialog` and `TurnUsagePanel` stylesheets reference several tokens **outside** that set —
`--dsw-specific-menu`, `--dsw-elevation-prominent`, `--dsw-alias-interactive-bg-hover`,
`--dsw-alias-label-tertiary` among them.

A `var()` that resolves to nothing does not fall back to a default; it invalidates the whole
declaration. In practice that turned this plugin's popover background into `transparent` and
made its hover rule a no-op. Each of those references now names the shipped token first — so a
theme that gains the token matches the shipped dialog exactly — and a token that certainly
exists as the fallback.

The popover is the one place a fallback chain was not enough, so it paints **two layers**: an
opaque surface token as `backgroundColor`, with the menu tint as a `backgroundImage` gradient
above it. A gradient cannot be erased by a missing variable the way a single colour can, so
the worst case is a flat popover rather than a see-through one.

### Which surface it copies

The dock holds two visually different pills. The usage pill (`StatsPills`,
`.bOPqQW_pill`) pins its icon at 14px, pads `1px 8px`, rounds 24px, and takes its font from
`font: inherit`; `TurnUsagePanel`'s trigger uses a 15px + delta icon, `6px 8px` padding, a 28px
radius, and a fixed height. This entry sits beside the former, so it copies the former — an
earlier version copied the latter and read as noticeably heavier.

It also follows the same convention for content: the pill carries an icon and a value only,
and the wording lives in the popover title. Two Han glyphs weigh far more than digits at the
same size, and a word label made the pill the loudest thing in the row.

## Reload semantics

Both halves were measured against the running runtime, and neither behaves the way "just edit
the file" would suggest.

| Change | What it takes |
|---|---|
| `client.js` | The host re-reads the bytes on its own (a 500ms stat poll driving `clientModules.rebuilt`), but the browser needs a page refresh. `client-hmr`'s browser half locates its target with `entry.options.name === id`, and this plugin's loader entry is named by file URL (`./plugins/session-cost/host.js`) rather than by package name, so it never finds the entry and only logs a warning. |
| `host.js` | A **new entry id** in `cordis.patch.yml`, or a DSH restart. The loader re-imports a module only for a new entry, and ESM caches by URL — so editing the file, or changing the entry's `name`, imports nothing new. |

Neither limit applies to the profile's own config: `cordis.patch.yml` is watched, so a rate
change takes effect immediately.

## Testing

`check.mjs` renders the client half through a React stand-in covering exactly the API surface
the component uses (`createElement`, `useState`, `useRef`, `useEffect`, `useCallback`, and
`react-dom`'s `createPortal`). That is enough to assert the real markup and the real money
math, and — because effects never run — it also proves the panel stays hidden until it has
been measured instead of flashing at an unpositioned origin.

The 43 client assertions deliberately pin **mechanisms**, not snapshots: that no stylesheet is
injected, that the hover handlers exist and hovering changes the inline background, that the
popover paints an opaque base with a tinted gradient, and that the pill still carries the
metrics copied from the shipped surface. A snapshot would have gone stale silently through the
several visual revisions above; these fail loudly.

The 33 host assertions cover minute-level window boundaries (09:00 is peak, 08:59 is not,
12:00 is not, 18:00 is not, weekends are not, a configured holiday is), the fold and its
replacement rules, peak/off-peak migration when a resettled sample crosses a boundary, the
rate table, and the wire schema.

## Known gaps

- **One rate table, not one per model.** A session that switches models is priced with a single
  set of rates. Splitting it needs a model dimension the aggregate buckets do not carry.
- **Windows and holidays are configuration, not discovery.** The peak window is fixed in code;
  the holiday list is manual and needs annual upkeep.
- **Prices are list prices.** Nothing here reads an invoice, so a gateway on different terms
  will disagree.
