# Puzzle Captcha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-validated slide-puzzle captcha to the contact form: a random `public/puzzles/` image is cut (sharp) into a notched background + a piece, the secret gap-X is held behind a one-time token, the client slides the piece, the server verifies, and `/api/contact` only forwards when the captcha is solved (degrading gracefully when disabled or no images exist).

**Architecture:** Pure token logic in `src/lib/captcha-store.ts` (unit-tested in-memory Map with TTL); image cutting in `src/lib/captcha-image.ts` (sharp + inline SVG, smoke-tested); an `/api/captcha` endpoint (GET issues, POST verifies); `/api/contact` extended to require a solved token when the captcha is active; the contact overlay gains a captcha panel + state.

**Tech Stack:** Astro 5 SSR (@astrojs/node), TypeScript, Vitest, `sharp` (already a dep), vanilla-JS pointer drag, existing contact overlay/`handleContact`.

---

## File Structure & Responsibilities

```
src/lib/captcha-store.ts      # in-memory token store: issue/verify/consume + TTL (pure, unit-tested)
src/lib/captcha-image.ts      # sharp: normalize image, cut notch + piece (smoke-tested)
src/pages/api/captcha.ts      # GET issue challenge, POST verify; puzzlesAvailable(); captchaActive()
src/pages/api/contact.ts      # MODIFY: handleContact requires solved token when captcha active
src/components/ContactOverlay.astro  # MODIFY: captcha panel markup + state machine + slider
src/styles/theme.css          # MODIFY: captcha panel styles
src/lib/config.ts             # MODIFY: contact.captcha knob
config.example.yaml/config.yaml  # MODIFY: document contact.captcha
scripts/make-puzzle-samples.mjs  # dev tool: generate sample puzzle images
public/puzzles/*.png          # sample images (committed)
test/lib/captcha-store.test.ts
test/lib/captcha-image.test.ts
test/lib/contact-endpoint.test.ts  # MODIFY: existing tests pass captcha:{active:false}; add active-path tests
```

---

## Task 1: Token store (`src/lib/captcha-store.ts`)

**Files:**
- Create: `src/lib/captcha-store.ts`
- Test: `test/lib/captcha-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { issue, verify, consume, __resetCaptchaStore } from '../../src/lib/captcha-store';

beforeEach(() => __resetCaptchaStore());

const now = () => 1_000_000; // fixed clock for determinism

describe('captcha-store', () => {
  it('issues a unique token per call', () => {
    const a = issue(120, now());
    const b = issue(120, now());
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
  });

  it('verify succeeds within tolerance and marks solved', () => {
    const t = issue(120, now());
    expect(verify(t, 124, { tolerance: 8, now: now() })).toBe(true);  // |124-120|=4
  });

  it('verify fails outside tolerance', () => {
    const t = issue(120, now());
    expect(verify(t, 140, { tolerance: 8, now: now() })).toBe(false); // |140-120|=20
  });

  it('verify fails for unknown or expired tokens', () => {
    expect(verify('nope', 120, { tolerance: 8, now: now() })).toBe(false);
    const t = issue(120, now());
    expect(verify(t, 120, { tolerance: 8, now: now() + 11 * 60_000 })).toBe(false); // > 10 min
  });

  it('consume succeeds once for a solved token, then fails on reuse', () => {
    const t = issue(120, now());
    verify(t, 120, { tolerance: 8, now: now() });
    expect(consume(t, now())).toBe(true);
    expect(consume(t, now())).toBe(false); // already consumed
  });

  it('consume fails for an unsolved token', () => {
    const t = issue(120, now());
    expect(consume(t, now())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/captcha-store.test.ts`
