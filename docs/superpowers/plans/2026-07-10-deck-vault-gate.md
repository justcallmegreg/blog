# Deck Vault Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open every deck in the Pip-Boy presenter with a sealed vault gate (gear door + OPEN button); OPEN plays the roll-away animation and reveals slide 1.

**Architecture:** Extract the existing `buildDoor` gear-door drawing into a shared `src/lib/vault-door.ts` used by both the blog intro and the presenter. Add a `.vault-gate` overlay inside the presenter CRT (green-duotone-filtered door), gated by deck frontmatter. It's a one-time entry gate wired into the presenter's existing nav script.

**Tech Stack:** Astro (SSR), TypeScript, Vitest (node env), Zod (frontmatter).

## Global Constraints

- The gate is **presenter-native**: rendered inside `.viewport` in the Pip-Boy green palette; the (steel) door is tinted green via a CSS `filter`, `buildDoor` itself is unchanged.
- **Shared door:** `buildDoor` lives in `src/lib/vault-door.ts`; both `VaultDoorIntro.astro` and `Presenter.astro` import it. Signature: `buildDoor(svg: SVGSVGElement, vault: string): void`.
- **One-time entry gate.** While sealed, these all trigger the open sequence: the OPEN button, `►`/`Space`/`PageDown`, the right hotzone, `NEXT`, and the knob. `◄`/PREV are inert while sealed. After opening, the gate is `display:none` and never returns.
- **Reduced motion** (`prefers-reduced-motion: reduce`): OPEN reveals slide 1 immediately, no animation.
- **Frontmatter:** `vaultIntro: boolean` (default `true`; `false` opts a deck out). `vault: number` (positive int, optional; door number, default `94`).
- **Tests:** Vitest runs in **node** env (no DOM lib). Unit-test the data layer (frontmatter + `Deck` propagation). Verify `buildDoor` extraction + the gate UI via `npm run build` + a `CONTENT_LOCAL_DIR` dev smoke. Deck route is `/decks/<slug>`.
- Work on branch `feat/deck-vault-gate`. Conventional commits.

---

### Task 1: Extract `buildDoor` into a shared module

**Files:**
- Create: `src/lib/vault-door.ts`
- Modify: `src/components/VaultDoorIntro.astro` (import the module; drop the inline copy; pass `vault`)

**Interfaces:**
- Produces: `buildDoor(svg: SVGSVGElement, vault: string): void` — draws the Fallout gear door into `svg`; `vault` is the door number text.

- [ ] **Step 1: Create the shared module (verbatim body, `vault` now a parameter)**

