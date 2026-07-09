# Decks Route (`/decks/<slug>`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Pip-Boy presentation decks from the content repo at `/decks/<slug>` — deck Markdown (the dialect) rendered server-side with the engine's existing pipeline, displayed in the Pip-Boy device shell.

**Architecture:** A pure dialect parser (`src/lib/deck.ts`) turns a deck file into `{ meta, slides }`; the `ContentStore` gains a second index for decks (classified by a `decks/` prefix in the content repo), rendering each slide with the existing `renderMarkdown` (remark/rehype/Shiki + `pre.mermaid` for the client Mermaid runtime) and reusing the existing `publishAt`/draft gating. A new `Presenter.astro` layout is the Pip-Boy template ported from the committed mockup; two routes expose the deck page and its assets.

**Tech Stack:** Astro SSR (Node), TypeScript, Zod, gray-matter, existing remark/rehype/Shiki pipeline, existing Mermaid runtime component, Vitest (node env).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-deck-dialect-and-presenter-design.md`. Porting source: `mockups/pipboy-presenter.html` (verified mockup, committed).
- **Posts must be byte-for-byte unaffected.** Deck classification happens on a `decks/` path prefix checked *before* the existing post logic; every existing test must stay green.
- Layouts (exact set): `title`, `default`, `stat`, `two-col`, `standby`. Directive: `<!-- slide: X -->` as the slide's first line; no directive → `default`; slide 1 with no directive → `title` (the only implicit rule). Unknown layout → `default` + `console.warn`.
- Reuse, do not duplicate: `renderMarkdown` (markdown→HTML), `parsePublishAt`, `pickPublishedDate`, `firstAddedDate`, the `isLive` gating pattern, `MermaidRuntime`.
- Deck URL/prefix: `/decks/<slug>`; content path in the repo: `<decksSubdir>/{namespace}/{slug}/index.md`; assets in `assets/` next to `index.md`. `content.decksSubdir` config defaults to `"decks"`.
- **Slides hide with `visibility: hidden`, never `display: none`** — Mermaid must measure hidden slides at load or SVGs render zero-width.
- `Presenter.astro` imports `src/styles/theme.css` (brings the VT323 `@import`, Fallout Mermaid SVG overrides, zoom pane, Shiki line numbers); presenter-specific CSS is `is:global` and scoped under `.pb-body` (Astro's scoped styles cannot match `set:html` content).
- Tests deterministic: always pass explicit `now: Date`. Run `npm test`; build with `npm run build`.

---

### Task 1: Deck dialect parser — `src/lib/deck.ts`

**Files:**
- Create: `src/lib/deck.ts`
- Test: `test/lib/deck.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DECK_LAYOUTS = ['title', 'default', 'stat', 'two-col', 'standby'] as const;
  export type DeckLayout = (typeof DECK_LAYOUTS)[number];
  export interface ParsedSlide { layout: DeckLayout; head: string | null; parts: string[] }
  export interface ParsedDeck { meta: DeckFrontmatter; slides: ParsedSlide[] }
  export interface DeckSlideHtml { layout: DeckLayout; html: string }
  export function parseDeckSource(raw: string): ParsedDeck;
  export function renderDeckSlides(deck: ParsedDeck, render: (md: string) => Promise<string>): Promise<DeckSlideHtml[]>;
  ```
  `DeckFrontmatter` = `{ title?, subtitle?, author?, date?, theme (default 'pipboy'), draft (default false), publishAt? }`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/deck.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseDeckSource, renderDeckSlides } from '../../src/lib/deck';

const DECK = `---
title: "DEMO"
subtitle: "SUB"
publishAt: "2030-01-01T09:00"
---

EYEBROW LINE

# BIG TITLE

SUBTITLE LINE

---

## LIST SLIDE

- ONE
- TWO

---

## DIAGRAM

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

---

<!-- slide: stat -->

# 42%

LABEL

---

<!-- slide: two-col -->

## SPLIT

LEFT SIDE

<!-- col -->

RIGHT SIDE

---

<!-- slide: standby -->