Expected: FAIL — cannot find module `captcha-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomUUID } from 'node:crypto';

const TTL_MS = 10 * 60_000;

interface Entry {
  gapX: number;
  createdAt: number;
  solved: boolean;
  consumed: boolean;
}

const store = new Map<string, Entry>();

function expired(e: Entry, now: number): boolean {
  return now - e.createdAt > TTL_MS;
}

function sweep(now: number): void {
  if (store.size <= 1000) return;
  for (const [k, e] of store) if (expired(e, now)) store.delete(k);
}

export function issue(gapX: number, now: number = Date.now()): string {
  sweep(now);
  const token = randomUUID();
  store.set(token, { gapX, createdAt: now, solved: false, consumed: false });
  return token;
}

export function verify(
  token: string,
  x: number,
  opts: { tolerance: number; now?: number }
): boolean {
  const e = store.get(token);
  const now = opts.now ?? Date.now();
  if (!e || expired(e, now)) return false;
  if (Math.abs(x - e.gapX) > opts.tolerance) return false;
  e.solved = true;
  return true;
}

export function consume(token: string, now: number = Date.now()): boolean {
  const e = store.get(token);
  if (!e || expired(e, now) || !e.solved || e.consumed) return false;
  e.consumed = true;
  return true;
}

export function __resetCaptchaStore(): void {
  store.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/captcha-store.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/captcha-store.ts test/lib/captcha-store.test.ts
git commit -m "feat: in-memory captcha token store (issue/verify/consume + TTL)"
```

---

## Task 2: Sample puzzle images (`scripts/make-puzzle-samples.mjs` + `public/puzzles/`)

**Files:**
- Create: `scripts/make-puzzle-samples.mjs`
- Create: `public/puzzles/*.png` (generated)

- [ ] **Step 1: Create the generator script**

```js
// Dev tool: generate terminal-green sample puzzle images.
//   node scripts/make-puzzle-samples.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/puzzles', { recursive: true });

const W = 320, H = 180;
const variants = [
  { name: 'grid', bg: '#0b0f0b', fg: '#1f9a3f' },
  { name: 'scan', bg: '#0b1410', fg: '#33ff66' },
  { name: 'noise', bg: '#0c100c', fg: '#2bd455' },
];

function svg({ bg, fg }, i) {
  const lines = [];
  for (let x = 0; x <= W; x += 20) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${fg}" stroke-opacity="0.25"/>`);
  for (let y = 0; y <= H; y += 20) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${fg}" stroke-opacity="0.25"/>`);
  // a few brighter "data" blocks so the piece has distinguishable content
  const blocks = [];
  for (let b = 0; b < 14; b++) {
    const bx = (b * 53 + i * 31) % (W - 24);
    const by = (b * 37 + i * 17) % (H - 16);
    blocks.push(`<rect x="${bx}" y="${by}" width="18" height="10" fill="${fg}" fill-opacity="${0.3 + ((b + i) % 5) * 0.12}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    ${lines.join('')}
    ${blocks.join('')}
    <text x="10" y="${H - 12}" font-family="monospace" font-size="14" fill="${fg}" fill-opacity="0.7">ROBCO-${i}</text>
  </svg>`;
}

let n = 0;
for (const v of variants) {
  await sharp(Buffer.from(svg(v, n))).png().toFile(`public/puzzles/sample-${v.name}.png`);
  console.log(`wrote public/puzzles/sample-${v.name}.png`);
  n++;
}
```

- [ ] **Step 2: Run it**

Run: `node scripts/make-puzzle-samples.mjs`
Expected: prints three `wrote public/puzzles/sample-*.png` lines.

- [ ] **Step 3: Verify the images exist and are valid PNGs**

Run: `node -e "const s=require('sharp');Promise.all(['grid','scan','noise'].map(n=>s('public/puzzles/sample-'+n+'.png').metadata())).then(m=>console.log(m.map(x=>x.width+'x'+x.height).join(' ')))"`
Expected: `320x180 320x180 320x180`.

- [ ] **Step 4: Commit**

```bash
git add scripts/make-puzzle-samples.mjs public/puzzles
git commit -m "feat: sample puzzle images + generator script"
```

---

## Task 3: Image cutting (`src/lib/captcha-image.ts`)

**Files:**
- Create: `src/lib/captcha-image.ts`
- Test: `test/lib/captcha-image.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildPuzzle, PIECE_SIZE, CANVAS_W, CANVAS_H } from '../../src/lib/captcha-image';