```ts
// src/lib/vault-door.ts
/**
 * Draw the Fallout vault gear-door into an SVG element. Shared by the blog intro
 * (VaultDoorIntro) and the deck presenter so the two draw the identical door.
 * `vault` is the door number rendered on the hub. Client-only (uses `document`).
 */
export function buildDoor(svg: SVGSVGElement, vault: string): void {
  const NS = 'http://www.w3.org/2000/svg';
  const C = 300;
  const el = (name: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    parent.appendChild(n);
    return n;
  };

  const defs = el('defs', {});
  defs.innerHTML = `
    <radialGradient id="vi-steel" cx="42%" cy="36%" r="75%">
      <stop offset="0%"  stop-color="#8d968c"/>
      <stop offset="42%" stop-color="#5c655c"/>
      <stop offset="78%" stop-color="#39413a"/>
      <stop offset="100%" stop-color="#242b25"/>
    </radialGradient>
    <radialGradient id="vi-hub" cx="45%" cy="40%" r="70%">
      <stop offset="0%"  stop-color="#6e776d"/>
      <stop offset="70%" stop-color="#414942"/>
      <stop offset="100%" stop-color="#272e28"/>
    </radialGradient>
    <linearGradient id="vi-tooth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#707a70"/>
      <stop offset="100%" stop-color="#2c332d"/>
    </linearGradient>
    <filter id="vi-rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0"/>
      <feComposite operator="over" in2="SourceGraphic"/></filter>
  `;

  el('circle', { cx: C, cy: C, r: 284, fill: '#232923', stroke: '#0e120e', 'stroke-width': 2 });

  const teeth = el('g', {});
  for (let i = 0; i < 24; i++) {
    el('rect', {
      x: C - 13, y: 4, width: 26, height: 34, rx: 3,
      fill: 'url(#vi-tooth)', stroke: '#141814', 'stroke-width': 1.5,
      transform: `rotate(${i * 15} ${C} ${C})`,
    }, teeth);
  }

  el('circle', { cx: C, cy: C, r: 268, fill: 'url(#vi-steel)', stroke: '#101410', 'stroke-width': 3 });
  [252, 214, 196].forEach((r, i) =>
    el('circle', { cx: C, cy: C, r, fill: 'none', stroke: i % 2 ? '#1c221c' : '#6b746a', 'stroke-width': i % 2 ? 5 : 2, opacity: 0.8 }));

  for (let i = 0; i < 6; i++) {
    el('line', {
      x1: C, y1: C - 196, x2: C, y2: C - 118,
      stroke: '#20261f', 'stroke-width': 7, 'stroke-linecap': 'round',
      transform: `rotate(${i * 60 + 30} ${C} ${C})`,
    });
  }
  el('path', { d: `M ${C} ${C} L ${C - 190} ${C - 60} A 200 200 0 0 1 ${C - 40} ${C - 195} Z`, fill: 'rgba(255,255,255,0.05)' });
  el('path', { d: `M ${C} ${C} L ${C + 120} ${C + 160} A 200 200 0 0 1 ${C - 90} ${C + 178} Z`, fill: 'rgba(0,0,0,0.18)' });

  const rivets = el('g', {});
  const ring = (r: number, n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      el('circle', {
        cx: C + Math.cos(a) * r, cy: C + Math.sin(a) * r, r: size,
        fill: '#525b52', stroke: '#171c17', 'stroke-width': 1.5,
      }, rivets);
    }
  };
  ring(233, 32, 5.5);
  ring(174, 20, 4.5);

  el('circle', { cx: C, cy: C, r: 104, fill: 'url(#vi-hub)', stroke: '#161b16', 'stroke-width': 4 });
  el('circle', { cx: C, cy: C, r: 86, fill: 'none', stroke: '#5f685e', 'stroke-width': 2, opacity: 0.7 });
  for (let i = 0; i < 3; i++) {
    el('rect', {
      x: C - 80, y: C - 9, width: 160, height: 18, rx: 8,
      fill: '#333a33', stroke: '#141914', 'stroke-width': 2,
      transform: `rotate(${i * 60} ${C} ${C})`,
    });
  }
  el('circle', { cx: C, cy: C, r: 26, fill: '#2a302a', stroke: '#101510', 'stroke-width': 3 });
  el('circle', { cx: C, cy: C, r: 9, fill: '#4c554c' });

  const numSize = vault.length > 2 ? 200 : 280;
  const num = el('text', {
    x: C, y: C + (vault.length > 2 ? 70 : 96), 'text-anchor': 'middle',
    'font-family': 'var(--font)', 'font-size': numSize,
    fill: '#d8b445', opacity: 0.88, 'letter-spacing': '8',
    stroke: '#3f3210', 'stroke-width': 3,
  });
  num.textContent = vault;
  el('text', {
    x: C, y: C + 236, 'text-anchor': 'middle',
    'font-family': 'var(--font)', 'font-size': 30,
    fill: '#c9a83f', opacity: 0.6, 'letter-spacing': '6',
  }).textContent = 'VAULT-TEC';

  el('circle', { cx: C, cy: C, r: 268, fill: '#000', opacity: 0.16, filter: 'url(#vi-rough)' });
}
```

- [ ] **Step 2: Rewire `VaultDoorIntro.astro` to use the module**

In `src/components/VaultDoorIntro.astro`: (a) delete the inline `function buildDoor(svg: SVGSVGElement) { … }` block (the whole function, currently lines ~325–423); (b) add an import as the first line inside `<script>`; (c) pass `vault` at the call site.

Add after `<script>`:
```ts
  import { buildDoor } from '../lib/vault-door';
```
Change the call (inside `play()`):
```ts
          buildDoor(document.getElementById('vi-door') as unknown as SVGSVGElement, vault);
```
(`vault` is already in scope — `const vault = root.dataset.vault ?? '94';`.)

- [ ] **Step 3: Build to verify the extraction compiles (no DOM unit test — node vitest has no DOM)**

