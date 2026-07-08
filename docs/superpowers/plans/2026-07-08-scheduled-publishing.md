# Scheduled Publishing (`publishAt`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a post carry an optional `publishAt` timestamp so the engine hides it from the site (list, RSS, and its URL) until that moment, then reveals it automatically.

**Architecture:** Engine-side, request-time gate. `publishAt` is parsed once at index time into a UTC instant (bare times interpreted in a configurable IANA timezone, DST-correct) and stored on the `Post`. A single `isLive(post, now)` predicate — used by `listPosts(now)`, a new `getLivePost(url, now)`, and `resolveAssetPath(slug, file, now)` — hides drafts and not-yet-published posts. No cron, no sync-loop dependency: a post appears on the next request after its time.

**Tech Stack:** Astro SSR (Node), TypeScript, Zod (config + frontmatter schemas), Vitest (node environment, no DOM), `Intl.DateTimeFormat` for timezone math.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-08-scheduled-publishing-design.md`.
- Purely additive — posts without `publishAt` must behave byte-for-byte as today.
- Default timezone when `content.timezone` is unset: **`"Europe/Budapest"`** (exact string).
- `publishAt` and `date` frontmatter values must be **quoted strings** (YAML would otherwise coerce a bare datetime to a Date object and fail the `z.string()` schema).
- Stored `publishAt` on a `Post` is a **UTC ISO instant** string (e.g. `"2026-08-01T07:00:00.000Z"`); comparisons are instant-vs-instant via `Date.parse(...) <= now.getTime()`.
- Invalid `publishAt` (present but unparseable) → keep the post **hidden** and log a `[content]` warning (fail safe toward the gate).
- Tests are deterministic: always pass an explicit `now: Date`; never rely on the real clock.
- Run the full suite with `npm test`. Build with `npm run build`.

---

### Task 1: Schema plumbing — `content.timezone` config + `publishAt` frontmatter

**Files:**
- Modify: `src/lib/config.ts:11-18` (content schema)
- Modify: `src/lib/frontmatter.ts:5-10` (frontmatter schema)
- Test: `test/lib/config.test.ts`, `test/lib/frontmatter.test.ts`

**Interfaces:**
- Produces: `Config.content.timezone: string` (defaulted to `"Europe/Budapest"`); `PostFrontmatter.publishAt?: string`.

- [ ] **Step 1: Write failing config test**

Add inside `describe('loadConfig', ...)` in `test/lib/config.test.ts` (after the existing `content.syncIntervalSeconds` assertion is fine; add a new `it`):

```ts
  it('defaults content.timezone to Europe/Budapest and accepts an override', () => {
    const base = writeConfig(`
site:
  title: "x"
content:
  repo: "https://github.com/you/content.git"
`);
    dirs.push(join(base, '..'));
    expect(loadConfig(base).content.timezone).toBe('Europe/Budapest');

    const custom = writeConfig(`
site:
  title: "x"
content:
  repo: "https://github.com/you/content.git"
  timezone: "UTC"
`);
    dirs.push(join(custom, '..'));
    expect(loadConfig(custom).content.timezone).toBe('UTC');
  });
```

- [ ] **Step 2: Write failing frontmatter test**

Add inside `describe('parseFrontmatter', ...)` in `test/lib/frontmatter.test.ts`:

```ts
  it('parses an optional publishAt string', () => {
    const { data } = parseFrontmatter('---\ntitle: T\npublishAt: "2026-08-01T09:00"\n---\nbody');
    expect(data.publishAt).toBe('2026-08-01T09:00');
  });
  it('leaves publishAt undefined when absent', () => {
    const { data } = parseFrontmatter('---\ntitle: T\n---\nbody');
    expect(data.publishAt).toBeUndefined();
  });
```

- [ ] **Step 3: Run the two tests to verify they fail**

Run: `npm test -- config frontmatter`
Expected: FAIL — `content.timezone` is `undefined`; `data.publishAt` is `undefined` (schema has no such key yet, so the parse succeeds but the value is absent → the first frontmatter assertion fails).

- [ ] **Step 4: Add `timezone` to the content config schema**

In `src/lib/config.ts`, change the `content` object (lines 11-18) to:

```ts
  content: z
    .object({
      repo: z.string(),
      branch: z.string().default('main'),
      subdir: z.string().default(''),
      syncIntervalSeconds: z.number().int().positive().default(300),
      // IANA timezone used to interpret bare `publishAt` times in posts.
      timezone: z.string().default('Europe/Budapest'),
    })
    .default({}),
