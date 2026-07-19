# Transmissions Vlog — Plane A (Engine Rendering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Transmissions vlog in the stateless blog engine — index a new `transmissions` content type from the git content repo, serve a newest-first list, a per-entry HLS player page, and the in-git poster, and activate the Transmissions tab.

**Architecture:** A transmission is a git entry that mirrors posts/decks (`transmissions/{owner}-{repo}/{slug}/index.md` + `assets/poster.jpg`), whose `video` frontmatter is a path relative to a configured R2 media base URL. `ContentStore` indexes it exactly like a deck (reusing `blobHash` change-detection, `draft`/`publishAt` gating, and the PR-merge-date logic). Three server-rendered routes expose it; `hls.js` plays the HLS on the player page, degrading to poster + direct link with JS off. The engine never holds video bytes or R2 credentials.

**Tech Stack:** Astro SSR (Node standalone), TypeScript, zod, `gray-matter`, `hls.js` (new dep), vitest.

## Global Constraints

- Content type mirrors posts/decks: `transmissions/{namespace}/{slug}/index.md` + `assets/`, served at `/transmissions/{slug}`.
- Frontmatter `video` is a path **relative** to the R2 media base; playback URL = `mediaBaseUrl + "/transmissions/" + video`.
- Engine stays stateless: no video bytes, no R2 credentials, no transcoding in-engine.
- `draft: true` hides an entry from the list and 404s its route (existing gating); future `publishAt` also hides it (existing gating).
- Poster is a small in-git image served by an engine route with the same slug-scoped traversal guard as post assets.
- Dates are `YYYY-MM-DD`; published date uses `pickPublishedDate(frontmatterDate, gitDate)` (git merge date wins), same as posts/decks.
- JS-disabled must never yield a blank player: show poster + "playback needs JavaScript" + a direct `.m3u8` link.

---

### Task 1: Transmission primitives (path, frontmatter, media URL) + config

**Files:**
- Modify: `src/lib/paths.ts`
- Create: `src/lib/transmission.ts`
- Modify: `src/lib/config.ts` (add `transmissions` block + `content.transmissionsSubdir`)
- Test: `test/lib/paths.test.ts` (add cases), `test/lib/transmission.test.ts` (new)

**Interfaces:**
- Produces:
  - `parseTransmissionPath(relPath: string): PostPathInfo | null` — `{namespace}/{slug}/index.md` → `{ slug, url: "/transmissions/{slug}", urlPrefix: "/transmissions/{slug}", contentDir: "{namespace}/{slug}" }`.
  - `TransmissionFrontmatter` = `{ title?: string; description?: string; draft: boolean; date?: string; publishAt?: string; video: string; duration?: string; poster: string }`.
  - `parseTransmissionFrontmatter(raw: string): { data: TransmissionFrontmatter }` — throws `Error("Invalid transmission frontmatter: …")` on schema failure (notably a missing `video`).
  - `transmissionMediaUrl(base: string, video: string): string` — joins `base` + `/transmissions/` + `video`, tolerating a trailing slash on `base` and a leading slash on `video`.
  - Config: `cfg.transmissions.{enabled: boolean, mediaBaseUrl: string}` and `cfg.content.transmissionsSubdir: string` (default `'transmissions'`).

- [ ] **Step 1: Write failing tests for `parseTransmissionPath`**

Append to `test/lib/paths.test.ts` (import already covers `./paths`; add `parseTransmissionPath` to the import):

```ts
import { parsePostPath, parseDeckPath, parseTransmissionPath } from '../../src/lib/paths';

describe('parseTransmissionPath', () => {
  it('maps {ns}/{slug}/index.md to the /transmissions/{slug} url', () => {
    expect(parseTransmissionPath('justcallmegreg-blog/first-tx/index.md')).toEqual({
      slug: 'first-tx',
      url: '/transmissions/first-tx',
      urlPrefix: '/transmissions/first-tx',
      contentDir: 'justcallmegreg-blog/first-tx',
    });
  });
  it('returns null for a non-matching path', () => {
    expect(parseTransmissionPath('justcallmegreg-blog/first-tx/assets/poster.jpg')).toBeNull();
  });
});
```