# BYE
`;

describe('parseDeckSource', () => {
  it('parses frontmatter with defaults', () => {
    const d = parseDeckSource(DECK);
    expect(d.meta.title).toBe('DEMO');
    expect(d.meta.subtitle).toBe('SUB');
    expect(d.meta.theme).toBe('pipboy');
    expect(d.meta.draft).toBe(false);
    expect(d.meta.publishAt).toBe('2030-01-01T09:00');
  });

  it('splits slides on --- and applies layout rules', () => {
    const d = parseDeckSource(DECK);
    expect(d.slides.map((s) => s.layout)).toEqual([
      'title', 'default', 'default', 'stat', 'two-col', 'standby',
    ]);
  });

  it('does not split on --- inside fenced code', () => {
    const d = parseDeckSource('# A\n\n```text\n---\n```\n\n---\n\n# B\n');
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0].parts[0]).toContain('---');
  });

  it('falls back to default on an unknown layout and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = parseDeckSource('<!-- slide: hologram -->\n# X\n');
    // A directive WAS present (just unknown), so the slide-1 auto-`title` rule
    // does not apply — the fallback is `default`.
    expect(d.slides[0].layout).toBe('default');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hologram'));
    warn.mockRestore();
  });

  it('derives a missing title from the first slide H1', () => {
    const d = parseDeckSource('# DERIVED\n\nbody\n');
    expect(d.meta.title).toBe('DERIVED');
  });

  it('splits two-col parts and extracts the leading heading', () => {
    const d = parseDeckSource(DECK);
    const tc = d.slides[4];
    expect(tc.head).toBe('## SPLIT');
    expect(tc.parts).toEqual(['LEFT SIDE', 'RIGHT SIDE']);
  });

  it('throws a clear error on wrong frontmatter types', () => {
    expect(() => parseDeckSource('---\ntitle: 5\n---\nbody')).toThrow(/title/);
  });
});

describe('renderDeckSlides', () => {
  const fake = async (md: string) => `[${md}]`;

  it('renders one part per normal slide', async () => {
    const d = parseDeckSource('# A\n\n---\n\n## B\n');
    const out = await renderDeckSlides(d, fake);
    expect(out).toEqual([
      { layout: 'title', html: '[# A]' },
      { layout: 'default', html: '[## B]' },
    ]);
  });

  it('assembles two-col with head + cols wrapper', async () => {
    const d = parseDeckSource('<!-- slide: two-col -->\n## H\n\nL\n\n<!-- col -->\n\nR\n');
    const out = await renderDeckSlides(d, fake);
    expect(out[0].html).toBe(
      '[## H]<div class="cols"><div class="col">[L]</div><div class="col">[R]</div></div>'
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- deck`
Expected: FAIL — module `src/lib/deck.ts` not found.

- [ ] **Step 3: Implement `src/lib/deck.ts`**

