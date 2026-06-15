# Contribution / Blogpost Counter Widget — Design

**Status:** Approved (2026-06-15)

**Goal:** An old-school Fallout/Pip-Boy odometer counter shown next to each activity heatmap that
animates up from 0 (accelerating) to a live count — contributions over the last 6 months on the
Contributions page, and blogposts over the last 30 days on the Blogs index.

## Context

Two pages render the shared `Heatmap.astro`:
- `src/pages/contributions.astro` — has `data.prs` (PRs over the last 6 months, the same set the
  "CONTRIBUTIONS · LAST 6 MONTHS" pane lists) and a 5-week commits+PRs heatmap.
- `src/pages/index.astro` — has all `posts` and a 5-week posting heatmap.

The engine renders heatmaps server-side; decorative motion lives in client-side islands that
respect `prefers-reduced-motion`. The counter follows the same progressive-enhancement pattern.

## Decisions (locked)

1. **Contributions metric:** `data.prs.length` — PRs over the last 6 months (consistent with the
   existing pane; the commits/events API can't honestly span 6 months, so commits are excluded).
   The PR search is capped at 100 by the API, so the counter caps at 100.
2. **Blog metric:** posts dated within the **last 30 days** (rolling window, `≤ today`).
3. **Style:** odometer — a fixed-width row of zero-padded digit cells (bordered boxes, Pip-Boy
   green with a glow), caption above.
4. **Animation:** **ease-in** (accelerating). Displayed value = `round(target · t²)` for `t: 0→1`
   over ~1.8s via `requestAnimationFrame`. `prefers-reduced-motion` → show the final value with no
   animation.
5. **Layout:** the counter sits to the **right** of the heatmap (top-aligned), wrapping **below**
   on narrow screens. Same on both pages.
6. **No config toggle:** the counter always renders (it is informative, not purely decorative);
   only the animation is gated by reduced-motion.

## Components

### A. `src/lib/counter.ts` (pure, unit-tested)

- `countInWindow(dates: string[], now: Date, days: number): number` — counts `YYYY-MM-DD` dates
  within `[now - days, now]` inclusive; ignores future-dated entries and malformed dates.
- `easeInValue(target: number, progress: number): number` — `round(target · progress²)`, clamped
  so `progress ≤ 0 → 0` and `progress ≥ 1 → target` (exact endpoints).
- `padDigits(n: number, width: number): string` — zero-pads `n` to `width` (e.g. `padDigits(42,4)`
  → `"0042"`); if `n` has more digits than `width`, returns the full number.

### B. `src/components/CounterWidget.astro`

Props:
- `value: number` (target; SSR renders this)
- `label: string` (caption)
- `durationMs?: number` (default `1800`)
- `digits?: number` (default `Math.max(2, String(value).length)`)

Markup: a `.counter` container carrying `data-counter-value`, `data-counter-duration`, and
`data-counter-digits`; the caption; and a row of `digits` `.counter-digit` cells, each SSR-rendered
with the corresponding digit of `padDigits(value, digits)`. Odometer styling (bordered cells,
monospace, accent color + glow) is scoped to the component.

Client `<script>` (imports `easeInValue` + `padDigits` from `src/lib/counter.ts`): for each
`.counter`, if `matchMedia('(prefers-reduced-motion: reduce)').matches`, leave the SSR value.
Otherwise reset cells to 0 and animate with `requestAnimationFrame`: each frame compute
`progress = min(1, elapsed/duration)`, `shown = easeInValue(value, progress)`, then write
`padDigits(shown, digits)` across the cells; add a brief glow class to a cell whose digit changed.
Stop at `progress >= 1` (cells show the exact target).

### C. Page wiring

- `contributions.astro`: wrap the existing `<Heatmap/>` and a new
  `<CounterWidget value={data.prs.length} label="CONTRIB // LAST 6 MO" />` in a flex
  `.heat-block` row.
- `index.astro`: `import { countInWindow } from '../lib/counter'`; compute
  `const postsLast30 = countInWindow(posts.map((p) => p.date), now, 30)`; wrap `<Heatmap/>` and
  `<CounterWidget value={postsLast30} label="POSTS // LAST 30 DAYS" />` in the same `.heat-block`
  row.

The `.heat-block` flex wrapper (heatmap flex-grow, counter auto, `flex-wrap: wrap` for mobile) is
defined once in the shared global stylesheet so both pages share it.

## Edge cases

- **Zero** value → all cells `0` (e.g. `00`), no animation movement; renders fine.
- **Reduced motion / no-JS** → SSR shows the exact final value.
- **Value wider than `digits`** → `padDigits` returns the full number (no truncation); default
  `digits` is derived from the value so this only happens with an explicit small `digits`.
- **Contributions cap** → at most 100 (API page size); acceptable and documented.

## Testing / verification

- Vitest unit tests for `countInWindow` (inclusive bounds, future-dated ignored, malformed
  ignored, empty → 0), `easeInValue` (0 at start, target at end, monotonic, rounding), and
  `padDigits` (pad, exact width, overflow).
- Build passes; existing suite stays green.
- Live check: both pages render the odometer beside the heatmap; it counts up accelerating to the
  correct number; reduced-motion shows the final value immediately; layout stacks on a narrow
  viewport.
