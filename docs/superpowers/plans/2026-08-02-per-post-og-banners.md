# Per-Post OG Banners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cached runtime endpoint `/og/{blog|transmissions}/<slug>.png` that renders a unique, on-brand 1200×630 social-embed banner for every post and transmission, with the static default banner as the fallback on every failure path.

**Architecture:** A pure SVG-building lib (`card.ts`: fixed-width text fitting + template) feeds a resvg-based rasterizer (`render.ts`: bundled VT323 font buffer, blobHash-keyed FIFO cache, default-banner fallback). A thin Astro APIRoute wires it to the ContentStore. Spec: `docs/superpowers/specs/2026-08-02-per-post-og-banners-design.md`.

**Tech Stack:** Astro SSR (node adapter), TypeScript, `@resvg/resvg-js` (new dep), vitest.

## Global Constraints

- The endpoint must **never return 500**; every failure path serves the default banner (or 404 only if the default itself is missing from the build — matches `vaultboy.gif.ts`).
- Colors/typography: VT323, `#33ff66` on `#0b0f0b`, scanlines, vignette — matching `src/styles/theme.css`.
- Card geometry: 1200×630, margin 96, title sizes step 96→84→72→60px, max 4 lines, ellipsize overflow.
- Cache: `Map<blobHash, Buffer>`, FIFO cap 200 entries; HTTP `cache-control: public, max-age=3600`.
- Prod is `node:22-alpine` on arm64 (musl) — `@resvg/resvg-js` ships prebuilds for linux-arm64-musl and darwin-arm64; **no Dockerfile changes**.
- Do NOT use sharp for this: sharp/librsvg resolves fonts via fontconfig (absent in Alpine) and cannot take a font buffer. resvg takes the font as an in-memory buffer.
- Font ships at `public/fonts/VT323-Regular.ttf` (+ `OFL.txt`) — public/ lands in `dist/client/` at build, readable at runtime via the same two-path lookup `vaultboy.gif.ts` uses. (Spec said `src/lib/og/`; moved to `public/fonts/` because Vite's SSR bundle does not copy arbitrary `src/` assets to `dist/`, and the font is OFL-licensed so serving it is fine.)
- Existing suite (295 tests) must stay green: `npm test`.

---

### Task 1: `card.ts` — text fitting + SVG template (pure)

**Files:**
- Create: `src/lib/og/card.ts`
- Test: `test/lib/og-card.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces (used by Tasks 2–4):
  - `interface CardInput { header: string; title: string; meta: string }`
  - `wrapTitle(title: string, maxChars: number): string[]`
  - `fitTitle(title: string): { fontSize: number; lines: string[] }`
  - `buildCardSvg(input: CardInput): string`
  - `const ADVANCE = 0.5` (exported; VT323 advance-width ≈ 0.5 em — pixel font on a half-width grid)

- [ ] **Step 1: Write the failing tests**

```ts
// test/lib/og-card.test.ts
import { describe, it, expect } from 'vitest';
import { wrapTitle, fitTitle, buildCardSvg, ADVANCE } from '../../src/lib/og/card';

describe('wrapTitle', () => {
  it('keeps a short title on one line', () => {
    expect(wrapTitle('Hello World', 20)).toEqual(['Hello World']);
  });
  it('wraps on word boundaries at exactly maxChars', () => {
    expect(wrapTitle('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
  });
  it('hard-breaks a single word longer than the line', () => {
    expect(wrapTitle('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('collapses runs of whitespace', () => {
    expect(wrapTitle('a   b\t c', 20)).toEqual(['a b c']);
  });
});

describe('fitTitle', () => {
  it('uses the largest size (96) for a short title', () => {
    expect(fitTitle('Short').fontSize).toBe(96);
  });
  it('steps down when the wrap exceeds 4 lines', () => {
    // At 96px: maxChars = floor(1008 / 48) = 21 → many lines; must step down.
    const long = 'word '.repeat(30).trim();
    const { fontSize, lines } = fitTitle(long);
    expect(fontSize).toBeLessThan(96);
    expect(lines.length).toBeLessThanOrEqual(4);
  });
  it('clamps to 4 lines at 60px and ellipsizes the last line', () => {
    const extreme = 'word '.repeat(80).trim();
    const { fontSize, lines } = fitTitle(extreme);
    expect(fontSize).toBe(60);
    expect(lines.length).toBe(4);
    expect(lines[3].endsWith('…')).toBe(true);
  });
  it('does not ellipsize when the title fits exactly', () => {
    const { lines } = fitTitle('Serving a Public Website From My Home Cluster');
    expect(lines.join(' ').includes('…')).toBe(false);
  });
});

describe('buildCardSvg', () => {
  const input = { header: 'GregCo // Personal log', title: 'A <Great> Post & More', meta: '2026-07-14 · 6 min read' };
  it('is a 1200x630 svg using VT323', () => {
    const svg = buildCardSvg(input);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('font-family="VT323"');
  });
  it('escapes XML in header/title/meta', () => {
    const svg = buildCardSvg(input);
    expect(svg).toContain('A &lt;Great&gt; Post &amp; More');
    expect(svg).not.toContain('<Great>');
  });
  it('contains header, divider rule, meta and block cursor', () => {
    const svg = buildCardSvg(input);
    expect(svg).toContain('GregCo // Personal log');
    expect(svg).toContain('2026-07-14 · 6 min read');
    // divider + cursor are rects filled with the theme green
    expect((svg.match(/<rect [^>]*fill="#33ff66"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('renders one <text> per wrapped title line', () => {
    const long = 'word '.repeat(30).trim();
    const { lines } = fitTitle(long);
    const svg = buildCardSvg({ header: 'h', title: long, meta: 'm' });
    // texts: 1 header + lines + 1 meta
    expect((svg.match(/<text /g) ?? []).length).toBe(lines.length + 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/og-card.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/og/card'`

- [ ] **Step 3: Implement `src/lib/og/card.ts`**

```ts
// Pure SVG card template for social-embed (Open Graph) banners.
// Log-entry style: header + divider + wrapped title + meta with block cursor.
// VT323 is fixed-width, so fitting is exact arithmetic — no text measuring.
// See docs/superpowers/specs/2026-08-02-per-post-og-banners-design.md.

export interface CardInput {
  header: string;
  title: string;
  meta: string;
}

const W = 1200;
const H = 630;
const MARGIN = 96;
const MAX_TEXT_WIDTH = W - 2 * MARGIN; // 1008
/** VT323 advance-width ratio (advance / font-size). Pixel font, half-width grid. */
export const ADVANCE = 0.5;
const TITLE_SIZES = [96, 84, 72, 60];
const MAX_LINES = 4;

/** Word-wrap at maxChars; hard-break words longer than a whole line. */
export function wrapTitle(title: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const word of title.split(/\s+/).filter(Boolean)) {
    let w = word;
    if (cur && (cur + ' ' + w).length <= maxChars) {
      cur += ' ' + w;
      continue;
    }
    push();
    while (w.length > maxChars) {
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    cur = w;
  }
  push();
  return lines;
}

/** Step the font size down until the wrapped title fits; clamp + ellipsize at minimum. */
export function fitTitle(title: string): { fontSize: number; lines: string[] } {
  for (const fontSize of TITLE_SIZES) {
    const maxChars = Math.floor(MAX_TEXT_WIDTH / (fontSize * ADVANCE));
    const lines = wrapTitle(title, maxChars);
    if (lines.length <= MAX_LINES) return { fontSize, lines };
  }
  const fontSize = TITLE_SIZES[TITLE_SIZES.length - 1];
  const maxChars = Math.floor(MAX_TEXT_WIDTH / (fontSize * ADVANCE));
  const all = wrapTitle(title, maxChars);
  const lines = all.slice(0, MAX_LINES);
  const last = lines[MAX_LINES - 1];
  lines[MAX_LINES - 1] = (last.length + 1 > maxChars ? last.slice(0, maxChars - 1) : last) + '…';
  return { fontSize, lines };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildCardSvg(input: CardInput): string {
  const { fontSize, lines } = fitTitle(input.title);
  const lineH = Math.round(fontSize * 1.05);
  // Title block vertically centered between divider (y≈130) and meta (y≈540).
  const blockTop = 150 + Math.max(0, Math.round((380 - lines.length * lineH) / 2));
  const titleTexts = lines
    .map(
      (l, i) =>
        `<text x="${MARGIN}" y="${blockTop + Math.round((i + 0.8) * lineH)}" font-size="${fontSize}" fill="#33ff66">${esc(l)}</text>`
    )
    .join('\n  ');
  const metaSize = 34;
  const cursorX = MARGIN + Math.round(input.meta.length * metaSize * ADVANCE) + 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="VT323">
  <rect width="${W}" height="${H}" fill="#0b0f0b"/>
  <defs>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect y="2" width="4" height="1" fill="#000000" opacity="0.28"/>
    </pattern>
    <radialGradient id="vig" cx="30%" cy="20%" r="90%">
      <stop offset="0%" stop-color="#33ff66" stop-opacity="0.10"/>
      <stop offset="60%" stop-color="#33ff66" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <text x="${MARGIN}" y="96" font-size="30" fill="#33ff66" opacity="0.85">${esc(input.header)}</text>
  <rect x="${MARGIN}" y="118" width="${MAX_TEXT_WIDTH}" height="2" fill="#33ff66" opacity="0.6"/>
  ${titleTexts}
  <text x="${MARGIN}" y="556" font-size="${metaSize}" fill="#33ff66" opacity="0.9">${esc(input.meta)}</text>
  <rect x="${cursorX}" y="528" width="18" height="34" fill="#33ff66"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
</svg>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/og-card.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/lib/og/card.ts test/lib/og-card.test.ts
git commit -m "feat(og): card SVG template with exact VT323 text fitting"
```

---

### Task 2: font vendoring + `render.ts` — resvg rasterizer, cache, fallback

**Files:**
- Create: `public/fonts/VT323-Regular.ttf`, `public/fonts/OFL.txt`
- Create: `src/lib/og/render.ts`
- Modify: `package.json` (+ `@resvg/resvg-js`)
- Test: `test/lib/og-render.test.ts`

**Interfaces:**
- Consumes: `buildCardSvg(input: CardInput): string`, `interface CardInput` from `src/lib/og/card.ts` (Task 1).
- Produces (used by Task 3):
  - `renderCardPng(key: string, input: CardInput): Buffer | null` — cached render; `null` on any failure (already warned).
  - `defaultBannerPng(): Buffer | null` — default-banner bytes, read once; `null` only if missing from build.
  - `__resetOgCacheForTests(): void`

- [ ] **Step 1: Install dep and vendor the font**

```bash
npm install @resvg/resvg-js
mkdir -p public/fonts
curl -fsSL -o public/fonts/VT323-Regular.ttf \
  "https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf"
curl -fsSL -o public/fonts/OFL.txt \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt"
# sanity: a real TTF starts with 00 01 00 00
xxd -l 4 public/fonts/VT323-Regular.ttf
```

Expected: `xxd` prints `0001 0000`. If the download 404s, get the file from https://fonts.google.com/specimen/VT323 (Download family) instead — commit the same two files.

- [ ] **Step 2: Write the failing tests**

```ts
// test/lib/og-render.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderCardPng, defaultBannerPng, __resetOgCacheForTests } from '../../src/lib/og/render';

const input = { header: 'GregCo // Personal log', title: 'A Test Post', meta: '2026-07-14 · 6 min read' };

describe('renderCardPng', () => {
  beforeEach(() => __resetOgCacheForTests());

  it('renders a PNG (magic bytes, nonzero length)', () => {
    const png = renderCardPng('k1', input);
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47'); // \x89PNG
    expect(png!.length).toBeGreaterThan(1000);
  });

  it('returns the identical Buffer for the same key (cache hit)', () => {
    const a = renderCardPng('k1', input);
    const b = renderCardPng('k1', { ...input, title: 'Ignored — cache key wins' });
    expect(b).toBe(a);
  });

  it('renders distinct output for a different key/title', () => {
    const a = renderCardPng('k1', input);
    const b = renderCardPng('k2', { ...input, title: 'A Completely Different Title' });
    expect(b).not.toBeNull();
    expect(a!.equals(b!)).toBe(false);
  });
});

describe('defaultBannerPng', () => {
  it('returns the committed default banner bytes', () => {
    const png = defaultBannerPng();
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/lib/og-render.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/og/render'`

- [ ] **Step 4: Implement `src/lib/og/render.ts`**

```ts
// resvg wiring for OG cards: bundled-font rasterization, blobHash-keyed FIFO
// cache, and the default-banner fallback bytes. sharp is NOT used here — its
// librsvg text path needs fontconfig/system fonts (absent on Alpine); resvg
// takes the font as an in-memory buffer.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, existsSync } from 'node:fs';
import { buildCardSvg, type CardInput } from './card';

// public/ ships to dist/client at build; same lookup convention as vaultboy.gif.ts.
const FONT_SOURCES = ['./dist/client/fonts/VT323-Regular.ttf', './public/fonts/VT323-Regular.ttf'];
const DEFAULT_SOURCES = ['./dist/client/og-default.png', './public/og-default.png'];

function readFirst(paths: string[]): Buffer | null {
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

let fontBuf: Buffer | null | undefined;
let defaultBuf: Buffer | null | undefined;

export function defaultBannerPng(): Buffer | null {
  if (defaultBuf === undefined) defaultBuf = readFirst(DEFAULT_SOURCES);
  return defaultBuf;
}

const cache = new Map<string, Buffer>();
const CACHE_MAX = 200;
const warned = new Set<string>();

/** Cached SVG→PNG render. Returns null on any failure (warned once per key). */
export function renderCardPng(key: string, input: CardInput): Buffer | null {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (fontBuf === undefined) fontBuf = readFirst(FONT_SOURCES);
    if (!fontBuf) throw new Error('VT323-Regular.ttf not found');
    const png = Buffer.from(
      new Resvg(buildCardSvg(input), {
        font: { fontBuffers: [fontBuf], defaultFontFamily: 'VT323', loadSystemFonts: false },
      })
        .render()
        .asPng()
    );
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, png);
    return png;
  } catch (err) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[og] render failed for ${key}: ${(err as Error).message}`);
    }
    return null;
  }
}

export function __resetOgCacheForTests(): void {
  cache.clear();
  warned.clear();
  fontBuf = undefined;
  defaultBuf = undefined;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/lib/og-render.test.ts`
Expected: PASS (all). If the resvg native module fails to load, stop and report — do not work around with sharp.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json public/fonts src/lib/og/render.ts test/lib/og-render.test.ts
git commit -m "feat(og): resvg rasterizer with bundled VT323, cache, and default fallback"
```

---

### Task 3: endpoint — `/og/[collection]/[slug].png`

**Files:**
- Create: `src/pages/og/[collection]/[slug].png.ts`
- Test: `test/lib/og-endpoint.test.ts`

**Interfaces:**
- Consumes: `renderCardPng`, `defaultBannerPng` (Task 2); `CardInput` (Task 1); `ensureStarted` from `src/lib/store-singleton`; `getConfig` from `src/lib/config`; `Post`/`Transmission` types from `src/lib/content-store`.
- Produces (used by Task 4 and tests):
  - `interface OgLookup { key: string; card: CardInput }`
  - `interface OgDeps { lookup(collection: string, slug: string): OgLookup | undefined }`
  - `handleOgCard(collection: string, slug: string, deps: OgDeps): { status: number; contentType: string; body: Buffer | string }`
  - `postCard(siteTitle: string, post: Pick<Post, 'title' | 'date' | 'readingMinutes' | 'blobHash'>): OgLookup`
  - `transmissionCard(siteTitle: string, tx: Pick<Transmission, 'title' | 'date' | 'blobHash'>): OgLookup`

- [ ] **Step 1: Write the failing tests**

```ts
// test/lib/og-endpoint.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleOgCard, postCard, transmissionCard } from '../../src/pages/og/[collection]/[slug].png';
import { __resetOgCacheForTests } from '../../src/lib/og/render';

const post = { title: 'A Test Post', date: '2026-07-14', readingMinutes: 6, blobHash: 'abc123' };
const deps = {
  lookup: (c: string, s: string) =>
    c === 'blog' && s === 'a-test-post' ? postCard('GregCo', post) : undefined,
};
const defaultBytes = () => readFileSync('./public/og-default.png');

describe('handleOgCard', () => {
  beforeEach(() => __resetOgCacheForTests());

  it('200 image/png for a live post', () => {
    const r = handleOgCard('blog', 'a-test-post', deps);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    expect((r.body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47');
    // a rendered card, not the fallback
    expect((r.body as Buffer).equals(defaultBytes())).toBe(false);
  });

  it('unknown slug → 200 default banner, not 500 (also covers hidden/draft: lookup returns undefined)', () => {
    const r = handleOgCard('blog', 'nope', deps);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).equals(defaultBytes())).toBe(true);
  });

  it('invalid collection → 200 default banner without calling lookup', () => {
    let called = false;
    const r = handleOgCard('evil', 'x', { lookup: () => ((called = true), undefined) });
    expect(r.status).toBe(200);
    expect(called).toBe(false);
    expect((r.body as Buffer).equals(defaultBytes())).toBe(true);
  });
});

describe('card builders', () => {
  it('postCard: header, meta with reading time, blobHash key', () => {
    const { key, card } = postCard('GregCo', post);
    expect(key).toBe('post:abc123');
    expect(card.header).toBe('GregCo // Personal log');
    expect(card.meta).toBe('2026-07-14 · 6 min read');
    expect(card.title).toBe('A Test Post');
  });
  it('postCard omits the date separator for undated posts', () => {
    expect(postCard('G', { ...post, date: '' }).card.meta).toBe('6 min read');
  });
  it('transmissionCard: Transmission log header and meta', () => {
    const { key, card } = transmissionCard('GregCo', { title: 'T', date: '2026-07-19', blobHash: 'z9' });
    expect(key).toBe('tx:z9');
    expect(card.header).toBe('GregCo // Transmission log');
    expect(card.meta).toBe('2026-07-19 · Transmission');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/og-endpoint.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/pages/og/[collection]/[slug].png.ts`**

```ts
import type { APIRoute } from 'astro';
import { ensureStarted } from '../../../lib/store-singleton';
import { getConfig } from '../../../lib/config';
import { renderCardPng, defaultBannerPng } from '../../../lib/og/render';
import type { CardInput } from '../../../lib/og/card';
import type { Post, Transmission } from '../../../lib/content-store';

export interface OgLookup {
  key: string;
  card: CardInput;
}
export interface OgDeps {
  lookup(collection: string, slug: string): OgLookup | undefined;
}

export function postCard(
  siteTitle: string,
  post: Pick<Post, 'title' | 'date' | 'readingMinutes' | 'blobHash'>
): OgLookup {
  return {
    key: `post:${post.blobHash}`,
    card: {
      header: `${siteTitle} // Personal log`,
      title: post.title,
      meta: `${post.date ? post.date + ' · ' : ''}${post.readingMinutes} min read`,
    },
  };
}

export function transmissionCard(
  siteTitle: string,
  tx: Pick<Transmission, 'title' | 'date' | 'blobHash'>
): OgLookup {
  return {
    key: `tx:${tx.blobHash}`,
    card: {
      header: `${siteTitle} // Transmission log`,
      title: tx.title,
      meta: `${tx.date ? tx.date + ' · ' : ''}Transmission`,
    },
  };
}

/** Testable core. Never 500s: any miss or render failure serves the default banner. */
export function handleOgCard(
  collection: string,
  slug: string,
  deps: OgDeps
): { status: number; contentType: string; body: Buffer | string } {
  const valid = collection === 'blog' || collection === 'transmissions';
  const found = valid ? deps.lookup(collection, slug) : undefined;
  const png = found ? renderCardPng(found.key, found.card) : null;
  const body = png ?? defaultBannerPng();
  // Default missing = broken build; mirror vaultboy.gif.ts's 404.
  if (!body) return { status: 404, contentType: 'text/plain', body: 'Not found' };
  return { status: 200, contentType: 'image/png', body };
}

export const GET: APIRoute = async ({ params }) => {
  const cfg = getConfig();
  const store = await ensureStarted();
  const now = new Date();
  const res = handleOgCard(String(params.collection), String(params.slug), {
    lookup: (collection, slug) => {
      if (collection === 'blog') {
        const p = store.getLivePost(`/${slug}`, now);
        return p ? postCard(cfg.site.title, p) : undefined;
      }
      // getLiveTransmission already excludes drafts/hidden/scheduled entries;
      // when transmissions are disabled the card falls back to the default.
      if (!cfg.transmissions.enabled) return undefined;
      const t = store.getLiveTransmission(`/transmissions/${slug}`, now);
      return t ? transmissionCard(cfg.site.title, t) : undefined;
    },
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.contentType,
      ...(res.status === 200 ? { 'cache-control': 'public, max-age=3600' } : {}),
    },
  });
};
```

Note: check `cfg.transmissions.enabled` exists in `src/lib/config.ts` (the transmissions page reads it). If the config key path differs, match whatever `src/pages/transmissions/[slug].astro` uses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/og-endpoint.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add "src/pages/og/[collection]/[slug].png.ts" test/lib/og-endpoint.test.ts
git commit -m "feat(og): per-post banner endpoint with default fallback"
```

---

### Task 4: wire pages, regenerate the default banner, full verification

**Files:**
- Modify: `src/pages/[slug].astro` (the `<Terminal …>` opening tag)
- Modify: `src/pages/transmissions/[slug].astro` (the `<Terminal …>` opening tag)
- Create: `scripts/render-og-default.ts`
- Modify: `public/og-default.png` (regenerated)

**Interfaces:**
- Consumes: `buildCardSvg` (Task 1), font file (Task 2), `Terminal.astro`'s existing `image?: string` prop (relative paths are absolutized against `site.baseUrl` — no layout change needed).
- Produces: final user-visible wiring; nothing downstream.

- [ ] **Step 1: Pass the per-post image to Terminal**

In `src/pages/[slug].astro`, the opening tag currently reads:

```astro
<Terminal title={post.title} description={post.description ?? post.excerpt} ogType="article">
```

change it to:

```astro
<Terminal title={post.title} description={post.description ?? post.excerpt} ogType="article" image={`/og/blog/${slug}.png`}>
```

In `src/pages/transmissions/[slug].astro`, the opening tag currently reads:

```astro
<Terminal title={tx.title} description={tx.description} ogType="article">
```

change it to:

```astro
<Terminal title={tx.title} description={tx.description} ogType="article" image={`/og/transmissions/${slug}.png`}>
```

- [ ] **Step 2: Write `scripts/render-og-default.ts`**

```ts
// One-off: regenerate public/og-default.png from the shared card template so
// the static default and the runtime cards look identical.
// Run: node --experimental-strip-types scripts/render-og-default.ts
//      (node < 22.6: npx tsx scripts/render-og-default.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { buildCardSvg } from '../src/lib/og/card.ts';

const font = readFileSync('./public/fonts/VT323-Regular.ttf');
const svg = buildCardSvg({
  header: 'justcallmegreg.io // Personal log',
  title: 'GregCo Industries Unified Operating System',
  meta: 'Personal log — Commonwealth relay node',
});
const png = new Resvg(svg, {
  font: { fontBuffers: [font], defaultFontFamily: 'VT323', loadSystemFonts: false },
})
  .render()
  .asPng();
writeFileSync('./public/og-default.png', png);
console.log(`wrote public/og-default.png (${png.length} bytes)`);
```

- [ ] **Step 3: Regenerate the default banner and eyeball it**

```bash
node --experimental-strip-types scripts/render-og-default.ts
```

Expected: `wrote public/og-default.png (...)`. Then view the PNG (Read tool / open it): green-on-black, VT323 rendering correctly (not a fallback serif), header + divider + 2–3 title lines + meta + cursor, scanlines visible. **If the text renders in a non-VT323 font or the layout is off (title overflowing margins, cursor overlapping text), fix `card.ts` geometry before proceeding — this render is the calibration check for `ADVANCE`.**

- [ ] **Step 4: Full suite + build**

```bash
npm test
npm run build
```

Expected: all tests pass (og-render/og-endpoint tests re-read the regenerated default — they only assert PNG magic bytes, so they stay green); build clean.

- [ ] **Step 5: Live end-to-end check**

```bash
npm run dev &
sleep 8
# real post slug from the home page
slug=$(curl -s http://localhost:4321/ | grep -oE 'href="/[a-z0-9-]+"' | grep -viE 'about|contributions|transmissions|decks|overseer' | head -1 | sed -E 's/href="\/(.*)"/\1/')
curl -s -o /tmp/card.png -w "card: %{http_code} %{content_type} %{size_download}B\n" "http://localhost:4321/og/blog/$slug.png"
curl -s "http://localhost:4321/$slug" | grep -oE '<meta property="og:image"[^>]*>'
curl -s -o /dev/null -w "fallback: %{http_code} %{content_type}\n" "http://localhost:4321/og/blog/does-not-exist.png"
```

Expected: card 200 `image/png`; the post's `og:image` points at `/og/blog/<slug>.png` (absolutized); fallback 200 `image/png`. View `/tmp/card.png` (Read tool) — the real post title, wrapped and fitted. Kill the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add src/pages/\[slug\].astro src/pages/transmissions/\[slug\].astro scripts/render-og-default.ts public/og-default.png
git commit -m "feat(og): wire per-post banners into pages; unify default banner with card template"
```

---

## Self-Review Notes

- **Spec coverage:** card style + template (T1), renderer/font/no-Dockerfile (T2), endpoint/cache/fallback/never-500 (T3), wiring + unified default + script (T4), tests specced per file (T1–T3 test files, T4 runs suite). Hidden-post no-leak: covered — `getLivePost`/`getLiveTransmission` exclude them, endpoint test covers the undefined-lookup path.
- **Font location deviation from spec** (`public/fonts/` instead of `src/lib/og/`) is intentional and documented in Global Constraints (Vite SSR bundling; OFL license permits serving).
- **Type consistency:** `CardInput {header,title,meta}` used identically in T1/T2/T3/T4; `renderCardPng(key, input)` and `defaultBannerPng()` signatures match between T2 definition and T3 usage; `OgLookup {key, card}` consistent across T3 tests and implementation.