```

- [ ] **Step 5: Add `publishAt` to the frontmatter schema**

In `src/lib/frontmatter.ts`, change `FrontmatterSchema` (lines 5-10) to:

```ts
const FrontmatterSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  date: z.string().optional(),
  // Optional schedule: when set and in the future, the engine hides the post
  // until this moment. See docs/superpowers/specs/2026-07-08-scheduled-publishing-design.md.
  publishAt: z.string().optional(),
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- config frontmatter`
Expected: PASS (all config + frontmatter tests green).

- [ ] **Step 7: Commit**

```bash
git add src/lib/config.ts src/lib/frontmatter.ts test/lib/config.test.ts test/lib/frontmatter.test.ts
git commit -m "feat(schedule): add content.timezone config + publishAt frontmatter field"
```

---

### Task 2: `publish-schedule.ts` — parse `publishAt` into a UTC instant + local day

**Files:**
- Create: `src/lib/publish-schedule.ts`
- Test: `test/lib/publish-schedule.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PublishAtResult =
    | { kind: 'none' }
    | { kind: 'invalid' }
    | { kind: 'scheduled'; instant: string; day: string };
  export function parsePublishAt(value: string | undefined, timezone: string): PublishAtResult;
  ```
  `instant` is a UTC ISO string; `day` is the `YYYY-MM-DD` calendar day of that instant in `timezone`.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/publish-schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePublishAt } from '../../src/lib/publish-schedule';

describe('parsePublishAt', () => {
  it('returns none for empty/absent input', () => {
    expect(parsePublishAt(undefined, 'Europe/Budapest')).toEqual({ kind: 'none' });
    expect(parsePublishAt('', 'Europe/Budapest')).toEqual({ kind: 'none' });
    expect(parsePublishAt('   ', 'Europe/Budapest')).toEqual({ kind: 'none' });
  });

  it('interprets a bare local time in the given timezone, DST-correct (summer/CEST)', () => {
    const r = parsePublishAt('2026-08-01T09:00', 'Europe/Budapest');
    // 09:00 Budapest in August is CEST (+02:00) → 07:00 UTC
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T07:00:00.000Z',
      day: '2026-08-01',
    });
  });

  it('interprets a bare local time DST-correct (winter/CET)', () => {
    const r = parsePublishAt('2026-01-15T09:00', 'Europe/Budapest');
    // 09:00 Budapest in January is CET (+01:00) → 08:00 UTC
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-01-15T08:00:00.000Z',
      day: '2026-01-15',
    });
  });

  it('accepts optional seconds and a space separator', () => {
    const r = parsePublishAt('2026-08-01 09:00:30', 'Europe/Budapest');
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T07:00:30.000Z',
      day: '2026-08-01',
    });
  });

  it('honours an explicit offset and ignores the config timezone', () => {
    const r = parsePublishAt('2026-08-01T09:00+00:00', 'Europe/Budapest');
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T09:00:00.000Z',
      day: '2026-08-01', // 09:00Z is still Aug 1 in Budapest (11:00 local)
    });
  });

  it('honours a trailing Z', () => {
    const r = parsePublishAt('2026-08-01T23:30Z', 'Europe/Budapest');
    // 23:30Z is 01:30 next day in Budapest (CEST) → day rolls to Aug 2
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T23:30:00.000Z',
      day: '2026-08-02',
    });
  });

  it('returns invalid for a malformed datetime', () => {
    expect(parsePublishAt('not-a-date', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
    expect(parsePublishAt('2026-13-40T09:00', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for an unknown timezone', () => {
    expect(parsePublishAt('2026-08-01T09:00', 'Mars/Olympus')).toEqual({ kind: 'invalid' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- publish-schedule`
Expected: FAIL — module `src/lib/publish-schedule.ts` not found.

- [ ] **Step 3: Implement `src/lib/publish-schedule.ts`**

