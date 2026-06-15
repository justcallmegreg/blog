# Contribution / Blogpost Counter Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fallout/Pip-Boy odometer counter beside each activity heatmap that animates up from 0 (accelerating) to a live count — PRs over the last 6 months on Contributions, posts over the last 30 days on the Blogs index.

**Architecture:** Pure count/easing/padding helpers in `src/lib/counter.ts` (unit-tested); a reusable `CounterWidget.astro` that SSR-renders the final value as zero-padded digit cells and progressively enhances with a `requestAnimationFrame` ease-in count-up (reduced-motion → static); both pages wrap their `<Heatmap/>` + `<CounterWidget/>` in a shared `.heat-block` flex row.

**Tech Stack:** Astro 5 SSR + client islands, TypeScript, Vitest. CSS vars from `src/styles/theme.css` (`--accent` `#b6ff00`).

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/counter.ts` (create) | Pure helpers: `countInWindow`, `easeInValue`, `padDigits`. |
| `test/lib/counter.test.ts` (create) | Vitest unit tests for the three helpers. |
| `src/components/CounterWidget.astro` (create) | Odometer component: SSR digit cells + ease-in count-up script. |
| `src/styles/theme.css` (modify) | Add the `.heat-block` flex wrapper (shared by both pages). |
| `src/pages/contributions.astro` (modify) | Wrap Heatmap + `<CounterWidget value={data.prs.length} …>`. |
| `src/pages/index.astro` (modify) | Compute 30-day post count; wrap Heatmap + `<CounterWidget …>`. |

---

## Task 1: Pure helpers in `src/lib/counter.ts` (TDD)

**Files:**
- Create: `src/lib/counter.ts`
- Test: `test/lib/counter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/lib/counter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countInWindow, easeInValue, padDigits } from '../../src/lib/counter';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('countInWindow', () => {
  const now = new Date(2026, 5, 15); // 2026-06-15 (local)
  const daysAgo = (n: number) => ymd(new Date(2026, 5, 15 - n));

  it('returns 0 for no dates', () => {
    expect(countInWindow([], now, 30)).toBe(0);
  });
  it('counts today and the last 29 days, excludes day 30', () => {
    expect(countInWindow([daysAgo(0), daysAgo(29), daysAgo(30)], now, 30)).toBe(2);
  });
  it('ignores future-dated entries', () => {
    expect(countInWindow([daysAgo(-1), daysAgo(0)], now, 30)).toBe(1);
  });
  it('ignores malformed dates', () => {
    expect(countInWindow(['nope', '2026-13-40', daysAgo(1)], now, 30)).toBe(1);
  });
});

describe('easeInValue', () => {
  it('is 0 at progress 0 and target at progress 1', () => {
    expect(easeInValue(42, 0)).toBe(0);
    expect(easeInValue(42, 1)).toBe(42);
  });
  it('accelerates (t^2 curve)', () => {
    expect(easeInValue(100, 0.5)).toBe(25); // 100 * 0.25
  });
  it('clamps out-of-range progress', () => {
    expect(easeInValue(42, -0.5)).toBe(0);
    expect(easeInValue(42, 1.5)).toBe(42);
  });
});