(If `test/lib/paths.test.ts` does not exist, create it with:
```ts
import { describe, it, expect } from 'vitest';
import { parsePostPath, parseDeckPath, parseTransmissionPath } from '../../src/lib/paths';
```
plus the `describe` block above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/paths.test.ts -t parseTransmissionPath`
Expected: FAIL — `parseTransmissionPath is not a function` / not exported.

- [ ] **Step 3: Implement `parseTransmissionPath`**

In `src/lib/paths.ts`, append (reuse the existing `POST_PATH` regex):

```ts
/**
 * {namespace}/{slug}/index.md under the TRANSMISSIONS root — served at
 * /transmissions/{slug}. Same shape as posts/decks so it rides the same
 * publish conventions.
 */
export function parseTransmissionPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, ns, slug] = match;
  return {
    slug,
    url: `/transmissions/${slug}`,
    urlPrefix: `/transmissions/${slug}`,
    contentDir: `${ns}/${slug}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/paths.test.ts -t parseTransmissionPath`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `transmission.ts`**

Create `test/lib/transmission.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTransmissionFrontmatter, transmissionMediaUrl } from '../../src/lib/transmission';

describe('parseTransmissionFrontmatter', () => {
  it('parses fields and defaults poster + draft', () => {
    const raw = [
      '---',
      'title: "First TX"',
      'date: "2026-06-02"',
      'description: "Channel zero."',
      'video: "first-tx/master.m3u8"',
      'duration: "05:52"',
      '---',
      'body ignored',
    ].join('\n');
    const { data } = parseTransmissionFrontmatter(raw);
    expect(data.title).toBe('First TX');
    expect(data.video).toBe('first-tx/master.m3u8');
    expect(data.duration).toBe('05:52');
    expect(data.poster).toBe('poster.jpg'); // default
    expect(data.draft).toBe(false);         // default
  });
  it('honors an explicit poster and draft', () => {
    const raw = '---\nvideo: "a/master.m3u8"\nposter: "cover.jpg"\ndraft: true\n---\n';
    const { data } = parseTransmissionFrontmatter(raw);
    expect(data.poster).toBe('cover.jpg');
    expect(data.draft).toBe(true);
  });
  it('throws when video is missing', () => {
    expect(() => parseTransmissionFrontmatter('---\ntitle: "No video"\n---\n')).toThrow(
      /Invalid transmission frontmatter/
    );
  });
});

describe('transmissionMediaUrl', () => {
  it('joins base + /transmissions/ + video', () => {
    expect(transmissionMediaUrl('https://media.example.com', 'a/master.m3u8')).toBe(
      'https://media.example.com/transmissions/a/master.m3u8'
    );
  });
  it('tolerates a trailing slash on base and a leading slash on video', () => {
    expect(transmissionMediaUrl('https://media.example.com/', '/a/master.m3u8')).toBe(
      'https://media.example.com/transmissions/a/master.m3u8'
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/lib/transmission.test.ts`
Expected: FAIL — module `../../src/lib/transmission` not found.

- [ ] **Step 7: Implement `src/lib/transmission.ts`**

```ts
import matter from 'gray-matter';
import { z } from 'zod';

// Transmissions need their own frontmatter schema because the post schema
// (src/lib/frontmatter.ts) strips unknown keys — it would drop `video`,
// `duration`, and `poster`.
const TransmissionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  date: z.string().optional(),
  publishAt: z.string().optional(),
  video: z.string(), // required: path to the master playlist, relative to the media base
  duration: z.string().optional(),
  poster: z.string().default('poster.jpg'),
});

export type TransmissionFrontmatter = z.infer<typeof TransmissionSchema>;

export function parseTransmissionFrontmatter(raw: string): { data: TransmissionFrontmatter } {
  const parsed = matter(raw);
  const result = TransmissionSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid transmission frontmatter: ${issues}`);
  }
  return { data: result.data };
}