```ts
import matter from 'gray-matter';
import { z } from 'zod';

// The deck dialect: one Markdown file = frontmatter + slides separated by `---`
// (outside fenced code). See docs/superpowers/specs/2026-07-09-deck-dialect-and-presenter-design.md.

const DeckFrontmatterSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  theme: z.string().default('pipboy'),
  draft: z.boolean().default(false),
  publishAt: z.string().optional(),
});
export type DeckFrontmatter = z.infer<typeof DeckFrontmatterSchema>;

export const DECK_LAYOUTS = ['title', 'default', 'stat', 'two-col', 'standby'] as const;
export type DeckLayout = (typeof DECK_LAYOUTS)[number];

export interface ParsedSlide {
  layout: DeckLayout;
  /** Leading #/## heading of a two-col slide, rendered full-width above the columns. */
  head: string | null;
  /** Markdown sources: one entry normally; [left, right] for two-col. */
  parts: string[];
}
export interface ParsedDeck {
  meta: DeckFrontmatter;
  slides: ParsedSlide[];
}

export function parseDeckSource(raw: string): ParsedDeck {
  const parsed = matter(raw);
  const result = DeckFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid deck frontmatter: ${issues}`);
  }
  const meta = result.data;

  // Split slides on `---` lines outside fenced code blocks.
  const chunks: string[][] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of parsed.content.replace(/\r/g, '').split('\n')) {
    if (/^```/.test(line.trim())) fence = !fence;
    if (!fence && line.trim() === '---') {
      chunks.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  chunks.push(cur);

  const slides: ParsedSlide[] = chunks
    .map((c) => c.join('\n').trim())
    .filter(Boolean)
    .map((src, i) => {
      let layout: string | null = null;
      const m = /^<!--\s*slide:\s*([\w-]+)\s*-->\s*\n?/.exec(src);
      if (m) {
        layout = m[1];
        src = src.slice(m[0].length).trim();
      }
      if (layout && !(DECK_LAYOUTS as readonly string[]).includes(layout)) {
        console.warn(`[deck] unknown layout "${layout}" — using default`);
        layout = 'default';
      }
      if (!layout) layout = i === 0 ? 'title' : 'default';

      if (layout === 'two-col') {
        const cols = src.split(/^<!--\s*col\s*-->\s*$/m);
        let a = (cols[0] ?? '').trim();
        let head: string | null = null;
        const hm = /^(##?\s+.+)\n?/.exec(a);
        if (hm) {
          head = hm[1];
          a = a.slice(hm[0].length).trim();
        }
        return { layout: 'two-col' as DeckLayout, head, parts: [a, (cols[1] ?? '').trim()] };
      }
      return { layout: layout as DeckLayout, head: null, parts: [src] };
    });

  if (!meta.title) {
    const h = /^#\s+(.+)$/m.exec(slides[0]?.parts[0] ?? '');
    if (h) meta.title = h[1];
  }
  return { meta, slides };
}

export interface DeckSlideHtml {
  layout: DeckLayout;
  html: string;
}

/** Assemble each slide's HTML with the caller-supplied markdown renderer. */
export async function renderDeckSlides(
  deck: ParsedDeck,
  render: (md: string) => Promise<string>
): Promise<DeckSlideHtml[]> {
  const out: DeckSlideHtml[] = [];
  for (const s of deck.slides) {
    let html = s.head ? await render(s.head) : '';
    if (s.layout === 'two-col') {
      const [a, b] = await Promise.all([render(s.parts[0] ?? ''), render(s.parts[1] ?? '')]);
      html += `<div class="cols"><div class="col">${a}</div><div class="col">${b}</div></div>`;
    } else {
      html += await render(s.parts[0] ?? '');
    }
    out.push({ layout: s.layout, html });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- deck`
Expected: PASS (all parser + assembler tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deck.ts test/lib/deck.test.ts
git commit -m "feat(decks): deck dialect parser + slide assembler"
```

---

### Task 2: Plumbing — `content.decksSubdir` config + `parseDeckPath`

**Files:**
- Modify: `src/lib/config.ts` (content block, currently lines 11-20)
- Modify: `src/lib/paths.ts`
- Modify: `src/lib/store-singleton.ts` (both option branches)
- Test: `test/lib/config.test.ts`, `test/lib/paths.test.ts`

**Interfaces:**
- Produces: `Config.content.decksSubdir: string` (default `"decks"`); `parseDeckPath(relPath): PostPathInfo | null` with `url`/`urlPrefix` = `/decks/<slug>`; `ContentStoreOptions.decksSubdir` populated by the singleton.

- [ ] **Step 1: Write failing tests**

In `test/lib/config.test.ts`, add:

```ts
  it('defaults content.decksSubdir to "decks" and accepts an override', () => {
    const base = writeConfig(`
site:
  title: "x"
content:
  repo: "https://github.com/you/content.git"
`);
    dirs.push(join(base, '..'));
    expect(loadConfig(base).content.decksSubdir).toBe('decks');

    const custom = writeConfig(`
site:
  title: "x"
content:
  repo: "https://github.com/you/content.git"
  decksSubdir: "slides"
`);
    dirs.push(join(custom, '..'));
    expect(loadConfig(custom).content.decksSubdir).toBe('slides');
  });
```

In `test/lib/paths.test.ts`, add (match the file's existing import of `parsePostPath` and extend it):

```ts
import { parseDeckPath } from '../../src/lib/paths';

describe('parseDeckPath', () => {
  it('maps {ns}/{slug}/index.md to /decks/{slug}', () => {
    const info = parseDeckPath('justcallmegreg-blog/demo-deck/index.md');
    expect(info).toEqual({
      slug: 'demo-deck',
      url: '/decks/demo-deck',
      urlPrefix: '/decks/demo-deck',
      contentDir: 'justcallmegreg-blog/demo-deck',
    });
  });
  it('returns null for non-matching paths', () => {
    expect(parseDeckPath('demo-deck/index.md')).toBeNull();
    expect(parseDeckPath('ns/demo-deck/other.md')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- config paths`
Expected: FAIL — `decksSubdir` undefined; `parseDeckPath` not exported.

- [ ] **Step 3: Implement**

`src/lib/config.ts` — add to the `content` object, after the `timezone` line:

```ts
      // Content-repo subdirectory holding presentation decks (deck dialect).
      decksSubdir: z.string().default('decks'),
```

`src/lib/paths.ts` — add below `parsePostPath`:

```ts
/**
 * {namespace}/{slug}/index.md under the DECKS root — served at /decks/{slug}.
 * Same shape as posts so decks ride the same publish conventions.
 */
export function parseDeckPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, ns, slug] = match;
  return {
    slug,
    url: `/decks/${slug}`,
    urlPrefix: `/decks/${slug}`,
    contentDir: `${ns}/${slug}`,
  };
}
```

`src/lib/store-singleton.ts` — add `decksSubdir: cfg.content.decksSubdir,` to **both** option objects passed to `getStore(...)` (the `localDir ?` branch and the git branch), alongside the existing `timezone` line. (`ContentStoreOptions.decksSubdir` itself is added in Task 3 — add the field there first if TypeScript complains; Tasks 2 and 3 may be committed together in that case, but keep the commits separate if it compiles.)

To keep Task 2 self-contained, also add the option field now in `src/lib/content-store.ts` (`ContentStoreOptions`, after `timezone`):

```ts
  /** Content-repo subdirectory holding decks. Defaults to "decks". */
  decksSubdir?: string;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- config paths`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts src/lib/paths.ts src/lib/store-singleton.ts src/lib/content-store.ts test/lib/config.test.ts test/lib/paths.test.ts
git commit -m "feat(decks): decksSubdir config + parseDeckPath plumbing"
```

---

### Task 3: ContentStore — index, render, and gate decks

**Files:**
- Modify: `src/lib/content-store.ts`
- Test: `test/lib/content-store.test.ts`

**Interfaces:**
- Consumes: `parseDeckSource`/`renderDeckSlides` (Task 1), `parseDeckPath` (Task 2), existing `renderMarkdown`, `parsePublishAt`, `pickPublishedDate`, `firstAddedDate`.
- Produces on `ContentStore`:
  ```ts
  export interface Deck {
    url: string; urlPrefix: string; slug: string; contentDir: string;
    title: string; subtitle?: string; author?: string; date: string;
    theme: string; draft: boolean; slides: DeckSlideHtml[]; blobHash: string;
    publishAt?: string; scheduleInvalid?: boolean;
  }
  listDecks(now?: Date): Deck[]
  getDeck(url: string): Deck | undefined
  getLiveDeck(url: string, now?: Date): Deck | undefined
  resolveDeckAssetPath(slug: string, file: string, now?: Date): string | null
  ```

- [ ] **Step 1: Write failing tests**

In `test/lib/content-store.test.ts`, add a deck helper next to `commitPost`:

```ts
function commitDeck(slug: string, body: string) {
  const full = join(originDir, 'decks', NS, slug, 'index.md');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(originDir, 'add', '-A');
  execFileSync('git', ['commit', '-m', `deck ${slug}`], { cwd: originDir, stdio: 'pipe' });
}
```

Then add these tests inside `describe('ContentStore', ...)`:

```ts
  it('indexes a deck: meta, layouts, mermaid + shiki rendering', async () => {
    commitDeck('demo', `---
title: "DEMO DECK"
subtitle: "SUB"
---

# DEMO DECK

HELLO

---

## FLOW

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

---

<!-- slide: two-col -->

## SPLIT

- LEFT

<!-- col -->

\`\`\`js
const x = 1;
\`\`\`
`);
    const store = makeStore();
    await store.start();
    const deck = store.getDeck('/decks/demo');
    expect(deck?.title).toBe('DEMO DECK');
    expect(deck?.subtitle).toBe('SUB');
    expect(deck?.theme).toBe('pipboy');
    expect(deck?.slides.map((s) => s.layout)).toEqual(['title', 'default', 'two-col']);
    expect(deck?.slides[1].html).toContain('<pre class="mermaid">');
    expect(deck?.slides[2].html).toContain('class="cols"');
    expect(deck?.slides[2].html).toContain('shiki');
  });

  it('keeps posts working when decks are present (no cross-contamination)', async () => {
    commitDeck('demo', '# D\n');
    const store = makeStore();
    await store.start();
    expect(store.listPosts(new Date()).map((p) => p.slug)).toEqual(['first', 'older']);
    expect(store.getPost('/decks/demo')).toBeUndefined();
    expect(store.getDeck('/first')).toBeUndefined();
  });

  it('gates a draft deck and a future-scheduled deck', async () => {
    commitDeck('draftdeck', '---\ndraft: true\n---\n# D\n');
    commitDeck('futuredeck', '---\npublishAt: "2030-01-01T00:00:00Z"\n---\n# F\n');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLiveDeck('/decks/draftdeck', now)).toBeUndefined();
    expect(store.getLiveDeck('/decks/futuredeck', now)).toBeUndefined();
    expect(store.getLiveDeck('/decks/futuredeck', new Date('2031-01-01T00:00:00Z'))).toBeDefined();
    expect(store.getDeck('/decks/draftdeck')).toBeDefined(); // raw lookup still works
    expect(store.listDecks(now)).toEqual([]);
  });

  it('resolves deck asset paths with the traversal guard', async () => {
    commitDeck('withassets', '# A\n');
    const store = makeStore();
    await store.start();
    expect(store.resolveDeckAssetPath('withassets', 'd.png')).toBe(
      resolve(cacheDir, 'decks', NS, 'withassets/assets/d.png')
    );
    expect(store.resolveDeckAssetPath('withassets', '../../../etc/passwd')).toBeNull();
    expect(store.resolveDeckAssetPath('nope', 'd.png')).toBeNull();
  });

  it('drops a deck whose file was removed', async () => {
    commitDeck('gone', '# G\n');
    const store = makeStore();
    await store.start();
    expect(store.getDeck('/decks/gone')).toBeDefined();
    git(originDir, 'rm', `decks/${NS}/gone/index.md`);
    git(originDir, 'commit', '-m', 'remove deck');
    await store.sync();
    expect(store.getDeck('/decks/gone')).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- content-store`
Expected: FAIL — `getDeck` is not a function.

- [ ] **Step 3: Implement in `src/lib/content-store.ts`**

Imports — add:

```ts
import { parsePostPath, parseDeckPath } from './paths';
import { parseDeckSource, renderDeckSlides, type DeckSlideHtml } from './deck';
```

(`parsePostPath` is already imported; extend that import statement.)

Add the `Deck` interface after `Post`:

```ts
export interface Deck {
  url: string;
  urlPrefix: string;
  slug: string;
  contentDir: string;
  title: string;
  subtitle?: string;
  author?: string;
  date: string;
  theme: string;
  draft: boolean;
  slides: DeckSlideHtml[];
  blobHash: string;
  publishAt?: string;
  scheduleInvalid?: boolean;
}
```

Class fields — add next to `index`:

```ts
  private decksIndex = new Map<string, Deck>();
```

Helpers — add next to `contentRoot()`/`toContentRel()`:

```ts
  private decksRoot(): string {
    return join(this.opts.cacheDir, this.opts.decksSubdir ?? 'decks');
  }

  /** Repo-relative path -> decks-root-relative path, or null if outside decksSubdir. */
  private toDeckRel(repoRel: string): string | null {
    const prefix = `${(this.opts.decksSubdir ?? 'decks').replace(/\/$/, '')}/`;
    return repoRel.startsWith(prefix) ? repoRel.slice(prefix.length) : null;
  }
```

Generalize `isLive` — change its parameter type so both `Post` and `Deck` fit (body unchanged):

```ts
  private isLive(
    entry: { draft: boolean; scheduleInvalid?: boolean; publishAt?: string },
    now: Date
  ): boolean {
```

`reindex()` — two changes. First, add a deck-seen set next to `seenUrls`:

```ts
    const seenDeckUrls = new Set<string>();
```

Second, at the TOP of the `for (const [repoRel, hash] of blobs)` loop body — before the existing `const contentRel = this.toContentRel(repoRel);` line — insert the deck branch, so `decks/` paths are claimed first and post logic below stays untouched:

```ts
      const deckRel = this.toDeckRel(repoRel);
      if (deckRel !== null) {
        await this.indexDeck(repoRel, deckRel, hash, seenDeckUrls, changed);
        continue;
      }
```

At the bottom of `reindex()`, next to the existing post-prune loop, add the deck prune:

```ts
    for (const url of [...this.decksIndex.keys()]) {
      if (!seenDeckUrls.has(url)) this.decksIndex.delete(url);
    }
```

Add the private deck indexer (below `reindex`):

```ts
  private async indexDeck(
    repoRel: string,
    deckRel: string,
    hash: string,
    seenUrls: Set<string>,
    changed: string[]
  ): Promise<void> {
    const info = parseDeckPath(deckRel);
    if (!info) return;
    seenUrls.add(info.url);
    const existing = this.decksIndex.get(info.url);
    if (existing && existing.blobHash === hash) return;

    const raw = readFileSync(join(this.decksRoot(), deckRel), 'utf8');
    try {
      const parsed = parseDeckSource(raw);
      const slides = await renderDeckSlides(parsed, (md) =>
        renderMarkdown(md, info.urlPrefix)
      );
      const sched = parsePublishAt(parsed.meta.publishAt, this.tz());
      if (sched.kind === 'invalid') {
        console.warn(
          `[content] ${repoRel}: invalid publishAt ${JSON.stringify(parsed.meta.publishAt)} — keeping the deck hidden`
        );
      }
      const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;
      const gitDate = this.opts.local
        ? null
        : await firstAddedDate(this.opts.cacheDir, repoRel);
      this.decksIndex.set(info.url, {
        url: info.url,
        urlPrefix: info.urlPrefix,
        slug: info.slug,
        contentDir: info.contentDir,
        title: parsed.meta.title ?? info.slug,
        subtitle: parsed.meta.subtitle,
        author: parsed.meta.author,
        date: pickPublishedDate(parsed.meta.date, publishAtDay ?? gitDate),
        theme: parsed.meta.theme,
        draft: parsed.meta.draft,
        slides,
        blobHash: hash,
        publishAt: sched.kind === 'scheduled' ? sched.instant : undefined,
        scheduleInvalid: sched.kind === 'invalid' ? true : undefined,
      });
      changed.push(repoRel);
    } catch (err) {
      console.warn(`Skipping ${repoRel}: ${(err as Error).message}`);
    }
  }
```

Public accessors — add next to `getLivePost`:

```ts
  listDecks(now: Date = new Date()): Deck[] {
    return [...this.decksIndex.values()]
      .filter((d) => this.isLive(d, now))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getDeck(url: string): Deck | undefined {
    return this.decksIndex.get(url);
  }

  /** Like getDeck, but undefined unless the deck is live at `now`. */
  getLiveDeck(url: string, now: Date = new Date()): Deck | undefined {
    const deck = this.decksIndex.get(url);
    return deck && this.isLive(deck, now) ? deck : undefined;
  }

  resolveDeckAssetPath(slug: string, file: string, now: Date = new Date()): string | null {
    const deck = this.decksIndex.get(`/decks/${slug}`);
    if (!deck || !this.isLive(deck, now)) return null;
    const baseDir = resolve(this.decksRoot(), deck.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
```

Finally, extend the `start()` summary log to include decks — change the `indexed N post(s)` line to:

```ts
    console.log(
      `[content] indexed ${this.index.size} post(s), ${this.decksIndex.size} deck(s) — scanned ${scanned} tracked file(s), ` +
        `${underSubdir} under subdir '${this.opts.subdir}' (content root ${this.contentRoot()})`
    );
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — new deck tests green AND every pre-existing post test untouched (the deck branch only claims `decks/`-prefixed paths).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-store.ts test/lib/content-store.test.ts
git commit -m "feat(decks): index, render, and gate decks in the content store"
```

---

### Task 4: Presenter template + routes

**Files:**
- Create: `src/layouts/Presenter.astro` (ported from `mockups/pipboy-presenter.html`)
- Create: `src/pages/decks/[slug].astro`
- Create: `src/pages/decks/[slug]/assets/[...file].ts`
- Reference (read, do not modify): `mockups/pipboy-presenter.html`, `src/pages/[slug]/assets/[...file].ts`, `src/components/MermaidRuntime.astro`

**Interfaces:**
- Consumes: `getLiveDeck(url, now)`, `resolveDeckAssetPath(slug, file, now)`, `Deck` (Task 3), `MermaidRuntime` component.

- [ ] **Step 1: Create the deck page route**

`src/pages/decks/[slug].astro`:

```astro
---
import Presenter from '../../layouts/Presenter.astro';
import { ensureStarted } from '../../lib/store-singleton';

const { slug } = Astro.params;
const store = await ensureStarted();
const deck = store.getLiveDeck(`/decks/${slug}`, new Date());

if (!deck) {
  return new Response('Not found', { status: 404 });
}
---
<Presenter deck={deck} />
```

- [ ] **Step 2: Create the deck assets route**

`src/pages/decks/[slug]/assets/[...file].ts` — same shape as the post assets endpoint (`src/pages/[slug]/assets/[...file].ts`), with the deck resolver:

```ts
import type { APIRoute } from 'astro';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { ensureStarted } from '../../../../lib/store-singleton';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export const GET: APIRoute = async ({ params }) => {
  const { slug, file } = params;
  if (!slug || !file) return new Response('Not found', { status: 404 });

  const store = await ensureStarted();
  const path = store.resolveDeckAssetPath(slug, file, new Date());
  if (!path) return new Response('Not found', { status: 404 });

  try {
    await stat(path);
    const data = await readFile(path);
    return new Response(data, {
      headers: {
        'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
```

- [ ] **Step 3: Create `src/layouts/Presenter.astro` — frame + slide injection**

Port from `mockups/pipboy-presenter.html`. The mockup has four parts: chassis CSS, an embedded deck + client renderer, the device HTML, and the controller JS. The layout keeps the chassis CSS, device HTML, and controller — the deck/client-renderer parts are replaced by server-rendered slides. Skeleton:

```astro
---
import '../styles/theme.css';
import MermaidRuntime from '../components/MermaidRuntime.astro';
import type { Deck } from '../lib/content-store';

interface Props {
  deck: Deck;
}
const { deck } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{deck.title} — Presenter</title>
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" href="/favicon-180.png" />
  </head>
  <body class="pb-body">
    <!-- device HTML copied from the mockup body (see Step 4), with ONE change:
         inside <main class="viewport"> replace the mockup's comment placeholder
         with the server-rendered slides loop, keeping nav-hint + wipe after it: -->
    <!--
      {deck.slides.map((s) => (
        <section class={`slide slide--${s.layout}`} set:html={s.html} />
      ))}
    -->
    <MermaidRuntime />
  </body>
</html>
```

Concretely: copy everything from `<div class="stage">` through its closing `</div>` out of the mockup into the body, then inside `<main class="viewport" id="viewport" aria-live="polite">` insert the slides loop shown above (uncommented) before the `nav-hint` div. Also change the plate line to show the deck title:

```astro
<div class="plate">ROBCO IND.™ · PIP-BOY 4000 · {deck.title}</div>
```

Delete from the copy: the `<script type="text/plain" id="deck">…</script>` block entirely.

- [ ] **Step 4: Port the CSS as a global, `.pb-body`-scoped style block**

Append to `Presenter.astro`, before `</body>`: a `<style is:global>` block containing the mockup's entire `<style>` content. Astro only ships this stylesheet on pages using this layout, so the mockup's `:root`/`body` selectors can stay **verbatim** — they override theme.css's values on presenter pages only (later stylesheet wins), which is exactly what we want (the presenter greens then also feed the imported Mermaid/zoom-pane styles via `--fg`/`--fg-dim`). Exactly two adaptations:

1. **Slide visibility (the Mermaid gotcha):** replace the mockup's

   ```css
   .slide { position: absolute; inset: 0; display: none; padding: …; flex-direction: column; … }
   .slide.on { display: flex; animation: settle 0.24s ease-out; }
   ```

   with

   ```css
   .slide {
     position: absolute; inset: 0;
     display: flex;
     visibility: hidden;
     pointer-events: none;
     padding: 3% 6%;
     flex-direction: column;
     justify-content: center;
     gap: 1.6vmin;
     text-align: left;
   }
   .slide.on {
     visibility: visible;
     pointer-events: auto;
     animation: settle 0.24s ease-out;
   }
   ```

   (Mermaid measures elements at load; `display:none` slides would produce zero-width SVGs.)
2. **Additions** — append these presenter-only rules at the end of the style block (the `body` keeps its `pb-body` class from the skeleton, so these selectors match):

   ```css
   /* content blocks inside slides */
   .pb-body .slide pre { margin: 0; max-height: 100%; overflow: auto; }
   .pb-body .slide pre.shiki { font-size: clamp(11px, 2vmin, 24px); }
   .pb-body .slide pre.mermaid { border: none; background: none; }
   .pb-body .slide pre.mermaid svg { max-height: 48vh; }
   .pb-body .slide img { max-width: 100%; max-height: 55vh; }
   ```

Drop from the ported CSS: the mockup's `.slide pre.code` / `.slide p code, .slide li code` rules may be kept verbatim (harmless; server output uses `pre.shiki` and `:not(pre) > code` from theme.css instead) — keeping them is fine, deleting them is fine too; prefer keeping the port literal.

- [ ] **Step 5: Port the controller JS**

Append after the style block, still before `</body>`: a `<script>` tag with the mockup's script **from the `TEMPLATE` section comment onward only** (everything from `const viewport = document.getElementById('viewport');`), minus the renderer (delete `renderDeck`, `renderSlide`, `renderMd`, `renderMermaid`, `esc`, `inline`, `LAYOUTS`, and the `const deck = renderDeck(...)` + slide-insertion loop — the server already rendered slides into the DOM). Keep verbatim: the element lookups, click-sound synth, `render()`, `go()`, all event listeners, and the initial `render()` call. Two mockup lines reference removed code — the slide-building loop between `const deck = …` and `const slides = …`; ensure the script starts with the element lookups and `const slides = [...viewport.querySelectorAll('.slide')];` works against the server-rendered sections.

Wrap the whole thing in the same IIFE form the mockup uses, or rely on Astro's module scoping (Astro bundles `<script>` as a module — the IIFE wrapper may be kept or dropped; keep it for a literal port).

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: `[build] Complete!`, no type errors (the routes type-check against Task 3's store methods).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (no lib changes in this task; guards against accidental regressions).

- [ ] **Step 8: Commit**

```bash
git add src/layouts/Presenter.astro "src/pages/decks/[slug].astro" "src/pages/decks/[slug]/assets/[...file].ts"
git commit -m "feat(decks): Pip-Boy Presenter layout + /decks/<slug> route + deck assets"
```

---

### Task 5: Docs + end-to-end verification

**Files:**
- Modify: `config.example.yaml`
- Modify: `docs/blogpost-publishing.md`
- No source changes.

- [ ] **Step 1: Document `decksSubdir` in the example config**

In `config.example.yaml`, under the `content:` block (next to `timezone`):

```yaml
  decksSubdir: "decks"           # content-repo subdir holding presentation decks (default: decks)
```

- [ ] **Step 2: Document decks in the publishing guide**

Append to `docs/blogpost-publishing.md`:

```markdown
## Presentation decks

The engine also serves presentation decks (Fallout Pip-Boy presenter) from the
content repo. A deck is one Markdown file in the deck dialect — frontmatter +
slides separated by `---`, five layouts via `<!-- slide: … -->` directives; see
`docs/superpowers/specs/2026-07-09-deck-dialect-and-presenter-design.md`.

- Location in `blog-content`: `decks/{owner}-{repo}/{slug}/index.md`
  (assets in `assets/` next to it) — served at `/decks/{slug}`.
- Publishing: open a PR against `blog-content` placing the file there. (The
  `publish-blogpost` workflow can be copied with `SOURCE_DIR`/`DEST_SUBDIR`
  set to `decks` — remember to also change the `on.push.paths` glob — but a
  manual PR works fine until deck volume justifies automation.)
- `draft: true` and `publishAt` behave exactly as for posts: hidden from the
  route (404) until live.
```

- [ ] **Step 3: End-to-end check against a local content dir**

```bash
SP=$(mktemp -d)
mkdir -p "$SP/blogs" "$SP/decks/justcallmegreg-blog/demo-deck"
cat > "$SP/decks/justcallmegreg-blog/demo-deck/index.md" <<'MD'
---
title: "DEMO DECK"
subtitle: "E2E CHECK"
---

# DEMO DECK

HELLO WASTELAND

---

## FLOW

```mermaid
graph LR
  R[REACTOR] -->|H2O| P[PURIFIER]
```

---

<!-- slide: stat -->

# 42%

LABEL
MD
CONTENT_LOCAL_DIR="$SP" npm run dev &
sleep 6
curl -s -o /dev/null -w "deck=%{http_code}\n"  http://localhost:4321/decks/demo-deck
curl -s -o /dev/null -w "miss=%{http_code}\n"  http://localhost:4321/decks/no-such-deck
curl -s http://localhost:4321/decks/demo-deck | grep -c 'class="slide slide--'
curl -s http://localhost:4321/decks/demo-deck | grep -c 'pre class="mermaid"'
```

Expected: `deck=200`, `miss=404`, slide count `3`, mermaid count `1`. Then stop the dev server (`pkill -f "astro dev"`).

If a browser is available, additionally load `http://localhost:4321/decks/demo-deck`, click through the three slides, and confirm: the Mermaid SVG renders (not raw source), the knob rotates, the counter reads `03 / 03` at the end, and the click sound plays. If no browser is available, state that in the report and rely on the curl checks.

- [ ] **Step 4: Full suite + build one last time**

Run: `npm test && npm run build`
Expected: all tests pass; build completes.

- [ ] **Step 5: Commit**

```bash
git add config.example.yaml docs/blogpost-publishing.md
git commit -m "docs(decks): document decksSubdir config + deck publishing"
```

---

## Self-Review

**Spec coverage (phase 2 section of the spec):**
- Server renders slides with existing remark/rehype/Shiki + Mermaid runtime → Task 3 (renderMarkdown per part) + Task 4 (MermaidRuntime). ✓
- Pip-Boy shell as an Astro layout → Task 4. ✓
- Decks in content repo `decks/<ns>/<slug>/index.md` riding existing flow → Tasks 2/3 (paths + store) + Task 5 (docs). ✓
- `publishAt`/draft for free → Task 3 (parsePublishAt + generalized isLive) with tests. ✓
- Dialect rules (directives, 5 layouts, slide-1 title, unknown→default+warn, title-from-H1, two-col split, fence-safe splitting) → Task 1 with tests. ✓
- Template contract (renderer knows nothing of the device; template provides chrome, layout CSS, nav, progress, hooks) → Task 1 (`renderDeckSlides(deck, render)`) + Task 4 (shell). ✓
- Error handling: never hard-fail a deck (indexDeck try/catch skips + warns; unknown layout degrades). ✓

**Placeholder scan:** one intentional non-placeholder note in Task 1 Step 1 clarifying the unknown-layout expectation (with the corrected line given); Task 4 references the committed mockup file for verbatim-ported chunks with every changed/new block spelled out in full — a file handoff, not a placeholder. No TBDs.

**Type consistency:** `DeckSlideHtml`/`ParsedDeck`/`parseDeckSource`/`renderDeckSlides` (Task 1) consumed with identical signatures in Task 3; `Deck`, `getLiveDeck(url, now?)`, `resolveDeckAssetPath(slug, file, now?)` (Task 3) consumed in Task 4's routes; `decksSubdir` name identical across config schema, `ContentStoreOptions`, and singleton (Task 2/3); layout class prefix `slide--` identical in Task 3 tests, Task 4 loop, and mockup CSS.