```ts
// Resolve a post's `publishAt` frontmatter value into a UTC instant + local day.
// A bare local datetime (no offset) is interpreted as wall-clock time in the
// site's configured IANA timezone, DST-correct. A value with an explicit offset
// or a trailing `Z` is used as-is. Anything unparseable — including an invalid
// timezone — is reported as `invalid` so the caller can hide the post and warn.

export type PublishAtResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'scheduled'; instant: string; day: string };

interface Wall {
  y: number; mo: number; d: number; h: number; mi: number; s: number;
}

// YYYY-MM-DD, a `T` or space separator, HH:MM, optional :SS, optional offset.
const DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

export function parsePublishAt(
  value: string | undefined,
  timezone: string
): PublishAtResult {
  if (value == null || value.trim() === '') return { kind: 'none' };
  const m = DATETIME.exec(value.trim());
  if (!m) return { kind: 'invalid' };
  const [, y, mo, d, h, mi, s, offset] = m;
  const sec = s ?? '00';

  let instantMs: number;
  if (offset) {
    instantMs = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`);
    if (Number.isNaN(instantMs)) return { kind: 'invalid' };
  } else {
    const ms = wallClockToUtc(
      { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +sec },
      timezone
    );
    if (ms == null) return { kind: 'invalid' };
    instantMs = ms;
  }

  // Reject out-of-range calendar values (e.g. month 13): if the parsed instant,
  // re-read in UTC, doesn't round-trip the input components, the date was invalid.
  const day = localDay(instantMs, timezone);
  if (day == null) return { kind: 'invalid' };
  return { kind: 'scheduled', instant: new Date(instantMs).toISOString(), day };
}

// Convert wall-clock components in `timezone` to a UTC epoch (ms), DST-correct.
// Treat the components as if UTC, see how that instant renders in the zone, and
// correct by the difference. One pass suffices except at DST edges, so do two.
function wallClockToUtc(w: Wall, timezone: string): number | null {
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  if (Number.isNaN(asUtc)) return null;
  // Reject components that Date.UTC silently rolled over (e.g. month 13, day 40).
  const back = zoneParts(asUtc, 'UTC');
  if (!back || back.y !== w.y || back.mo !== w.mo || back.d !== w.d) return null;

  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const off = zoneOffsetMs(guess, timezone);
    if (off == null) return null;
    const next = asUtc - off;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

// The zone's UTC offset (ms) at a given instant.
function zoneOffsetMs(instantMs: number, timezone: string): number | null {
  const p = zoneParts(instantMs, timezone);
  if (!p) return null;
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - instantMs;
}

// Break a UTC instant into calendar/clock parts as seen in `timezone`.
// Returns null for an invalid timezone (Intl throws).
function zoneParts(instantMs: number, timezone: string): Wall | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(instantMs)) p[part.type] = part.value;
    let hour = +p.hour;
    if (hour === 24) hour = 0; // some engines render midnight as "24"
    return { y: +p.year, mo: +p.month, d: +p.day, h: hour, mi: +p.minute, s: +p.second };
  } catch {
    return null;
  }
}

function localDay(instantMs: number, timezone: string): string | null {
  const p = zoneParts(instantMs, timezone);
  if (!p) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}