/** Absolute playback URL for a transmission's master playlist. */
export function transmissionMediaUrl(base: string, video: string): string {
  return `${base.replace(/\/$/, '')}/transmissions/${video.replace(/^\//, '')}`;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/lib/transmission.test.ts test/lib/paths.test.ts`
Expected: PASS (all).

- [ ] **Step 9: Add the config schema**

In `src/lib/config.ts`, inside `content: z.object({ … })` add next to `decksSubdir`:

```ts
      // Content-repo subdirectory holding transmissions (vlog entries).
      transmissionsSubdir: z.string().default('transmissions'),
```

And add a top-level block next to `newsletter`:

```ts
  transmissions: z
    .object({
      enabled: z.boolean().default(true),
      // Public base URL of the R2 media bucket (custom domain). Playback URL is
      // `${mediaBaseUrl}/transmissions/${video}`. Must be set for playback.
      mediaBaseUrl: z.string().default(''),
    })
    .default({}),
```

- [ ] **Step 10: Verify config compiles**

Run: `npx tsc --noEmit`
Expected: no errors (the new `transmissions` block and `content.transmissionsSubdir` typecheck; `z.infer<typeof ConfigSchema>` picks them up automatically).

- [ ] **Step 11: Commit**

```bash
git add src/lib/paths.ts src/lib/transmission.ts src/lib/config.ts test/lib/paths.test.ts test/lib/transmission.test.ts
git commit -m "feat(transmissions): path, frontmatter, media-url primitives + config"
```

---

### Task 2: ContentStore indexes the transmissions content type

**Files:**
- Modify: `src/lib/content-store.ts`
- Modify: `src/lib/store-singleton.ts`
- Test: `test/lib/content-store.test.ts` (add a `commitTransmission` helper + a `describe` block)

**Interfaces:**
- Consumes: `parseTransmissionPath`, `parseTransmissionFrontmatter` (Task 1); existing `firstAddedDate`, `parsePublishAt`, `pickPublishedDate`, `resolve`, `sep`, `join`, `readFileSync`.
- Produces on `ContentStore`:
  - `Transmission` interface: `{ url, urlPrefix, slug, contentDir, title, date, description?, video, duration?, poster, draft, blobHash, publishAt?, scheduleInvalid? }`.
  - `listTransmissions(now?: Date): Transmission[]` (live only, newest-first).
  - `getTransmission(url: string): Transmission | undefined`.
  - `getLiveTransmission(url: string, now?: Date): Transmission | undefined`.
  - `resolveTransmissionAssetPath(slug: string, file: string, now?: Date): string | null`.
  - `ContentStoreOptions.transmissionsSubdir?: string` (default `'transmissions'`).

- [ ] **Step 1: Write the failing test**

In `test/lib/content-store.test.ts`, add a `commitTransmission` helper next to `commitDeck` (top of file, after `commitDeck`):

```ts
function commitTransmission(slug: string, body: string, dateISO?: string) {
  const full = join(originDir, 'transmissions', NS, slug, 'index.md');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(originDir, 'add', '-A');
  const env = dateISO
    ? { ...process.env, GIT_AUTHOR_DATE: dateISO, GIT_COMMITTER_DATE: dateISO }
    : process.env;
  execFileSync('git', ['commit', '-m', `tx ${slug}`], { cwd: originDir, stdio: 'pipe', env });
}
```

Then add this `describe` block inside the top-level `describe('ContentStore', …)`:

```ts
describe('transmissions', () => {
  it('indexes a transmission with its video/duration/poster and dates it by git', async () => {
    commitTransmission(
      'first-tx',
      '---\ntitle: First TX\ndescription: "Channel zero."\nvideo: "first-tx/master.m3u8"\nduration: "05:52"\n---\n',
      '2026-06-02T10:00:00Z'
    );
    const store = makeStore();
    await store.start();
    const tx = store.getTransmission('/transmissions/first-tx');
    expect(tx?.title).toBe('First TX');
    expect(tx?.video).toBe('first-tx/master.m3u8');
    expect(tx?.duration).toBe('05:52');
    expect(tx?.poster).toBe('poster.jpg');
    expect(tx?.date).toBe('2026-06-02');
    expect(store.listTransmissions().map((t) => t.slug)).toContain('first-tx');
  });

  it('hides a draft transmission from the list and its live lookup', async () => {
    commitTransmission('hidden-tx', '---\ntitle: Hidden\nvideo: "hidden-tx/master.m3u8"\ndraft: true\n---\n');
    const store = makeStore();
    await store.start();
    expect(store.listTransmissions().map((t) => t.slug)).not.toContain('hidden-tx');
    expect(store.getLiveTransmission('/transmissions/hidden-tx')).toBeUndefined();
    expect(store.getTransmission('/transmissions/hidden-tx')).toBeDefined(); // raw still there
  });

  it('hides a future-scheduled transmission until its publishAt', async () => {
    commitTransmission('future-tx', '---\ntitle: Later\nvideo: "future-tx/master.m3u8"\npublishAt: "2030-01-01T00:00:00Z"\n---\n');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.listTransmissions(now).map((t) => t.slug)).not.toContain('future-tx');
    expect(store.getLiveTransmission('/transmissions/future-tx', now)).toBeUndefined();
  });

  it('resolves a transmission poster asset path with the traversal guard', async () => {
    commitTransmission('asset-tx', '---\ntitle: A\nvideo: "asset-tx/master.m3u8"\n---\n');
    const store = makeStore();
    await store.start();
    expect(store.resolveTransmissionAssetPath('asset-tx', 'poster.jpg')).toBe(
      resolve(cacheDir, 'transmissions', NS, 'asset-tx/assets/poster.jpg')
    );
    expect(store.resolveTransmissionAssetPath('asset-tx', '../../../etc/passwd')).toBeNull();
    expect(store.resolveTransmissionAssetPath('nope', 'poster.jpg')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/content-store.test.ts -t transmissions`
Expected: FAIL — `store.getTransmission is not a function`.

- [ ] **Step 3: Add the `Transmission` type and imports**

In `src/lib/content-store.ts`, add to the `./paths` import: `parseTransmissionPath`. Add a new import near the `./deck` import:

```ts
import { parseTransmissionFrontmatter } from './transmission';
```

Add the interface after the `Deck` interface:

```ts
export interface Transmission {
  url: string;
  urlPrefix: string;
  slug: string;
  contentDir: string;
  title: string;
  date: string;
  description?: string;
  video: string;
  duration?: string;
  poster: string;
  draft: boolean;
  blobHash: string;
  publishAt?: string;
  scheduleInvalid?: boolean;
}
```

Add the option to `ContentStoreOptions` (next to `decksSubdir`):

```ts
  /** Content-repo subdirectory holding transmissions. Defaults to 'transmissions'. */
  transmissionsSubdir?: string;
```

- [ ] **Step 4: Add the index map, root, and rel helpers**

In the `ContentStore` class, next to `decksIndex`:

```ts
  private transmissionsIndex = new Map<string, Transmission>();
```

Next to `decksRoot()` / `toDeckRel()`:

```ts
  private transmissionsRoot(): string {
    return join(this.opts.cacheDir, this.opts.transmissionsSubdir ?? 'transmissions');
  }

  /** Repo-relative path -> transmissions-root-relative path, or null if outside. */
  private toTransmissionRel(repoRel: string): string | null {
    const prefix = `${(this.opts.transmissionsSubdir ?? 'transmissions').replace(/\/$/, '')}/`;
    return repoRel.startsWith(prefix) ? repoRel.slice(prefix.length) : null;
  }
```

- [ ] **Step 5: Wire the reindex loop, prune, and log**

In `reindex()`, add the transmission branch at the top of the `for` loop, right after the `deckRel` branch (before `toContentRel`):

```ts
      const transRel = this.toTransmissionRel(repoRel);
      if (transRel !== null) {
        await this.indexTransmission(repoRel, transRel, hash, seenTransmissionUrls, changed);
        continue;
      }
```

Declare the seen-set next to `seenDeckUrls` (near the top of `reindex()`):

```ts
    const seenTransmissionUrls = new Set<string>();
```

Add a prune loop next to the decks prune:

```ts
    for (const url of [...this.transmissionsIndex.keys()]) {
      if (!seenTransmissionUrls.has(url)) this.transmissionsIndex.delete(url);
    }
```

Update the `start()` log line to include transmissions count — change:
`\`[content] indexed ${this.index.size} post(s), ${this.decksIndex.size} deck(s) — …\``
to:
`\`[content] indexed ${this.index.size} post(s), ${this.decksIndex.size} deck(s), ${this.transmissionsIndex.size} transmission(s) — …\``

- [ ] **Step 6: Add `indexTransmission` (mirrors `indexDeck`)**

After the `indexDeck` method:

```ts
  private async indexTransmission(
    repoRel: string,
    transRel: string,
    hash: string,
    seenUrls: Set<string>,
    changed: string[]
  ): Promise<void> {
    const info = parseTransmissionPath(transRel);
    if (!info) return;
    seenUrls.add(info.url);
    const existing = this.transmissionsIndex.get(info.url);
    if (existing && existing.blobHash === hash) return;

    const raw = readFileSync(join(this.transmissionsRoot(), transRel), 'utf8');
    // Parse failure keeps the last-good entry serving (indexed & un-pruned) —
    // a typo'd edit degrades to stale, never to a 500.
    try {
      const { data } = parseTransmissionFrontmatter(raw);
      const sched = parsePublishAt(data.publishAt, this.tz());
      if (sched.kind === 'invalid') {
        console.warn(
          `[content] ${repoRel}: invalid publishAt ${JSON.stringify(data.publishAt)} — keeping the transmission hidden`
        );
      }
      const gitDate = this.opts.local ? null : await firstAddedDate(this.opts.cacheDir, repoRel);
      this.transmissionsIndex.set(info.url, {
        url: info.url,
        urlPrefix: info.urlPrefix,
        slug: info.slug,
        contentDir: info.contentDir,
        title: data.title ?? info.slug,
        date: pickPublishedDate(data.date, gitDate),
        description: data.description,
        video: data.video,
        duration: data.duration,
        poster: data.poster,
        draft: data.draft,
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

- [ ] **Step 7: Add the public accessors (mirror decks)**

After `resolveDeckAssetPath`:

```ts
  listTransmissions(now: Date = new Date()): Transmission[] {
    return [...this.transmissionsIndex.values()]
      .filter((t) => this.isLive(t, now))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getTransmission(url: string): Transmission | undefined {
    return this.transmissionsIndex.get(url);
  }

  /** Like getTransmission, but undefined unless live at `now`. */
  getLiveTransmission(url: string, now: Date = new Date()): Transmission | undefined {
    const tx = this.transmissionsIndex.get(url);
    return tx && this.isLive(tx, now) ? tx : undefined;
  }

  resolveTransmissionAssetPath(slug: string, file: string, now: Date = new Date()): string | null {
    const tx = this.transmissionsIndex.get(`/transmissions/${slug}`);
    if (!tx || !this.isLive(tx, now)) return null;
    const baseDir = resolve(this.transmissionsRoot(), tx.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
```

- [ ] **Step 8: Thread `transmissionsSubdir` through the singleton**

In `src/lib/store-singleton.ts`, add `transmissionsSubdir: cfg.content.transmissionsSubdir,` alongside the existing `decksSubdir: cfg.content.decksSubdir,` line in **both** the local-mode and git-mode option objects (`cfg.content.transmissionsSubdir` was added in Task 1, Step 9).

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: PASS (all, including the new `transmissions` block).

- [ ] **Step 10: Commit**

```bash
git add src/lib/content-store.ts src/lib/store-singleton.ts test/lib/content-store.test.ts
git commit -m "feat(transmissions): index the transmissions content type in ContentStore"
```

---

### Task 3: Routes, hls.js player, and tab activation

**Files:**
- Modify: `package.json` (add `hls.js`)
- Create: `src/pages/transmissions/index.astro` (list)
- Create: `src/pages/transmissions/[slug].astro` (player)
- Create: `src/pages/transmissions/[slug]/assets/[...file].ts` (poster)
- Modify: `src/layouts/Terminal.astro` (activate the tab)

**Interfaces:**
- Consumes: `store.listTransmissions()`, `store.getLiveTransmission()`, `store.resolveTransmissionAssetPath()` (Task 2); `transmissionMediaUrl()` + `cfg.transmissions.*` (Task 1); `getConfig()`; `ensureStarted()`.

- [ ] **Step 1: Add the `hls.js` dependency**

Run: `npm install hls.js@^1.5.0`
Expected: `package.json` gains `"hls.js": "^1.5.x"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Create the poster asset route**

Create `src/pages/transmissions/[slug]/assets/[...file].ts` (mirrors the deck asset route):

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
};

export const GET: APIRoute = async ({ params }) => {
  const { slug, file } = params;
  if (!slug || !file) return new Response('Not found', { status: 404 });

  const store = await ensureStarted();
  const path = store.resolveTransmissionAssetPath(slug, file, new Date());
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

- [ ] **Step 3: Create the list route**

Create `src/pages/transmissions/index.astro`:

```astro
---
import Terminal from '../../layouts/Terminal.astro';
import { ensureStarted } from '../../lib/store-singleton';
import { getConfig } from '../../lib/config';

const cfg = getConfig();
if (!cfg.transmissions.enabled) {
  return new Response('Not found', { status: 404 });
}
const store = await ensureStarted();
const items = store.listTransmissions(new Date());
---
<Terminal title="Transmissions">
  <h1 class="page-title">TRANSMISSIONS</h1>
  <p class="lede">Recorded broadcasts, newest first. Select a feed to begin playback.</p>
  {items.length === 0 && <p class="muted">&gt; no transmissions yet.</p>}
  <ul class="tx-feed">
    {items.map((t) => (
      <li class="tx-entry">
        <a class="tx-thumb" href={t.url} aria-label={`Play ${t.title}`}>
          <img src={`${t.urlPrefix}/assets/${t.poster}`} alt="" loading="lazy" />
          <span class="tx-play" aria-hidden="true"></span>
          {t.duration && <span class="tx-dur">{t.duration}</span>}
        </a>
        <div class="tx-meta">
          <h2 class="entry-title"><a href={t.url}>{t.title}</a></h2>
          <p class="entry-meta">{t.date}{t.duration ? ` · ${t.duration}` : ''}</p>
          {t.description && <p class="entry-teaser">{t.description}</p>}
        </div>
      </li>
    ))}
  </ul>
</Terminal>

<style>
  .tx-feed { list-style: none; padding: 0; margin: 1.5rem 0 0; }
  .tx-entry { display: grid; grid-template-columns: 320px 1fr; gap: 1.25rem; padding: 1.1rem 0; border-top: 1px dashed var(--fg-dim); }
  .tx-entry:first-child { border-top: none; }
  .tx-thumb { position: relative; display: block; aspect-ratio: 16 / 9; border: 1px solid var(--fg-dim); overflow: hidden; }
  .tx-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tx-thumb:hover { border-color: var(--fg); box-shadow: 0 0 12px rgba(51, 255, 102, 0.35); }
  .tx-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 0; height: 0; border-style: solid; border-width: 16px 0 16px 26px; border-color: transparent transparent transparent var(--fg); filter: drop-shadow(0 0 6px rgba(51,255,102,0.6)); }
  .tx-dur { position: absolute; right: 6px; bottom: 6px; font-size: 0.85rem; background: rgba(0,0,0,0.55); border: 1px solid var(--fg-dim); padding: 0 0.35rem; }
  @media (max-width: 640px) { .tx-entry { grid-template-columns: 1fr; } .tx-thumb { max-width: 420px; } }
</style>
```

- [ ] **Step 4: Create the player route (hls.js + JS-off fallback)**

Create `src/pages/transmissions/[slug].astro`:

```astro
---
import Terminal from '../../layouts/Terminal.astro';
import { ensureStarted } from '../../lib/store-singleton';
import { getConfig } from '../../lib/config';
import { transmissionMediaUrl } from '../../lib/transmission';

const cfg = getConfig();
if (!cfg.transmissions.enabled) {
  return new Response('Not found', { status: 404 });
}
const { slug } = Astro.params;
const store = await ensureStarted();
const tx = store.getLiveTransmission(`/transmissions/${slug}`, new Date());
if (!tx) {
  return new Response('Not found', { status: 404 });
}
const src = transmissionMediaUrl(cfg.transmissions.mediaBaseUrl, tx.video);
const posterUrl = `${tx.urlPrefix}/assets/${tx.poster}`;
---
<Terminal title={tx.title}>
  <p class="tx-back"><a href="/transmissions">◀ Back to transmissions</a></p>
  <div class="tx-stage">
    <video id="tx-video" class="tx-video" controls playsinline preload="none"
      poster={posterUrl} data-src={src}></video>
    <noscript>
      <img class="tx-poster" src={posterUrl} alt={tx.title} />
      <p class="muted">&gt; playback needs JavaScript. Direct stream: <a href={src}>{src}</a></p>
    </noscript>
  </div>
  <h1 class="page-title">{tx.title}</h1>
  <p class="entry-meta">{tx.date}{tx.duration ? ` · ${tx.duration}` : ''}</p>
  {tx.description && <p class="lede">{tx.description}</p>}
</Terminal>

<style>
  .tx-back { margin: 0 0 1rem; }
  .tx-stage { position: relative; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--fg); background: #0e150e; box-shadow: 0 0 22px rgba(51,255,102,0.22); }
  .tx-video, .tx-poster { width: 100%; height: 100%; object-fit: contain; display: block; background: #0e150e; }
</style>

<script>
  // Lazy: only this page pulls in hls.js. Safari/iOS play HLS natively.
  import Hls from 'hls.js';
  const video = document.getElementById('tx-video') as HTMLVideoElement | null;
  const src = video?.dataset.src;
  if (video && src) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.controls = false;
      video.poster && (video.outerHTML = `<img class="tx-poster" src="${video.poster}" alt="" />`);
    }
  }
</script>
```

- [ ] **Step 5: Activate the Transmissions tab**

In `src/layouts/Terminal.astro`, change the `tabs` array to append a gated Transmissions tab:

```ts
const tabs = [
  { label: 'Blogs', href: '/' },
  { label: 'Contributions', href: '/contributions' },
  ...(cfg.about.enabled ? [{ label: 'About me', href: '/about' }] : []),
  ...(cfg.transmissions.enabled ? [{ label: 'Transmissions', href: '/transmissions' }] : []),
];
```

(Coordination note: the separate `feat/disabled-tabs` branch adds a *disabled* Transmissions placeholder. If that branch merges first, delete its disabled Transmissions entry so this active one is the only Transmissions tab. `isActive('/transmissions')` already lights it on `/transmissions` and `/transmissions/{slug}` via the existing `startsWith` logic.)

- [ ] **Step 6: Build to verify types + bundling**

Run: `npm run build`
Expected: build succeeds; no TypeScript errors; `hls.js` bundles into the player page's client chunk.

- [ ] **Step 7: End-to-end verification against a hand-authored local entry**

Dev mode reads content directly from `CONTENT_LOCAL_DIR` (local mode, no clone, `gitDate` is null so the frontmatter `date` is used). Build a scratch content dir and run the dev server against it:

```bash
SCRATCH="$(mktemp -d)"
mkdir -p "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets"
cat > "$SCRATCH/transmissions/justcallmegreg-blog/demo/index.md" <<'MD'
---
title: "Demo Transmission"
date: "2026-06-02"
description: "A local demo entry."
video: "demo/master.m3u8"
duration: "05:52"
---
MD
# any small jpg works as the poster:
cp public/profile_picture.png "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets/poster.jpg"
CONTENT_LOCAL_DIR="$SCRATCH" npm run dev
```

Then verify (dev server prints its `http://localhost:PORT`):
- `curl -s localhost:PORT/transmissions` lists the `demo` entry with a poster `<img src="/transmissions/demo/assets/poster.jpg">` linking to `/transmissions/demo`.
- `curl -s localhost:PORT/transmissions/demo` contains `<video id="tx-video"` with `data-src` ending `/transmissions/demo/master.m3u8`, a `<noscript>` block with the poster + direct link (JS-off fallback), and the Transmissions tab marked active (`class="tab is-active"` on the Transmissions link).
- `curl -s -o /dev/null -w '%{http_code}' localhost:PORT/transmissions/demo/assets/poster.jpg` returns `200`.
- Add `draft: true` to the demo frontmatter; after the next sync (or restart), confirm `/transmissions` omits it and `/transmissions/demo` returns `404`.

Stop the dev server and remove `$SCRATCH` when done.

- [ ] **Step 8: Commit**

```bash
git add src/lib/config.ts package.json package-lock.json src/pages/transmissions src/layouts/Terminal.astro
git commit -m "feat(transmissions): list + HLS player routes, poster route, config, active tab"
```

---

### Task 4: Config example, docs, and full-suite verification

**Files:**
- Modify: `config.example.yaml`
- Modify: `docs/blogpost-publishing.md` (or a short new `docs/transmissions.md`)
- Modify: `README.md` (Features/Pages one-liner)

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Document the config in `config.example.yaml`**

Add under `content:` a commented `transmissionsSubdir: transmissions` line (matching the `decksSubdir` style), and a top-level block:

```yaml
transmissions:
  enabled: true
  # Public base URL of the R2 media bucket (Cloudflare custom domain). Playback
  # URL is ${mediaBaseUrl}/transmissions/${video}. Leave blank to disable playback.
  mediaBaseUrl: "https://media.justcallmegreg.io"
```

- [ ] **Step 2: Add a short docs section**

Add a "Transmissions (vlog)" subsection to `docs/blogpost-publishing.md` describing: the `transmissions/{owner}-{repo}/{slug}/index.md` layout with `assets/poster.jpg`; the frontmatter (`title`, `date`, `description`, `video` relative HLS path, `duration`, `draft`); that the HLS bytes live in R2 (not git) and are referenced via `video` + the engine's `transmissions.mediaBaseUrl`; and that it renders at `/transmissions` and `/transmissions/{slug}`.

- [ ] **Step 3: Update the README Pages list**

Add one line under **Pages** in `README.md`:
`- **Transmissions** (\`/transmissions\`) — a video vlog; entries list newest-first with a poster thumbnail, each opening an HLS player page (segmented/adaptive via hls.js, served from R2).`

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all files (the new `paths`, `transmission`, and `content-store` transmission tests included).

- [ ] **Step 5: Commit**

```bash
git add config.example.yaml docs/blogpost-publishing.md README.md
git commit -m "docs(transmissions): config example, publishing docs, README"
```
