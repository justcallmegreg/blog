# Contributions on-disk cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Contributions tab open fast by replacing the in-memory GitHub cache with a per-instance on-disk stale-while-revalidate cache — serve the cached file instantly (even stale) and refresh in the background; only a cold cache blocks.

**Architecture:** Refactor the cache in `src/lib/github.ts` to read/write a per-user JSON file under `CACHE_DIR/contributions/`, with an in-memory mirror, a single-flight background refresh, and an injectable-opts seam for tests. Add a `github.cache` config block (`enabled`, `ttlSeconds`). `contributions.astro` is unchanged.

**Tech Stack:** Astro 5 SSR, TypeScript, Vitest, Node fs.

---

## File Structure & Responsibilities

```
src/lib/github.ts          # replace Map cache with disk SWR cache (+ test seam + helpers)
src/lib/config.ts          # + github.cache block (+ test)
config.example.yaml / config.yaml   # document github.cache
test/lib/github-cache.test.ts       # disk SWR unit tests (injected fetch/clock/tmp dir)
README.md                  # note the contributions disk cache + config
```

**Design note:** `getContributionDataCached(user, token, opts?)` keeps its 2-arg call site
(`contributions.astro`) working; `opts` is an injectable seam (`enabled`, `ttlMs`, `cacheDir`,
`now`, `fetch`) defaulted from config + `CACHE_DIR`, so tests run with no real network/disk-of-record.

---

## Task 1: `github.cache` config block

**Files:** Modify `src/lib/config.ts`, `test/lib/config.test.ts`, `config.example.yaml`, `config.yaml`

- [ ] **Step 1: Add assertions** — in `test/lib/config.test.ts`, after `expect(cfg.github.username).toBe('justcallmegreg');` add:

```ts
    expect(cfg.github.cache.enabled).toBe(true);
    expect(cfg.github.cache.ttlSeconds).toBe(1800);
```

- [ ] **Step 2: Run, confirm FAILS** — `npx vitest run test/lib/config.test.ts`

- [ ] **Step 3: Extend the `github` block** in `src/lib/config.ts` — replace:

```ts
  github: z
    .object({
      username: z.string().default('justcallmegreg'),
    })
    .default({}),
```

with:

```ts
  github: z
    .object({
      username: z.string().default('justcallmegreg'),
      // On-disk cache for the Contributions tab (per instance, under CACHE_DIR).
      cache: z
        .object({
          enabled: z.boolean().default(true),
          ttlSeconds: z.number().int().default(1800),
        })
        .default({}),
    })
    .default({}),
```

- [ ] **Step 4: Run, confirm PASSES** — `npx vitest run test/lib/config.test.ts`

- [ ] **Step 5: Document the config files** — in `config.example.yaml`, replace the `github:` block:

```yaml
github:
  username: "justcallmegreg"        # GitHub user summarized on the Contributions tab
  # Optional: set a GITHUB_TOKEN env var to raise API rate limits (not stored here).
  cache:
    enabled: true                   # cache contribution data on local disk (per instance)
    ttlSeconds: 1800                # serve cached; refresh in the background once older than this
```

In `config.yaml`, add the same `cache:` block under `github:` (find the existing `github:` /
`username:` lines and add the two `cache:` lines beneath, matching indentation).

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml
git commit -m "feat: github.cache config block (enabled, ttlSeconds)"
```

---

## Task 2: disk stale-while-revalidate cache in `github.ts`

**Files:** Modify `src/lib/github.ts`; Create `test/lib/github-cache.test.ts`

- [ ] **Step 1: Write the failing test** (`test/lib/github-cache.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getContributionDataCached,
  __clearGithubCache,
  __contribRefreshSettled,
  type ContributionData,
} from '../../src/lib/github';

function sample(user: string, fetchedAt: number, extra: Partial<ContributionData> = {}): ContributionData {
  return {
    user,
    repos: [],
    prs: [],
    // heatmap shape is irrelevant to the cache logic
    heatmap: { dayLabels: [], weekLabels: [], weeks: [], grid: [] } as unknown as ContributionData['heatmap'],
    fetchedAt,
    ...extra,
  };
}