```

- [ ] **Step 4: Run to verify all parser tests pass**

Run: `npm test -- publish-schedule`
Expected: PASS (all cases green, including DST summer/winter and invalid timezone).

- [ ] **Step 5: Commit**

```bash
git add src/lib/publish-schedule.ts test/lib/publish-schedule.test.ts
git commit -m "feat(schedule): parse publishAt into a UTC instant + local day (DST-correct)"
```

---

### Task 3: Content store — gate scheduled posts, wire the timezone

**Files:**
- Modify: `src/lib/content-store.ts` (Post interface, ContentStoreOptions, reindex, listPosts, getPost neighbours, resolveAssetPath, new isLive/getLivePost)
- Modify: `src/lib/store-singleton.ts` (pass `timezone` into both option branches)
- Test: `test/lib/content-store.test.ts`

**Interfaces:**
- Consumes: `parsePublishAt` from Task 2; `Config.content.timezone` from Task 1.
- Produces on `ContentStore`:
  - `listPosts(now?: Date): Post[]`
  - `getLivePost(url: string, now?: Date): Post | undefined`
  - `resolveAssetPath(slug: string, file: string, now?: Date): string | null`
  - `Post` gains `publishAt?: string` and `scheduleInvalid?: boolean`.
  - `ContentStoreOptions` gains `timezone?: string`.

- [ ] **Step 1: Write the failing tests**

In `test/lib/content-store.test.ts`, add `vi` to the vitest import on line 1:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

Then add these `it` blocks inside `describe('ContentStore', ...)`:

```ts
  it('hides a post scheduled in the future from the list and its URL', async () => {
    commitPost('future', '---\ntitle: Future\npublishAt: "2030-01-01T00:00:00Z"\n---\nsoon');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('future');
    expect(store.getLivePost('/future', now)).toBeUndefined();
    // still retrievable raw (internal callers / preview)
    expect(store.getPost('/future')?.title).toBe('Future');
    expect(store.getPost('/future')?.publishAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('shows a post once its publishAt has passed', async () => {
    commitPost('past', '---\ntitle: Past\npublishAt: "2020-01-01T00:00:00Z"\n---\nlive');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.listPosts(now).map((p) => p.slug)).toContain('past');
    expect(store.getLivePost('/past', now)?.title).toBe('Past');
  });

  it('flips a scheduled post live exactly at its publishAt (request-time gate)', async () => {
    commitPost('drop', '---\ntitle: Drop\npublishAt: "2026-08-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.getLivePost('/drop', new Date('2026-07-31T23:59:59Z'))).toBeUndefined();
    expect(store.getLivePost('/drop', new Date('2026-08-01T00:00:01Z'))?.title).toBe('Drop');
  });

  it('keeps a post with an invalid publishAt hidden and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    commitPost('broken', '---\ntitle: Broken\npublishAt: "not-a-date"\n---\nx');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLivePost('/broken', now)).toBeUndefined();
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('broken');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('publishAt'));
    warn.mockRestore();
  });

  it('dates a scheduled post by its publishAt day when no explicit date is set', async () => {
    commitPost('dbs', '---\ntitle: DBS\npublishAt: "2020-03-04T09:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    // 09:00Z on Mar 4 is 10:00 in Budapest (CET) → day 2020-03-04
    expect(store.getPost('/dbs')?.date).toBe('2020-03-04');
  });

  it('lets an explicit date override the publishAt day', async () => {
    commitPost('exp', '---\ntitle: E\ndate: "2019-12-31"\npublishAt: "2020-03-04T09:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.getPost('/exp')?.date).toBe('2019-12-31');
  });

  it('keeps a draft hidden even after its publishAt has passed', async () => {
    commitPost('ds', '---\ntitle: DS\ndraft: true\npublishAt: "2020-01-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLivePost('/ds', now)).toBeUndefined();
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('ds');
  });

  it('does not serve assets for a not-yet-published post', async () => {
    commitPost('fa', '---\ntitle: FA\npublishAt: "2030-01-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.resolveAssetPath('fa', 'x.png', new Date('2025-01-01T00:00:00Z'))).toBeNull();
    expect(store.resolveAssetPath('fa', 'x.png', new Date('2031-01-01T00:00:00Z'))).toBe(
      resolve(cacheDir, NS, 'fa/assets/x.png')
    );
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- content-store`
Expected: FAIL — `getLivePost` is not a function; `listPosts(now)` ignores the arg; `publishAt`/`scheduleInvalid` undefined.

- [ ] **Step 3: Import the parser and extend the types**

In `src/lib/content-store.ts`, add to the imports near the top (after the `parseFrontmatter` import):

```ts
import { parsePublishAt } from './publish-schedule';
```

Add two fields to the `Post` interface (after `blobHash: string;`):

```ts
  blobHash: string;
  readingMinutes: number;
  publishAt?: string;        // resolved UTC instant when validly scheduled
  scheduleInvalid?: boolean; // publishAt was present but unparseable → keep hidden
```

Add `timezone` to `ContentStoreOptions` (after `token?: string;`):

```ts
  token?: string;
  /** IANA timezone for interpreting bare `publishAt` times. Defaults to Europe/Budapest. */
  timezone?: string;
```

- [ ] **Step 4: Add the `isLive` predicate and a timezone accessor**

In `src/lib/content-store.ts`, inside the `ContentStore` class, add these private helpers (e.g. just above `listPosts`):

```ts
  private tz(): string {
    return this.opts.timezone ?? 'Europe/Budapest';
  }

  /** Visible to readers now? Drafts and not-yet-published posts are not. */
  private isLive(post: Post, now: Date): boolean {
    if (post.draft) return false;
    if (post.scheduleInvalid) return false;
    if (post.publishAt && Date.parse(post.publishAt) > now.getTime()) return false;
    return true;
  }
```

- [ ] **Step 5: Gate `listPosts`, add `getLivePost`, gate `resolveAssetPath`**

Replace the existing `listPosts` method:

```ts
  listPosts(now: Date = new Date()): Post[] {
    return [...this.index.values()]
      .filter((p) => this.isLive(p, now))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
```

Add a new method next to `getPost` (leave `getPost` unchanged):

```ts
  /** Like getPost, but returns undefined unless the post is live at `now`. */
  getLivePost(url: string, now: Date = new Date()): Post | undefined {
    const post = this.index.get(url);
    return post && this.isLive(post, now) ? post : undefined;
  }
```

Change `resolveAssetPath`'s signature and add the liveness gate (keep the traversal logic below it unchanged):

```ts
  resolveAssetPath(slug: string, file: string, now: Date = new Date()): string | null {
    const post = this.index.get(`/${slug}`);
    if (!post || !this.isLive(post, now)) return null;
```

(The existing body previously started `const post = this.index.get(...); if (!post) return null;` — replace those two lines with the block above; the rest of the method stays.)

- [ ] **Step 6: Parse `publishAt` during reindex and set the fields**

In `reindex`, inside the `try` block, right before `this.index.set(info.url, { ... })`, insert:

```ts
        const sched = parsePublishAt(data.publishAt, this.tz());
        if (sched.kind === 'invalid') {
          console.warn(
            `[content] ${contentRel}: invalid publishAt ${JSON.stringify(data.publishAt)} — keeping the post hidden`
          );
        }
        const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;
```

Then change the `this.index.set(info.url, { ... })` object: replace the `date:` line and add the two new fields:

```ts
          date: pickPublishedDate(data.date, publishAtDay ?? gitDate),
```

and add, alongside `readingMinutes,`:

```ts
          readingMinutes,
          publishAt: sched.kind === 'scheduled' ? sched.instant : undefined,
          scheduleInvalid: sched.kind === 'invalid' ? true : undefined,
```

- [ ] **Step 7: Pass the timezone from the singleton**

In `src/lib/store-singleton.ts`, add `timezone: cfg.content.timezone,` to **both** option objects passed to `getStore(...)` — the `localDir ? { ... }` branch and the `: { ... }` branch. For example the git branch becomes:

```ts
      : {
          repo: cfg.content.repo,
          branch: cfg.content.branch,
          subdir: cfg.content.subdir,
          cacheDir: process.env.CACHE_DIR ?? './cache',
          token: process.env.CONTENT_REPO_TOKEN,
          timezone: cfg.content.timezone,
        }
```

and add the same `timezone: cfg.content.timezone,` line to the `local: true` branch.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — all new scheduling tests plus the existing 153 (the untouched `listPosts()`/`resolveAssetPath()` calls still work via the defaulted `now`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/content-store.ts src/lib/store-singleton.ts test/lib/content-store.test.ts
git commit -m "feat(schedule): gate scheduled posts in the content store (list, URL, assets)"
```

---

### Task 4: Wire the read paths, document, and verify a build

**Files:**
- Modify: `src/pages/index.astro:15`
- Modify: `src/pages/rss.xml.ts:17`
- Modify: `src/pages/[slug].astro:12-16`
- Modify: `src/pages/[slug]/assets/[...file].ts:21`
- Modify: `config.example.yaml`
- Modify: `docs/blogpost-publishing.md`

**Interfaces:**
- Consumes: `listPosts(now)`, `getLivePost(url, now)`, `resolveAssetPath(slug, file, now)` from Task 3.

- [ ] **Step 1: Gate the post list (index)**

In `src/pages/index.astro`, change the `listPosts()` call (line 15):

```ts
const posts = store.listPosts(new Date());
```

- [ ] **Step 2: Gate the RSS feed**

In `src/pages/rss.xml.ts`, change line 17 from `items: store.listPosts().map(...)` to:

```ts
    items: store.listPosts(new Date()).map((p) => ({
```

- [ ] **Step 3: 404 scheduled/draft posts on the post page**

In `src/pages/[slug].astro`, replace the lookup + guard (currently `const post = store.getPost(...); if (!post || post.draft) { return 404 }`) with:

```ts
const post = store.getLivePost(`/${slug}`, new Date());

if (!post) {
  return new Response('Not found', { status: 404 });
}
```

- [ ] **Step 4: 404 scheduled posts' assets**

In `src/pages/[slug]/assets/[...file].ts`, change line 21:

```ts
  const path = store.resolveAssetPath(slug, file, new Date());
```

- [ ] **Step 5: Document `content.timezone` in the example config**

In `config.example.yaml`, under the `content:` block (next to `subdir` / `syncIntervalSeconds`), add:

```yaml
  timezone: "Europe/Budapest"     # IANA zone for interpreting bare publishAt times (default: Europe/Budapest)
```

- [ ] **Step 6: Document scheduling in the publishing guide**

Append a section to `docs/blogpost-publishing.md`:

```markdown
## Scheduling a post

Add a quoted `publishAt` to a post's frontmatter to hold it until a future moment:

```yaml
---
title: "My scheduled post"
publishAt: "2026-08-01T09:00"     # 09:00 in content.timezone (default Europe/Budapest)
---
```

- Until `publishAt` passes, the post is absent from the site — the blog list, the
  RSS feed, and its own URL (and its assets) all return 404. It appears
  automatically on the next request after its time (no redeploy or sync needed).
- Bare times are read in `content.timezone`; include an explicit offset (e.g.
  `"2026-08-01T09:00+02:00"` or `"...Z"`) to override. **Quote the value** — an
  unquoted datetime is rejected.
- `publishAt` is independent of `date`: `date` still sets the *displayed* date;
  if you omit it, a scheduled post is dated by `publishAt`'s day.
- A malformed `publishAt` keeps the post hidden and logs a `[content]` warning.

> Note: content merged into `blog-content` is public on GitHub immediately — this
> hides the post *on the site*, it does not keep the file secret.
```

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: `[build] Complete!` with no type errors (the consumer edits type-check against the new store signatures).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites green).

- [ ] **Step 9: Manual end-to-end check (optional but recommended)**

Serve locally with a scheduled post and confirm the gate, using the local-content dev mode:

```bash
# create a content dir with one future-dated post, then:
CONTENT_LOCAL_DIR=<dir> npm run dev
```
Verify: a post with a future `publishAt` is absent from `/` and returns 404 at its slug; editing the `publishAt` to the past (and waiting one sync) makes it appear. (This mirrors the local-content preview flow used elsewhere in the repo.)

- [ ] **Step 10: Commit**

```bash
git add src/pages/index.astro src/pages/rss.xml.ts "src/pages/[slug].astro" "src/pages/[slug]/assets/[...file].ts" config.example.yaml docs/blogpost-publishing.md
git commit -m "feat(schedule): gate list/RSS/URL/assets on publishAt; document scheduling"
```

---

## Self-Review

**Spec coverage:**
- Config `content.timezone` (default Europe/Budapest) → Task 1. ✓
- `publishAt` frontmatter field → Task 1. ✓
- DST-correct timezone parsing, explicit-offset support, invalid handling → Task 2. ✓
- `isLive` predicate; `listPosts(now)`, `getPost` (raw), `getLivePost(now)` → Task 3. ✓
- `Post.publishAt` stored UTC instant → Task 3. ✓
- Display-date precedence (date → publishAt day → git) → Task 3, Step 6. ✓
- Invalid → hidden + `[content]` warn → Task 3, Step 6 + test. ✓
- Consumers: index, rss, `[slug]`, assets → Task 4. ✓
- Docs: `config.example.yaml`, `docs/blogpost-publishing.md` → Task 4. ✓
- Timezone threaded via `ContentStoreOptions` + store-singleton → Task 3, Steps 3/7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows full assertions.

**Type consistency:** `parsePublishAt(value, timezone) → PublishAtResult` (Task 2) is consumed exactly in Task 3 Step 6. `listPosts(now?)`, `getLivePost(url, now?)`, `resolveAssetPath(slug, file, now?)`, `Post.publishAt`, `Post.scheduleInvalid`, `ContentStoreOptions.timezone` are defined in Task 3 and used identically in Task 4. Default timezone string `"Europe/Budapest"` is identical across config schema (Task 1) and `tz()` fallback (Task 3).
