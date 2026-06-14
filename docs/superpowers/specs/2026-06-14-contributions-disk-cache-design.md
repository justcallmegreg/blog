# Contributions on-disk cache — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

The Contributions tab fetches GitHub data (repos + PRs + push events) live during SSR, which is
slow on a cold/expired cache and is lost on restart. Replace the in-memory cache in
`src/lib/github.ts` with a **per-instance on-disk cache** using **stale-while-revalidate**: a
cached file is always served instantly (even when stale) and refreshed in the background; only a
truly cold cache (no file) blocks to fetch. Configurable via a new `github.cache` block.

## Goals

- The Contributions tab opens fast — SSR never awaits the GitHub API once a cache file exists.
- Survive restarts (cache on local disk under `CACHE_DIR`), per instance.
- Configurable enable + TTL; disabling reverts to the old live-fetch behavior.

## Non-goals

- No shared/centralized cache across replicas (each instance keeps its own file — as requested).
- No change to what data is fetched or to `contributions.astro`'s call site.
- No client-side lazy-loading of the tab (server stays the source of truth).

## Key decisions

| Decision | Choice |
|---|---|
| Strategy | Disk stale-while-revalidate; block only on a cold (no-file) cache. |
| Location | One JSON file per user under `CACHE_DIR` (per-instance, ephemeral). |
| Config | `github.cache.enabled` (default true), `github.cache.ttlSeconds` (default 1800). |
| Refresh | Background, fire-and-forget, single-flight guard; failures keep the existing file. |
| Call site | `contributions.astro` unchanged — still `getContributionDataCached(user, token)`. |

## Behavior (`getContributionDataCached`, refactored)

On each call for `user`:
1. **In-memory mirror:** if a process-local copy is fresh (age < TTL, no error), return it (fastest).
2. **Disk read:** else read `<cacheDir>/contributions/<user>.json` (a `ContributionData` JSON).
   - **Fresh** (age < TTL): populate the memory mirror, return it. No API call.
   - **Stale** (age ≥ TTL): return the stale data immediately **and** trigger a background refresh
     (not awaited).
3. **Cold** (no file / unreadable): the only blocking path — `await getContributionData(user, token)`,
   write the file (unless it errored), return.
- **Background refresh:** `fetch → write file + memory mirror`. A module-level `refreshing` set keyed
  by user prevents overlapping refreshes. If the refresh **fails**, the existing file is left intact
  (don't overwrite good data with an error).
- **`cache.enabled = false`:** skip disk entirely; `await getContributionData` every call (today's
  behavior, minus the in-memory cache).
- **Age** = `Date.now() - data.fetchedAt`; `TTL = ttlSeconds * 1000`.

Cold-fetch errors are still returned (so the page shows the existing "live data unavailable" note)
and are NOT written to disk, so the next open retries.

## Components & files

- **`src/lib/github.ts`** — replace the `Map`-based cache (`cache`, `getContributionDataCached`,
  `__clearGithubCache`, `TTL_MS`) with the disk layer:
  - `getContributionDataCached(user, token, opts?)` where `opts` (defaulted from config/env in the
    route, injectable in tests) = `{ enabled, ttlMs, cacheDir, now?, fetchImpl? }`. To keep the
    call site unchanged, the function reads config + `CACHE_DIR` internally by default; tests pass
    an explicit `opts` (and an injected fetch + clock) so no real I/O/network.
  - Internals: `cachePath(cacheDir, user)`, `readDiskCache(path)`, `writeDiskCache(path, data)`
    (atomic write: tmp file + rename; `mkdir -p` the dir), a `refreshing: Set<string>` single-flight
    guard, and a small in-memory `Map` mirror. `__clearGithubCache()` clears the mirror + guard
    (used by tests).
  - `getContributionData` (the raw fetcher) is unchanged; it already never throws.
- **`src/lib/config.ts`** (+ test) — add `github.cache` block.
- **`config.example.yaml` / `config.yaml`** — document it.
- **`src/pages/contributions.astro`** — unchanged (it calls `getContributionDataCached`).
- **`test/lib/github.test.ts`** — add cache tests (or a focused `github-cache.test.ts`).

## Config block

```yaml
github:
  username: "justcallmegreg"
  cache:
    enabled: true        # false → fetch live on every open (old behavior)
    ttlSeconds: 1800      # serve cached; refresh in the background once older than this
```
Zod (extend the existing `github` object): `cache: z.object({ enabled: z.boolean().default(true), ttlSeconds: z.number().int().default(1800) }).default({})`.

## Testing

Unit (injected `fetchImpl`, temp `cacheDir`, injected `now` — no real network/disk-of-record):
- **cold:** no file → fetches once, writes the file, returns data.
- **fresh:** file age < TTL → returns it, fetch NOT called.
- **stale:** file age ≥ TTL → returns the stale data immediately; a background refresh is triggered
  and (after it settles) the file is rewritten with new data.
- **refresh failure keeps old:** stale + the refresh fetch throws → still returns old data; file
  unchanged.
- **single-flight:** two stale reads in quick succession trigger only one refresh fetch.
- **disabled:** `enabled:false` → fetches every call, no file written.
- **config:** `github.cache` defaults (`enabled true`, `ttlSeconds 1800`).

(Use a real temp dir via `os.tmpdir()` for the disk read/write tests; clean up after.)

## Files

- Modify: `src/lib/github.ts`, `src/lib/config.ts` (+ `test/lib/config.test.ts`),
  `config.example.yaml` / `config.yaml`.
- Create: `test/lib/github-cache.test.ts`.
- Modify (docs): `README.md` env/cache note (CACHE_DIR already documented; add the cache config).

## Open questions / future work

- Optional: a startup warm (fetch once on boot) so even the first open is fast — deferred; the
  cold-block path is acceptable and rare.
- Optional: shared cache (Redis) for multi-replica consistency — out of scope (per-instance is fine).