let dir: string;
const NOW = 1_700_000_000_000;
const base = (fetchFn: ContributionData extends never ? never : any, over: Record<string, unknown> = {}) =>
  ({ enabled: true, ttlMs: 1000, cacheDir: dir, now: () => NOW, fetch: fetchFn, ...over });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'contrib-'));
  __clearGithubCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('getContributionDataCached — disk SWR', () => {
  it('cold cache: fetches once, writes the file, returns data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, 'u.json'))).toBe(true);
  });

  it('fresh cache: returns the file, does NOT fetch', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 500)));
    const fetchFn = vi.fn();
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 500);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stale cache: returns stale immediately + refreshes in the background', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW, { repos: [{ name: 'fresh' } as never] }));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 5000); // stale returned now
    expect(fetchFn).toHaveBeenCalledTimes(1); // background refresh kicked off
    await __contribRefreshSettled('u');
    const written = JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8'));
    expect(written.fetchedAt).toBe(NOW); // file updated by the refresh
  });

  it('stale + refresh fails: keeps the old file', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 5000);
    await __contribRefreshSettled('u');
    const written = JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8'));
    expect(written.fetchedAt).toBe(NOW - 5000); // unchanged
  });

  it('single-flight: two stale reads trigger only one refresh', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    let resolve!: (v: ContributionData) => void;
    const pending = new Promise<ContributionData>((r) => (resolve = r));
    const fetchFn = vi.fn().mockReturnValue(pending);
    await getContributionDataCached('u', undefined, base(fetchFn));
    await getContributionDataCached('u', undefined, base(fetchFn));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    resolve(sample('u', NOW));
    await __contribRefreshSettled('u');
  });

  it('disabled: always fetches, writes no file', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW));
    await getContributionDataCached('u', undefined, base(fetchFn, { enabled: false }));
    await getContributionDataCached('u', undefined, base(fetchFn, { enabled: false }));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dir, 'u.json'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAILS** — `npx vitest run test/lib/github-cache.test.ts`
Expected: FAIL — `__contribRefreshSettled` not exported / signature mismatch.

- [ ] **Step 3: Add imports** at the top of `src/lib/github.ts` (after the existing first import line):

```ts
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfig } from './config';
```

- [ ] **Step 4: Remove the old TTL constant** — delete this line near the top of `src/lib/github.ts`:

```ts
const TTL_MS = 30 * 60 * 1000; // cache GitHub data for 30 minutes
```

- [ ] **Step 5: Replace the old cache block** — replace this entire section:

```ts
const cache = new Map<string, ContributionData>();

/** Cached wrapper: serves data for up to TTL_MS; refetches successful data only. */
export async function getContributionDataCached(
  user: string,
  token?: string
): Promise<ContributionData> {
  const hit = cache.get(user);
  if (hit && !hit.error && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  const data = await getContributionData(user, token);
  // Cache errors briefly too (short TTL via fetchedAt) to avoid hammering on failure.
  cache.set(user, data);
  return data;
}

export function __clearGithubCache(): void {
  cache.clear();
}
```

with:

```ts
// ---- disk-backed stale-while-revalidate cache --------------------------------

export interface ContributionCacheOpts {
  enabled: boolean;
  ttlMs: number;
  cacheDir: string;
  now: () => number;
  fetch: (user: string, token?: string) => Promise<ContributionData>;
}

function defaultCacheOpts(): ContributionCacheOpts {
  const c = getConfig().github.cache;
  return {
    enabled: c.enabled,
    ttlMs: c.ttlSeconds * 1000,
    cacheDir: join(process.env.CACHE_DIR ?? './cache', 'contributions'),
    now: () => Date.now(),
    fetch: getContributionData,
  };
}

function cachePath(dir: string, user: string): string {
  return join(dir, `${user.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function readDiskCache(file: string): ContributionData | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ContributionData;
  } catch {
    return null;
  }
}

function writeDiskCache(file: string, data: ContributionData): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file); // atomic replace
  } catch {
    // best-effort: a failed write just means the next read is a miss
  }
}

function isFresh(data: ContributionData, o: ContributionCacheOpts): boolean {
  return !data.error && o.now() - data.fetchedAt < o.ttlMs;
}

const memMirror = new Map<string, ContributionData>();
const refreshing = new Map<string, Promise<void>>();

function backgroundRefresh(
  user: string,
  token: string | undefined,
  o: ContributionCacheOpts,
  file: string
): void {
  if (refreshing.has(user)) return; // single-flight
  const p = (async () => {
    try {
      const data = await o.fetch(user, token);
      if (!data.error) {
        writeDiskCache(file, data);
        memMirror.set(user, data);
      }
    } catch {
      // keep the existing file/mirror on failure
    } finally {
      refreshing.delete(user);
    }
  })();
  refreshing.set(user, p);
}

/**
 * Disk stale-while-revalidate cache: serves the cached file instantly (even when
 * stale) and refreshes in the background; only a cold (no-file) cache blocks to
 * fetch. Per instance (file under CACHE_DIR). `opts` is an injectable test seam.
 */