async function solidImage(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#224422' } }).png().toBuffer();
}

describe('buildPuzzle', () => {
  it('returns a background and a piece with the expected geometry', async () => {
    const r = await buildPuzzle(await solidImage(), { rng: () => 0.5 });
    expect(r.width).toBe(CANVAS_W);
    expect(r.height).toBe(CANVAS_H);
    expect(r.pieceSize).toBe(PIECE_SIZE);

    const bg = await sharp(r.background).metadata();
    expect(bg.width).toBe(CANVAS_W);
    expect(bg.height).toBe(CANVAS_H);

    const piece = await sharp(r.piece).metadata();
    expect(piece.width).toBe(PIECE_SIZE);
    expect(piece.height).toBe(PIECE_SIZE);

    // gapX/gapY within bounds
    expect(r.gapX).toBeGreaterThanOrEqual(PIECE_SIZE + 8);
    expect(r.gapX).toBeLessThanOrEqual(CANVAS_W - PIECE_SIZE - 8);
    expect(r.gapY).toBeGreaterThanOrEqual(0);
    expect(r.gapY).toBeLessThanOrEqual(CANVAS_H - PIECE_SIZE);
  });

  it('varies gapX with the rng', async () => {
    const a = await buildPuzzle(await solidImage(), { rng: () => 0.1 });
    const b = await buildPuzzle(await solidImage(), { rng: () => 0.9 });
    expect(a.gapX).not.toBe(b.gapX);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/captcha-image.test.ts`
Expected: FAIL — cannot find module `captcha-image`.

- [ ] **Step 3: Write minimal implementation**

```ts
import sharp from 'sharp';

export const CANVAS_W = 320;
export const CANVAS_H = 180;
export const PIECE_SIZE = 56;
const MARGIN = 8;

export interface Puzzle {
  background: Buffer;
  piece: Buffer;
  gapX: number;
  gapY: number;
  pieceSize: number;
  width: number;
  height: number;
}

/** SVG path for the puzzle-piece shape (rounded square + a small top tab). */
function shapePath(size: number): string {
  const s = size;
  const tab = s * 0.22;
  const c = s / 2;
  // rounded square with a bump on the top edge
  return (
    `M8 8 H${c - tab} ` +
    `C${c - tab} ${-tab / 2}, ${c + tab} ${-tab / 2}, ${c + tab} 8 ` +
    `H${s - 8} Q${s} 0 ${s} 8 V${s - 8} Q${s} ${s} ${s - 8} ${s} ` +
    `H8 Q0 ${s} 0 ${s - 8} V8 Q0 0 8 8 Z`
  );
}

function maskSvg(size: number, fill: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<path d="${shapePath(size)}" fill="${fill}"/></svg>`
  );
}

export async function buildPuzzle(
  input: Buffer,
  opts: { rng?: () => number } = {}
): Promise<Puzzle> {
  const rng = opts.rng ?? Math.random;
  const base = await sharp(input)
    .resize(CANVAS_W, CANVAS_H, { fit: 'cover' })
    .toFormat('png')
    .toBuffer();

  const gapX = Math.round(
    PIECE_SIZE + MARGIN + rng() * (CANVAS_W - 2 * (PIECE_SIZE + MARGIN))
  );
  const gapY = Math.round(rng() * (CANVAS_H - PIECE_SIZE));

  // piece: extract the gap region, mask to the shape
  const region = await sharp(base)
    .extract({ left: gapX, top: gapY, width: PIECE_SIZE, height: PIECE_SIZE })
    .toBuffer();
  const piece = await sharp(region)
    .composite([{ input: maskSvg(PIECE_SIZE, '#fff'), blend: 'dest-in' }])
    .png()
    .toBuffer();

  // background: darken the shape region to show the hole
  const hole = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}">` +
      `<g transform="translate(${gapX},${gapY})">` +
      `<path d="${shapePath(PIECE_SIZE)}" fill="#000" fill-opacity="0.55" ` +
      `stroke="#33ff66" stroke-opacity="0.6" stroke-width="2"/></g></svg>`
  );
  const background = await sharp(base)
    .composite([{ input: hole, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    background,
    piece,
    gapX,
    gapY,
    pieceSize: PIECE_SIZE,
    width: CANVAS_W,
    height: CANVAS_H,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/captcha-image.test.ts`
Expected: PASS (2 cases). Note: with `rng:()=>0.5`, `gapX/gapY` are deterministic; the second test uses 0.1 vs 0.9 so they differ.

- [ ] **Step 5: Commit**

```bash
git add src/lib/captcha-image.ts test/lib/captcha-image.test.ts
git commit -m "feat: sharp puzzle cutter (notched background + masked piece)"
```

---

## Task 4: Captcha endpoint (`src/pages/api/captcha.ts`)

**Files:**
- Create: `src/pages/api/captcha.ts`
- Test: `test/lib/captcha-endpoint.test.ts`

The endpoint exposes `puzzlesAvailable()`, `captchaActive()`, `listPuzzles()`, and the Astro `GET`/`POST`. We unit-test the helpers; the GET/POST that touch sharp + disk are covered by the end-to-end task.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TOLERANCE } from '../../src/pages/api/captcha';

describe('captcha endpoint constants', () => {
  it('exposes a small pixel tolerance', () => {
    expect(TOLERANCE).toBeGreaterThan(0);
    expect(TOLERANCE).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/captcha-endpoint.test.ts`
Expected: FAIL — cannot find module `captcha`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { APIRoute } from 'astro';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../lib/config';
import { issue, verify } from '../../lib/captcha-store';
import { buildPuzzle } from '../../lib/captcha-image';

export const TOLERANCE = 8;
const PUZZLE_DIRS = ['./dist/client/puzzles', './public/puzzles'];
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

function puzzleDir(): string | null {
  for (const d of PUZZLE_DIRS) if (existsSync(d)) return d;
  return null;
}

export function listPuzzles(): string[] {
  const dir = puzzleDir();
  if (!dir) return [];
  try {
    return readdirSync(dir).filter((f) => IMG_RE.test(f)).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function puzzlesAvailable(): boolean {
  return listPuzzles().length > 0;
}

export function captchaActive(): boolean {
  return getConfig().contact.captcha && puzzlesAvailable();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async () => {
  if (!captchaActive()) return json({ active: false });
  const files = listPuzzles();
  const file = files[Math.floor(Math.random() * files.length)];
  const puzzle = await buildPuzzle(readFileSync(file));
  const token = issue(puzzle.gapX);
  return json({
    active: true,
    token,
    background: `data:image/png;base64,${puzzle.background.toString('base64')}`,
    piece: `data:image/png;base64,${puzzle.piece.toString('base64')}`,
    pieceY: puzzle.gapY,
    pieceSize: puzzle.pieceSize,
    width: puzzle.width,
    height: puzzle.height,
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string; x?: number };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const ok =
    typeof body.token === 'string' &&
    typeof body.x === 'number' &&
    verify(body.token, body.x, { tolerance: TOLERANCE });
  return json({ ok });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/captcha-endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/captcha.ts test/lib/captcha-endpoint.test.ts
git commit -m "feat: /api/captcha (GET issue, POST verify) + puzzle helpers"
```

---

## Task 5: Enforce captcha in `/api/contact`

**Files:**
- Modify: `src/pages/api/contact.ts`
- Modify: `test/lib/contact-endpoint.test.ts`

`handleContact` gains `opts.captcha`. The existing tests must keep passing by adding `captcha: { active: false, consume: () => true }` to their `ctx`-spread opts.

- [ ] **Step 1: Update the existing endpoint test + add the captcha-path tests**

In `test/lib/contact-endpoint.test.ts`, change the shared `ctx` to include an inactive captcha by default:

```ts
const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-13T00:00:00.000Z'),
  ip: '1.2.3.4',
  captcha: { active: false, consume: () => true },
};
```

Then add a new describe block (the `good` input + `handleContact` import already exist at the top of the file):

```ts
describe('handleContact captcha', () => {
  const webhook = { webhookUrl: undefined, fetchImpl: () => Promise.resolve({ ok: true } as Response) };

  it('rejects with 400 when captcha is active and the token is missing/invalid', async () => {
    const res = await handleContact(
      { ...good, captchaToken: 'bad' },
      { ...ctx, ...webhook, captcha: { active: true, consume: () => false } }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });

  it('accepts when captcha is active and the token is valid', async () => {
    let consumed = '';
    const res = await handleContact(
      { ...good, captchaToken: 'tok-123' },
      { ...ctx, ...webhook, captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } } }
    );
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok-123');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/contact-endpoint.test.ts`
Expected: FAIL — `handleContact` doesn't read `opts.captcha` / `input.captchaToken` yet (the new active-path tests fail; the inactive ones may pass since the field is ignored).

- [ ] **Step 3: Update `src/pages/api/contact.ts`**

Add `captchaToken` to the input type and a `captcha` check. Edit the `ContactInput` import usage and `HandleOpts`:

```ts
import { validateContact, buildForwardPayload, type ContactInput } from '../../lib/contact';
import { captchaActive } from './captcha';
import { consume as consumeCaptcha } from '../../lib/captcha-store';
```

Extend `HandleOpts`:

```ts
interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  captcha?: { active: boolean; consume: (token?: string) => boolean };
}
```

In `handleContact`, AFTER the rate-limit check and BEFORE/AFTER validation — place the captcha check right after `validateContact` succeeds (so honeypot/invalid still short-circuit first). Insert just before `const payload = buildForwardPayload(...)`:

```ts
  if (opts.captcha?.active) {
    const token = (input as ContactInput & { captchaToken?: string }).captchaToken;
    if (!token || !opts.captcha.consume(token)) {
      return { status: 400, body: { ok: false, error: 'captcha required' } };
    }
  }
```

And in the Astro `POST` wrapper, pass the captcha into `handleContact`:

```ts
  const result = await handleContact(input, {
    site: getConfig().site.title,
    now: new Date(),
    ip,
    webhookUrl: process.env.CONTACT_WEBHOOK_URL,
    captcha: { active: captchaActive(), consume: (t?: string) => (t ? consumeCaptcha(t) : false) },
  });
```

Also add `captchaToken` to `ContactInput`? No — keep `ContactInput` as-is (name/email/subject/message/company); read `captchaToken` via the cast shown above so `src/lib/contact.ts` stays focused on message validation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/contact-endpoint.test.ts`
Expected: PASS (original cases + 2 new captcha cases).

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/contact.ts test/lib/contact-endpoint.test.ts
git commit -m "feat: require a solved captcha token in /api/contact when active"
```

---

## Task 6: Config — `contact.captcha` knob

**Files:**
- Modify: `src/lib/config.ts`, `test/lib/config.test.ts`, `config.example.yaml`, `config.yaml`

- [ ] **Step 1: Add the assertion to the config test**

In `test/lib/config.test.ts`, after `expect(cfg.contact.enabled).toBe(true);` add:

```ts
    expect(cfg.contact.captcha).toBe(true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — `cfg.contact.captcha` is undefined.

- [ ] **Step 3: Update the `contact` schema block in `src/lib/config.ts`**

```ts
  contact: z
    .object({
      enabled: z.boolean().default(true),
      captcha: z.boolean().default(true),
    })
    .default({}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the knob**

In `config.example.yaml`, update the `contact:` block to add:
```yaml
  captcha: true                     # require the slide-puzzle captcha before sending (needs images in public/puzzles/)
```
In `config.yaml`, update the `contact:` block to:
```yaml
contact:
  enabled: true
  captcha: true
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml config.yaml
git commit -m "feat: contact.captcha config knob"
```

(`config.yaml` is gitignored; the `git add` will skip it — expected.)

---

## Task 7: Contact overlay — captcha panel markup + styles

**Files:**
- Modify: `src/components/ContactOverlay.astro`
- Modify: `src/styles/theme.css`

- [ ] **Step 1: Add the captcha panel markup**

In `src/components/ContactOverlay.astro`, add this block immediately AFTER the `<form id="contact-form" ...>...</form>` and BEFORE `<div class="contact-preview" ...>`:

```astro
    <div class="contact-captcha" id="contact-captcha" hidden>
      <p class="contact-boot">&gt; SECURITY CHECK — SLIDE THE PIECE INTO THE GAP</p>
      <div class="puzzle" id="puzzle">
        <img class="puzzle-bg" id="puzzle-bg" alt="" />
        <img class="puzzle-piece" id="puzzle-piece" alt="" />
      </div>
      <div class="puzzle-track" id="puzzle-track">
        <div class="puzzle-handle" id="puzzle-handle">&gt;&gt;</div>
      </div>
      <p class="contact-error" id="captcha-msg" hidden></p>
      <button class="contact-btn" id="captcha-back" type="button">&lt; BACK</button>
    </div>
```

- [ ] **Step 2: Add styles to `src/styles/theme.css`** (append):

```css
/* Puzzle captcha */
.puzzle { position: relative; width: 320px; max-width: 100%; margin: 0.5rem 0; border: 1px solid var(--fg-dim); }
.puzzle-bg { display: block; width: 100%; height: auto; }
.puzzle-piece { position: absolute; top: 0; left: 0; width: 56px; height: 56px; will-change: transform; }
.puzzle-track {
  position: relative; width: 320px; max-width: 100%; height: 2rem;
  border: 1px solid var(--fg-dim); margin-bottom: 0.5rem;
  display: flex; align-items: center;
}
.puzzle-handle {
  position: absolute; left: 0; top: 0; height: 100%;
  display: flex; align-items: center; justify-content: center;
  width: 3rem; background: var(--fg); color: var(--bg);
  cursor: grab; user-select: none; touch-action: none;
}
.puzzle-handle:active { cursor: grabbing; }
.contact-captcha .contact-btn { width: auto; }
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: build succeeds. (The component is imported by the layout, so this also recompiles the existing overlay script; behavior wiring for the captcha is added in the next task.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ContactOverlay.astro src/styles/theme.css
git commit -m "feat: captcha panel markup + styles in the contact overlay"
```

---

## Task 8: Contact overlay — captcha behavior

**Files:**
- Modify: `src/components/ContactOverlay.astro` (the existing `<script>`)

The existing overlay script has: `form.addEventListener('submit', ...)` that validates then shows the preview, a `showForm()` helper, and the APPROVE handler that POSTs `readInput()`. We insert a captcha step between SEND and PREVIEW, and add the solved token to the APPROVE POST.

- [ ] **Step 1: Add captcha state + element refs**

Inside the `if (overlay) {` block, near the other `getElementById` lookups at the top, add:

```ts
    const captchaPanel = document.getElementById('contact-captcha') as HTMLElement;
    const puzzleBg = document.getElementById('puzzle-bg') as HTMLImageElement;
    const puzzlePiece = document.getElementById('puzzle-piece') as HTMLImageElement;
    const puzzleTrack = document.getElementById('puzzle-track') as HTMLElement;
    const puzzleHandle = document.getElementById('puzzle-handle') as HTMLElement;
    const captchaMsg = document.getElementById('captcha-msg') as HTMLElement;
    let captchaToken: string | null = null;
    let puzzle: { token: string; pieceSize: number; width: number } | null = null;
```

- [ ] **Step 2: Replace the `showForm()` helper to also hide the captcha panel**

Find:
```ts
    function showForm() {
      preview.hidden = true; form.hidden = false;
      errorEl.hidden = true; statusEl.hidden = true;
    }
```
Replace with:
```ts
    function showForm() {
      preview.hidden = true; form.hidden = false; captchaPanel.hidden = true;
      errorEl.hidden = true; statusEl.hidden = true;
    }
    function showPreviewPane() {
      form.hidden = true; captchaPanel.hidden = true; preview.hidden = false; statusEl.hidden = true;
    }
```

- [ ] **Step 3: Add the captcha controller (paste before the `form.addEventListener('submit', ...)` block)**

```ts
    function toPreview() {
      const v = readInput();
      const composed =
        `FROM: ${v.name} <${v.email}>\n` +
        `SUBJ: ${v.subject}\n` +
        `──────────────\n` +
        `${v.message}`;
      showPreviewPane();
      typewrite(previewBody, composed);
    }

    async function loadPuzzle() {
      captchaMsg.hidden = true;
      puzzleHandle.style.left = '0px';
      puzzlePiece.style.transform = 'translateX(0px)';
      try {
        const res = await fetch('/api/captcha');
        const data = await res.json();
        if (!data.active) { captchaToken = null; toPreview(); return; }
        puzzle = { token: data.token, pieceSize: data.pieceSize, width: data.width };
        puzzleBg.src = data.background;
        puzzlePiece.src = data.piece;
        puzzlePiece.style.top = data.pieceY + 'px';
        puzzlePiece.style.width = data.pieceSize + 'px';
        puzzlePiece.style.height = data.pieceSize + 'px';
      } catch {
        // captcha unreachable -> degrade gracefully
        captchaToken = null; toPreview();
      }
    }

    function showCaptcha() {
      form.hidden = true; preview.hidden = true; captchaPanel.hidden = false;
      loadPuzzle();
    }

    // drag the handle -> move the piece; clamp to [0, width - pieceSize]
    let dragging = false;
    function maxX() { return (puzzle ? puzzle.width - puzzle.pieceSize : 0); }
    function setX(px: number) {
      const x = Math.max(0, Math.min(px, maxX()));
      puzzlePiece.style.transform = `translateX(${x}px)`;
      const handleMax = puzzleTrack.clientWidth - puzzleHandle.offsetWidth;
      puzzleHandle.style.left = (maxX() > 0 ? (x / maxX()) * handleMax : 0) + 'px';
      return x;
    }
    let currentX = 0;
    function pointerStart(e: PointerEvent) { dragging = true; puzzleHandle.setPointerCapture(e.pointerId); }
    function pointerMove(e: PointerEvent) {
      if (!dragging || !puzzle) return;
      const rect = puzzleTrack.getBoundingClientRect();
      const handleMax = puzzleTrack.clientWidth - puzzleHandle.offsetWidth;
      const ratio = handleMax > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / handleMax)) : 0;
      currentX = setX(ratio * maxX());
    }
    async function pointerEnd() {
      if (!dragging || !puzzle) return;
      dragging = false;
      try {
        const res = await fetch('/api/captcha', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: puzzle.token, x: Math.round(currentX) }),
        });
        const data = await res.json();
        if (data.ok) { captchaToken = puzzle.token; toPreview(); }
        else { captchaMsg.textContent = '> ACCESS DENIED — RECALIBRATING'; captchaMsg.hidden = false; loadPuzzle(); }
      } catch {
        captchaMsg.textContent = '> CHECKPOINT OFFLINE — RETRY'; captchaMsg.hidden = false;
      }
    }
    puzzleHandle.addEventListener('pointerdown', pointerStart);
    puzzleHandle.addEventListener('pointermove', pointerMove);
    puzzleHandle.addEventListener('pointerup', pointerEnd);
    puzzleHandle.addEventListener('pointercancel', () => { dragging = false; });
    document.getElementById('captcha-back')?.addEventListener('click', showForm);
```

- [ ] **Step 4: Change the SEND submit handler to go to the captcha (not straight to preview)**

Find the submit handler body:
```ts
      const composed =
        `FROM: ${v.name} <${v.email}>\n` +
        `SUBJ: ${v.subject}\n` +
        `──────────────\n` +
        `${v.message}`;
      form.hidden = true; preview.hidden = false; statusEl.hidden = true;
      typewrite(previewBody, composed);
```
Replace those lines with:
```ts
      showCaptcha();
```
(The full submit handler now reads: read input → if `clientError` show error and return → else `showCaptcha();`.)

- [ ] **Step 5: Include the solved token in the APPROVE POST**

In the APPROVE handler, change the body to include the token. Find:
```ts
          body: JSON.stringify(v),
```
Replace with:
```ts
          body: JSON.stringify({ ...v, captchaToken }),
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build succeeds; the overlay client script recompiles with the captcha logic (fix any TS error minimally, e.g. casts).

- [ ] **Step 7: Commit**

```bash
git add src/components/ContactOverlay.astro
git commit -m "feat: slide-puzzle captcha step between SEND and preview"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; build produces `dist/server/entry.mjs`.

- [ ] **Step 2: Start the server**

```bash
pkill -f "dist/server/entry.mjs" 2>/dev/null
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
```

- [ ] **Step 3: Exercise the captcha API**

```bash
# issue a challenge -> active:true with a token (gapX NOT present)
curl -s http://127.0.0.1:4321/api/captcha | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log("active",o.active,"token?",!!o.token,"bg?",(o.background||"").slice(0,11),"gapX-leaked?", "gapX" in o);})'
# verify with a wrong x -> {ok:false}
TOKEN=$(curl -s http://127.0.0.1:4321/api/captcha | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).token||""))')
curl -s -X POST http://127.0.0.1:4321/api/captcha -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"x\":999}" -w "  (wrong x)\n"
# contact without a solved token while captcha active -> 400 captcha required
curl -s -X POST http://127.0.0.1:4321/api/contact -H 'content-type: application/json' \
  -d '{"name":"Greg","email":"g@example.com","subject":"Hi","message":"Hello","company":""}' -w "  status=%{http_code}\n"
```

Expected: GET → `active true token? true bg? data:image/ gapX-leaked? false`; wrong-x verify → `{"ok":false}`; contact without token → `status=400` with `captcha required`.

- [ ] **Step 4: Manual browser check (http://localhost:4321)**

- Contact → fill valid fields → SEND → captcha panel appears with a background image (visible notch) and a piece at the left.
- Drag the handle so the piece overlaps the notch → release → on a good match, advance to the typewriter preview; on a bad match, `> ACCESS DENIED — RECALIBRATING` and a fresh puzzle.
- APPROVE → `> TRANSMISSION SENT` then redirect to `/` (stage mode forwards nothing but consumes the token).
- BACK from the captcha returns to the form with values intact.
- (Optional) set `contact.captcha: false` in `config.yaml`, restart → SEND goes straight to preview (no puzzle).

- [ ] **Step 5: Stop the server; commit any fixes**

```bash
pkill -f "dist/server/entry.mjs"
git add -A && git commit -m "fix: address issues found during captcha verification"
```
(Skip the commit if nothing changed.)

---

## Notes for the implementer

- **No Python:** all image work is `sharp` (libvips). Do not add any solver or Python.
- **gapX is secret:** it is stored only in `captcha-store`; never returned by `GET /api/captcha`. The verify endpoint compares server-side.
- **Degradation:** `captchaActive() === false` (disabled or no images) makes `GET /api/captcha` return `{active:false}`; the client then skips to preview, and `/api/contact` does not require a token. This keeps contact working with zero puzzle images.
- **Runtime image path:** puzzles live in `public/puzzles/` (dev) and are copied to `dist/client/puzzles/` at build (container runtime). `listPuzzles()` checks both.
- **Token store is per-process:** fine for the single-instance container; a restart invalidates open puzzles (the user just gets a new one).
- **Pointer drag** uses Pointer Events (mouse + touch). `touch-action: none` on the handle prevents scroll-stealing on mobile.
- The captcha gates *after* field validation and *before* the preview, per the spec.