Run: `npm run build`
Expected: build succeeds; no unresolved-import or type errors from `vault-door.ts` / `VaultDoorIntro.astro`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/vault-door.ts src/components/VaultDoorIntro.astro
git commit -m "refactor(vault): extract buildDoor into a shared module"
```

---

### Task 2: Deck frontmatter fields

**Files:**
- Modify: `src/lib/deck.ts` (`DeckFrontmatterSchema`)
- Test: `test/lib/deck.test.ts`

**Interfaces:**
- Produces: `DeckFrontmatter` gains `vaultIntro: boolean` (default `true`) and `vault?: number` (positive int).

- [ ] **Step 1: Write the failing test**

Append to `test/lib/deck.test.ts`:
```ts
describe('vault gate frontmatter', () => {
  it('defaults vaultIntro to true', () => {
    expect(parseDeckSource('---\ntitle: T\n---\n# S\n').meta.vaultIntro).toBe(true);
  });
  it('parses vaultIntro:false and a vault number', () => {
    const m = parseDeckSource('---\nvaultIntro: false\nvault: 111\n---\n# S\n').meta;
    expect(m.vaultIntro).toBe(false);
    expect(m.vault).toBe(111);
  });
  it('rejects a non-positive vault number', () => {
    expect(() => parseDeckSource('---\nvault: -1\n---\n# S\n')).toThrow();
  });
});
```
(If `parseDeckSource` / `describe` / `expect` aren't already imported at the top of the file, add them to the existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/deck.test.ts`
Expected: FAIL — `meta.vaultIntro` is `undefined` (field not in schema yet).

- [ ] **Step 3: Add the fields to the schema**

In `src/lib/deck.ts`, add to `DeckFrontmatterSchema` (after `publishAt`):
```ts
  vaultIntro: z.boolean().default(true),
  vault: z.number().int().positive().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/deck.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deck.ts test/lib/deck.test.ts
git commit -m "feat(decks): vaultIntro + vault frontmatter fields"
```

---

### Task 3: Propagate onto the `Deck` type

**Files:**
- Modify: `src/lib/content-store.ts` (`Deck` interface + deck build)
- Test: `test/lib/content-store.test.ts`

**Interfaces:**
- Consumes: `DeckFrontmatter.vaultIntro` / `.vault` from Task 2.
- Produces: `Deck` gains `vaultIntro: boolean` and `vault?: number`.

- [ ] **Step 1: Write the failing test**