export async function getContributionDataCached(
  user: string,
  token?: string,
  opts?: Partial<ContributionCacheOpts>
): Promise<ContributionData> {
  const o = { ...defaultCacheOpts(), ...opts };
  if (!o.enabled) return o.fetch(user, token);

  const mem = memMirror.get(user);
  if (mem && isFresh(mem, o)) return mem;

  const file = cachePath(o.cacheDir, user);
  const disk = readDiskCache(file);
  if (disk) {
    memMirror.set(user, disk);
    if (isFresh(disk, o)) return disk;
    backgroundRefresh(user, token, o, file); // serve stale now, refresh for next time
    return disk;
  }

  // Cold cache: block once. Don't persist errors (so the next open retries).
  const data = await o.fetch(user, token);
  memMirror.set(user, data);
  if (!data.error) writeDiskCache(file, data);
  return data;
}

export function __clearGithubCache(): void {
  memMirror.clear();
  refreshing.clear();
}

/** Test helper: resolves once any in-flight background refresh for `user` settles. */
export async function __contribRefreshSettled(user: string): Promise<void> {
  await refreshing.get(user);
}
```

- [ ] **Step 6: Run, confirm PASSES** — `npx vitest run test/lib/github-cache.test.ts` (6 cases)

- [ ] **Step 7: Full suite + build** — `npx vitest run 2>&1 | grep -E "Tests +[0-9]|FAIL"` and `npm run build 2>&1 | tail -1` (the existing `test/lib/github.test.ts` must still pass — it imports `__clearGithubCache`, still exported).

- [ ] **Step 8: Commit**

```bash
git add src/lib/github.ts test/lib/github-cache.test.ts
git commit -m "feat(contributions): disk stale-while-revalidate cache (fast tab open)"
```

---

## Task 3: Verify + document

**Files:** Modify `README.md`

- [ ] **Step 1: Full suite + build** — `npx vitest run && npm run build` (all green).

- [ ] **Step 2: Verify the cache file is written + served** (offline-safe: the GitHub API call inside `getContributionData` may fail with no token/network — that's fine, it returns an `error` state and is NOT cached; we only assert the page renders and, when the API succeeds, a file appears):

```bash
pkill -9 -f "dist/server/entry.mjs" 2>/dev/null; lsof -ti tcp:4321 2>/dev/null | xargs kill -9 2>/dev/null; sleep 1
rm -rf /tmp/contrib-cache && mkdir -p /tmp/contrib-cache
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content CACHE_DIR=/tmp/contrib-cache PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
sleep 2
echo "first open (cold — may be slower):"
curl -s -o /dev/null -w "  status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:4321/contributions
echo "cache file written? (present iff the GitHub API call succeeded):"
ls /tmp/contrib-cache/contributions/ 2>/dev/null || echo "  (none — API unavailable offline; expected without network/token)"
echo "second open (warm if a file exists — should be fast):"
curl -s -o /dev/null -w "  status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:4321/contributions
pkill -9 -f "dist/server/entry.mjs"
```
Expected: both render `status=200`. If the runner has network, a `contributions/justcallmegreg.json` file appears after the first open and the second open is fast; offline, the page still renders (error state) and no file is written — both acceptable.

- [ ] **Step 3: README note** — in the **Environment variables** table, update the `CACHE_DIR` row to mention contributions, OR add a sentence after the table:

```markdown
The Contributions tab caches the GitHub data on local disk under `CACHE_DIR/contributions/`
(stale-while-revalidate; configurable via `github.cache`), so the tab opens fast and survives
restarts — each instance keeps its own cache.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note the contributions disk cache + github.cache config"
```

---

## Notes for the implementer

- **Call site unchanged:** `contributions.astro` still calls `getContributionDataCached(user, token)`;
  the new `opts?` 3rd param defaults from config + `CACHE_DIR`. Don't touch the page.
- **Never block once warm:** only the cold path (no file) `await`s the fetch; stale always returns
  immediately and refreshes via `backgroundRefresh` (single-flight, failure keeps old data).
- **Errors aren't persisted:** an errored fetch is returned (page shows the existing "live data
  unavailable" note) but never written to disk, so the next open retries.
- **Per instance:** the file lives under `CACHE_DIR` (ephemeral in the container); each replica
  keeps its own — no shared store (by design).
- The in-memory `memMirror` keeps repeat reads within one process instant; `__clearGithubCache()`
  (used by existing `github.test.ts`) now clears the mirror + refresh map.