describe('padDigits', () => {
  it('zero-pads to the width', () => {
    expect(padDigits(42, 4)).toBe('0042');
    expect(padDigits(0, 2)).toBe('00');
  });
  it('returns the full number when wider than the field', () => {
    expect(padDigits(1234, 2)).toBe('1234');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/counter.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/lib/counter"` (module doesn't exist yet).

- [ ] **Step 3: Implement `src/lib/counter.ts`**

Create `src/lib/counter.ts`:

```ts
// Pure helpers for the odometer counter widget (unit-tested; the component's
// client script and the Blogs index import from here).

/**
 * Count `YYYY-MM-DD` dates falling within the last `days` calendar days ending
 * today (inclusive of today, exclusive of day `days`). UTC day arithmetic avoids
 * DST edge cases. Future-dated and unparseable entries are ignored.
 */
export function countInWindow(dates: string[], now: Date, days: number): number {
  const MS = 86_400_000;
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  for (const s of dates) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) continue;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const d = Date.UTC(Number(m[1]), month - 1, day);
    const daysAgo = Math.round((end - d) / MS);
    if (daysAgo >= 0 && daysAgo < days) n++;
  }
  return n;
}

/** Accelerating (ease-in, t^2) value from 0 to `target` for `progress` in [0,1]. */
export function easeInValue(target: number, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return target;
  return Math.round(target * progress * progress);
}

/** Zero-pad `n` to `width` digits; if `n` is wider, return it in full. */
export function padDigits(n: number, width: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/counter.test.ts`
Expected: PASS (all cases green).

Note on the malformed case: `2026-13-40` is rejected by the `month/day` range guard, so it never reaches `Date.UTC` (which would otherwise roll it over into a valid date).

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter.ts test/lib/counter.test.ts
git commit -m "feat(counter): pure helpers (countInWindow, easeInValue, padDigits)"
```

---

## Task 2: `CounterWidget.astro` component

**Files:**
- Create: `src/components/CounterWidget.astro`

- [ ] **Step 1: Create the component**

Create `src/components/CounterWidget.astro` with exactly this content:

```astro
---
import { padDigits } from '../lib/counter';

interface Props {
  value: number; // target count (SSR renders this final value)
  label: string; // caption above the digits
  durationMs?: number; // count-up duration (default 1800)
  digits?: number; // fixed digit-cell count (default: width of the value, min 2)
}
const {
  value,
  label,
  durationMs = 1800,
  digits = Math.max(2, String(Math.max(0, Math.trunc(value))).length),
} = Astro.props;
const padded = padDigits(value, digits);
---
<div
  class="counter"
  data-counter
  data-value={value}
  data-duration={durationMs}
  data-digits={digits}
  role="img"
  aria-label={`${label}: ${value}`}
>
  <span class="counter-label">{label}</span>
  <div class="counter-digits" aria-hidden="true">
    {padded.split('').map((ch) => <span class="counter-digit">{ch}</span>)}
  </div>
</div>

<style>
  .counter { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
  .counter-label { font-size: 0.8rem; color: var(--fg-dim); letter-spacing: 0.08em; }
  .counter-digits { display: flex; gap: 4px; }
  .counter-digit {
    min-width: 1.1ch;
    padding: 0.25rem 0.4rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 1.6rem;
    line-height: 1;
    color: var(--accent);
    border: 1px solid var(--accent);
    background: rgba(182, 255, 0, 0.06);
    box-shadow: inset 0 0 6px rgba(182, 255, 0, 0.15), 0 0 4px rgba(182, 255, 0, 0.25);
    transition: box-shadow 0.1s ease-out;
  }
  .counter-digit.tick {
    box-shadow: inset 0 0 10px rgba(182, 255, 0, 0.5), 0 0 10px rgba(182, 255, 0, 0.6);
  }
</style>

<script>
  import { easeInValue, padDigits } from '../lib/counter';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of document.querySelectorAll<HTMLElement>('[data-counter]')) {
    const value = Number(el.dataset.value || '0');
    const duration = Number(el.dataset.duration || '1800');
    const digits = Number(el.dataset.digits || '2');
    const cells = Array.from(el.querySelectorAll<HTMLElement>('.counter-digit'));
    // Reduced motion / zero / empty → SSR already shows the final value.
    if (reduce || value <= 0 || cells.length === 0) continue;

    let prev = '';
    const render = (shown: number) => {
      const s = padDigits(shown, digits);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].textContent !== s[i]) {
          cells[i].textContent = s[i];
          if (prev) {
            cells[i].classList.add('tick');
            setTimeout(() => cells[i].classList.remove('tick'), 90);
          }
        }
      }
      prev = s;
    };

    render(0); // reset to zero, then climb
    let start: number | null = null;
    const stepFrame = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min(1, (ts - start) / duration);
      render(easeInValue(value, progress));
      if (progress < 1) requestAnimationFrame(stepFrame);
    };
    requestAnimationFrame(stepFrame);
  }
</script>
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build 2>&1 | tail -3`
Expected: `[build] Complete!` (TypeScript in the frontmatter + client script compiles; the `../lib/counter` import resolves).

- [ ] **Step 3: Commit**

```bash
git add src/components/CounterWidget.astro
git commit -m "feat(counter): odometer CounterWidget with ease-in count-up"
```

---

## Task 3: Wire the counter into both pages + shared layout

**Files:**
- Modify: `src/styles/theme.css` (add `.heat-block` after the heatmap rules, ~line 186)
- Modify: `src/pages/contributions.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Add the `.heat-block` wrapper to `src/styles/theme.css`**

Immediately after the existing `.heat-future { … }` line (the last `.heat-*` rule), add:

```css
.heat-block { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 1.5rem; margin: 0.5rem 0 0.25rem; }
.heat-block .heatmap { margin: 0; }
```

- [ ] **Step 2: Wire `src/pages/contributions.astro`**

Add the import after the existing `import Heatmap` line:

```astro
import CounterWidget from '../components/CounterWidget.astro';
```

Replace the existing `<Heatmap … />` element:

```astro
  <Heatmap
    heatmap={data.heatmap}
    label="Contribution activity, last month"
    unit="contribution"
    legend="> contributions (commits + PRs) — last month (rows: weekday, columns: ISO week)"
  />
```

with it wrapped in a `.heat-block` plus the counter:

```astro
  <div class="heat-block">
    <Heatmap
      heatmap={data.heatmap}
      label="Contribution activity, last month"
      unit="contribution"
      legend="> contributions (commits + PRs) — last month (rows: weekday, columns: ISO week)"
    />
    <CounterWidget value={data.prs.length} label="CONTRIB // LAST 6 MO" />
  </div>
```

- [ ] **Step 3: Wire `src/pages/index.astro`**

Add the import after the existing `import Heatmap` line:

```astro
import CounterWidget from '../components/CounterWidget.astro';
import { countInWindow } from '../lib/counter';
```

In the frontmatter, immediately after the `const blogHeatmap = buildHeatmap(...)` block, add:

```astro
// Posts published in the last 30 days (one per post on its date).
const postsLast30 = countInWindow(posts.map((p) => p.date), now, 30);
```

Replace the existing `<Heatmap … />` element:

```astro
  <Heatmap
    heatmap={blogHeatmap}
    label="Blog posting activity, last month"
    unit="post"
    legend="> posts published — last month (rows: weekday, columns: ISO week)"
  />
```

with:

```astro
  <div class="heat-block">
    <Heatmap
      heatmap={blogHeatmap}
      label="Blog posting activity, last month"
      unit="post"
      legend="> posts published — last month (rows: weekday, columns: ISO week)"
    />
    <CounterWidget value={postsLast30} label="POSTS // LAST 30 DAYS" />
  </div>
```

- [ ] **Step 4: Build + run the full suite**

Run: `npm run build && npx vitest run 2>&1 | grep -E "Tests +[0-9]|FAIL"`
Expected: build `Complete!`, all tests pass (the existing 118 plus the new counter tests; no failures).

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css src/pages/contributions.astro src/pages/index.astro
git commit -m "feat(counter): show the odometer beside both heatmaps"
```

---

## Task 4: Live verification

**Files:** none (manual run).

- [ ] **Step 1: Start the server (GitHub-backed content, as currently configured)**

```bash
lsof -ti tcp:4321 | xargs -r kill -9 2>/dev/null; sleep 1
CONFIG_PATH=./config.yaml CACHE_DIR="$(mktemp -d)" HOST=127.0.0.1 PORT=4321 node ./dist/server/entry.mjs &
sleep 4
```

- [ ] **Step 2: Confirm both pages render the counter markup**

Run:
```bash
curl -fsS http://127.0.0.1:4321/ | grep -c 'class="counter"'
curl -fsS http://127.0.0.1:4321/contributions | grep -c 'class="counter"'
```
Expected: `1` on each page. (Each page renders exactly one `.counter`.)

- [ ] **Step 3: Confirm the SSR value is present (no-JS correctness)**

Run:
```bash
echo "blogs counter digits:"; curl -fsS http://127.0.0.1:4321/ | grep -o 'counter-digit">[0-9]<' | tr -d '\n'; echo
echo "contrib counter digits:"; curl -fsS http://127.0.0.1:4321/contributions | grep -o 'counter-digit">[0-9]<' | tr -d '\n'; echo
```
Expected: each prints the zero-padded final number digit-by-digit (e.g. blogs shows the count of posts dated within 30 days of today; contributions shows `data.prs.length`). The numbers are non-negative and match the data.

- [ ] **Step 4: Manual browser check (report to the user)**

Open http://127.0.0.1:4321/ and http://127.0.0.1:4321/contributions and confirm: the odometer sits to the right of the heatmap, counts up accelerating from 0 to the value, the digit cells glow on change, and on a narrow window the counter wraps below the heatmap. With OS "reduce motion" on, the final value shows immediately.

- [ ] **Step 5: Stop the server**

```bash
lsof -ti tcp:4321 | xargs -r kill -9 2>/dev/null
```

---

## Self-review notes

- **Spec coverage:** helpers + tests (Task 1) ↔ spec §A/Testing; odometer SSR + ease-in script + reduced-motion (Task 2) ↔ spec §B/§4; page wiring with `data.prs.length` and `countInWindow(..., 30)` + `.heat-block` right-of-heatmap/wrap (Task 3) ↔ spec §C/§5/§1; zero/reduced-motion/no-JS/overflow edges handled in Task 2 script + Task 1 `padDigits`; live verification (Task 4) ↔ spec Testing. No config toggle, matching the spec.
- **Type/name consistency:** `countInWindow(dates, now, days)`, `easeInValue(target, progress)`, `padDigits(n, width)`, props `value/label/durationMs/digits`, data attrs `data-value/data-duration/data-digits`, classes `.counter/.counter-label/.counter-digits/.counter-digit/.tick/.heat-block` are used identically across tasks.
- **Placeholders:** none — every code/command step is complete.