Append to `test/lib/content-store.test.ts` a new `it(...)` inside the existing store `describe` block (it reuses the file's `commitDeck` + `makeStore` helpers — the same shape as the existing "indexes a deck" test):
```ts
  it('carries vaultIntro/vault from deck frontmatter', async () => {
    commitDeck('vaultopt', '---\ntitle: V\nvaultIntro: false\nvault: 111\n---\n# S\n');
    commitDeck('vaultdef', '---\ntitle: D\n---\n# S\n');
    const store = makeStore();
    await store.start();
    const opt = store.getDeck('/decks/vaultopt')!;
    const def = store.getDeck('/decks/vaultdef')!;
    expect(opt.vaultIntro).toBe(false);
    expect(opt.vault).toBe(111);
    expect(def.vaultIntro).toBe(true);
    expect(def.vault).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: FAIL — `opt.vaultIntro` is `undefined` (not on the type/build yet).

- [ ] **Step 3: Add the fields to the `Deck` interface**

In `src/lib/content-store.ts`, in `export interface Deck { … }`, add after `draft: boolean;`:
```ts
  vaultIntro: boolean;
  vault?: number;
```

- [ ] **Step 4: Populate them in the deck build**

In the `this.decksIndex.set(info.url, { … })` object, add after `draft: parsed.meta.draft,`:
```ts
        vaultIntro: parsed.meta.vaultIntro,
        vault: parsed.meta.vault,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/content-store.ts test/lib/content-store.test.ts
git commit -m "feat(decks): propagate vaultIntro/vault onto the Deck type"
```

---

### Task 4: Presenter vault gate (markup + CSS + script)

**Files:**
- Modify: `src/layouts/Presenter.astro`

**Interfaces:**
- Consumes: `deck.vaultIntro`, `deck.vault` (Task 3); `buildDoor` (Task 1).
- Produces: the rendered gate + open behaviour. No unit test (Astro UI + animation); verified by build + dev smoke.

- [ ] **Step 1: Add the gate markup inside `.viewport`**

In `src/layouts/Presenter.astro`, inside `<main class="viewport" …>`, immediately **after** the `<div class="wipe" id="wipe"></div>` line, add:
```astro
                {deck.vaultIntro && (
                  <div class="vault-gate" id="vaultgate" data-vault={String(deck.vault ?? 94)}>
                    <div class="vault-door-wrap">
                      <svg class="vault-door" id="vaultdoor" viewBox="0 0 600 600" aria-hidden="true"></svg>
                    </div>
                    <p class="vault-label">VAULT {deck.vault ?? 94} <span class="vault-sealed">// SEALED</span></p>
                    <button class="vault-open" id="vaultopen" type="button">[ OPEN ]</button>
                  </div>
                )}
```

- [ ] **Step 2: Add the gate CSS**

Inside the `<style is:global>` block (before its closing `</style>`), add:
```css
      /* ============ VAULT GATE (deck entry) ============ */
      .vault-gate {
        position: absolute; inset: 0; z-index: 5;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 2.4vmin;
        background: radial-gradient(ellipse 95% 90% at 50% 42%, var(--screen-0) 0%, var(--screen-1) 80%);
      }
      .vault-gate.gone { display: none; }
      .vault-door-wrap {
        width: min(52vmin, 62%); aspect-ratio: 1;
        /* Tint the steel door to the CRT green (same trick as the site avatar). */
        filter: grayscale(1) sepia(1) hue-rotate(78deg) saturate(2.4) brightness(0.95);
      }
      .vault-door { width: 100%; height: 100%; display: block; }
      .vault-label {
        margin: 0; color: var(--fg);
        font-size: clamp(13px, 2.4vmin, 28px); letter-spacing: 0.24em;
      }
      .vault-sealed { color: var(--fg-dim); }
      .vault-open {
        font: inherit; cursor: pointer;
        color: var(--screen-1); background: var(--fg); border: none; text-shadow: none;
        padding: 0.35em 1.5em; font-size: clamp(14px, 2.6vmin, 30px); letter-spacing: 0.24em;
        box-shadow: 0 0 1.4vmin rgba(69, 255, 122, 0.5);
        animation: vault-open-pulse 1.6s steps(1) infinite;
      }
      .vault-open:hover { filter: brightness(1.12); }
      .vault-open:focus-visible { outline: 2px solid var(--fg); outline-offset: 3px; }
      @keyframes vault-open-pulse { 50% { box-shadow: 0 0 0.5vmin rgba(69, 255, 122, 0.3); } }

      /* open sequence: unseal spin, then roll the door off to the right + fade */
      .vault-gate.opening .vault-label,
      .vault-gate.opening .vault-open { animation: vault-fade 0.35s ease forwards; }
      .vault-gate.opening .vault-door-wrap {
        filter: grayscale(1) sepia(1) hue-rotate(78deg) saturate(2.4) brightness(0.95);
        animation: vault-roll 1.5s cubic-bezier(0.5, 0, 0.7, 1) forwards;
      }
      .vault-gate.opening { animation: vault-gate-fade 1.5s ease forwards; }
      @keyframes vault-fade { to { opacity: 0; } }
      @keyframes vault-roll {
        0%   { transform: rotate(0) translateX(0) scale(1); }
        30%  { transform: rotate(-42deg) translateX(0) scale(1); }
        100% { transform: rotate(-42deg) translateX(135%) scale(0.85); opacity: 0; }
      }
      @keyframes vault-gate-fade { 0%, 62% { opacity: 1; } 100% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        .vault-gate.opening,
        .vault-gate.opening .vault-door-wrap,
        .vault-gate.opening .vault-label,
        .vault-gate.opening .vault-open,
        .vault-open { animation: none !important; }
      }
```

- [ ] **Step 3: Wire the gate into the presenter script**

At the **top** of the `<script>` (line ~641, immediately after the opening `<script>` tag, before `(() => {`), add the import:
```ts
      import { buildDoor } from '../lib/vault-door';
```
Inside the IIFE, after `const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;`, add:
```ts
        const gate = document.getElementById('vaultgate') as HTMLElement | null;
        const openBtn = document.getElementById('vaultopen');
        let sealed = !!gate;
        let opening = false;
        if (gate) {
          const doorEl = document.getElementById('vaultdoor');
          try { if (doorEl) buildDoor(doorEl as unknown as SVGSVGElement, gate.dataset.vault || '94'); } catch { /* draw failed — OPEN still reveals */ }
        }
```
Replace the existing `function render() { … }` body with a sealed-aware version:
```ts
        function render() {
          slides.forEach((s, i) => s.classList.toggle('on', i === idx && !sealed));
          counter.textContent = sealed
            ? '-- / ' + String(slides.length).padStart(2, '0')
            : String(idx + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
          const deg = !sealed && slides.length > 1 ? -55 + (110 * idx) / (slides.length - 1) : -55;
          needle.style.setProperty('--deg', deg.toFixed(1) + 'deg');
          navhint.classList.toggle('hide', sealed || idx !== 0);
        }
```
Add a `reveal()` and an `advance()` (place just before the event wiring, after `function go(dir) { … }`):
```ts
        function reveal() {
          if (!sealed || opening || !gate) return;
          opening = true;
          click();
          const finish = () => { sealed = false; opening = false; gate.classList.add('gone'); render(); };
          if (reduce) { finish(); return; }
          const wrap = gate.querySelector('.vault-door-wrap');
          gate.classList.add('opening');
          if (wrap) wrap.addEventListener('animationend', finish, { once: true });
          else setTimeout(finish, 1600);
        }
        function advance() { if (sealed) reveal(); else go(1); }
```
Rewire the events. Replace the existing control listeners:
```ts
        document.getElementById('next')!.addEventListener('click', advance);
        document.getElementById('prev')!.addEventListener('click', () => { if (!sealed) go(-1); });
        document.getElementById('hotr')!.addEventListener('click', advance);
        document.getElementById('hotl')!.addEventListener('click', () => { if (!sealed) go(-1); });
        knob.addEventListener('click', advance);
        openBtn?.addEventListener('click', reveal);

        addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); advance(); }
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (!sealed) go(-1); }
        });
```
Leave the final `render();` call at the end as-is (it now renders the sealed state).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds; `/decks/[slug]` compiles with the gate + `buildDoor` import.

- [ ] **Step 5: Dev smoke (local content dir)**

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/decks/justcallmegreg-blog/gated/" "$TMP/decks/justcallmegreg-blog/plain/"
printf -- '---\ntitle: Gated Demo\nvault: 111\n---\n# Slide One\n\n---\n\n# Slide Two\n' > "$TMP/decks/justcallmegreg-blog/gated/index.md"
printf -- '---\ntitle: Plain Demo\nvaultIntro: false\n---\n# Slide One\n' > "$TMP/decks/justcallmegreg-blog/plain/index.md"
CONTENT_LOCAL_DIR="$TMP" npm run dev >/tmp/deck-dev.log 2>&1 &
until curl -sf http://localhost:4321/version >/dev/null 2>&1; do sleep 1; done
sleep 3   # allow the first content sync
echo "=== gated deck (expect gate + OPEN + VAULT 111) ==="
curl -s http://localhost:4321/decks/gated | grep -oE 'class="vault-gate"|\[ OPEN \]|VAULT 111' | sort -u
echo "=== opted-out deck (expect NO gate) ==="
curl -s http://localhost:4321/decks/plain | grep -oE 'class="vault-gate"' || echo '(no gate — correct)'
pkill -f 'astro dev'
```
Expected: gated deck HTML contains `class="vault-gate"`, `[ OPEN ]`, `VAULT 111`; opted-out deck contains no `vault-gate`. (If the deck URL differs, check `/tmp/deck-dev.log` for the `[content]` deck path it indexed and adjust the slug. Manually open `http://localhost:4321/decks/gated` in a browser to watch the door roll away on OPEN if you want the visual.)

- [ ] **Step 6: Commit**

```bash
git add src/layouts/Presenter.astro
git commit -m "feat(decks): vault gate entry screen in the presenter"
```

---

### Task 5: Full verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all pass (new deck + content-store tests included).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit (if any incidental fixups were needed; otherwise skip)**

```bash
git add -A && git commit -m "chore(decks): vault gate final verification"
```

---

## Notes for the implementer

- **`buildDoor` is client-only** (uses `document`). It's imported only inside Astro `<script>` blocks (bundled for the browser), never server-side — do not import it in a `.astro` frontmatter.
- **Sealed stays true through the animation.** `reveal()` flips `sealed` to `false` only in `finish()` (on the door's `animationend`), so mid-animation key/knob presses can't skip a slide, and slide 1's entrance plays as the door clears.
- **Every "begin" affordance funnels to OPEN** via `advance()`; `PREV`/`◄` are inert while sealed. This preserves the original nav once opened.
- The green door `filter` value is tunable — adjust `hue-rotate`/`saturate` if the tint reads off against the CRT.
