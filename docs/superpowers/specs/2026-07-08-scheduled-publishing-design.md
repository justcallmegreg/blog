# Scheduled publishing (`publishAt`) — design

**Status:** approved design, ready for implementation planning
**Date:** 2026-07-08

## Summary

Add an optional way to schedule a post to appear on the site at a future date and
time. A post carries a `publishAt` timestamp in its frontmatter; until that moment
the engine treats the post as if it does not exist (absent from the list, RSS, and
its own URL), then it appears automatically. Existing posts are unaffected.

This is a **soft embargo**: the post may already live in the (public) `blog-content`
repo — only its visibility *on the site* is gated. The gate is enforced entirely in
the **engine**, evaluated **per request**, so a post goes live on the next request
after its time with no cron, no external scheduler, and no dependency on the 30s
content sync.

## Goals

- Optional per-post scheduling with **date + time** precision.
- Author writes a wall-clock time in a **site-configured timezone** (DST-correct);
  an explicit offset in the value is also honoured.
- Before its time, a scheduled post is **fully absent** from the site — list, RSS,
  and its URL (and its assets) all 404 — then everything appears at once.
- Zero infrastructure: no cron job, no workflow, no change to the publishing flow.
- No behaviour change for posts without `publishAt`.

## Non-goals

- Hard embargo (keeping the content secret in git until publish time). Rejected:
  the author accepted that content may sit in the public repo early.
- Un-publishing / expiry (a "hide after" date). Out of scope.
- Editorial workflow, approvals, or a scheduling UI. Out of scope.
- Sub-second precision. The 30s sync is irrelevant to timing (gate is request-time),
  but authoring precision is minutes.

## Author-facing API

### Config (optional)

A single new optional key, used only to interpret bare `publishAt` times:

```yaml
content:
  timezone: "Europe/Budapest"   # IANA zone; optional, defaults to "Europe/Budapest"
```

- Added to the engine config Zod schema as an optional string defaulting to
  `"Europe/Budapest"`.
- Documented in `config.example.yaml`.

### Frontmatter (optional)

One new optional field on any post:

```yaml
---
title: "My scheduled post"
publishAt: "2026-08-01T09:00"   # 09:00 in content.timezone (DST-correct)
---
```

Accepted forms for `publishAt`:

- **Bare local** — `2026-08-01T09:00` (seconds optional): interpreted as wall-clock
  time in `content.timezone`.
- **Explicit offset / UTC** — `2026-08-01T09:00+02:00` or `2026-08-01T07:00Z`: used
  as-is; `content.timezone` is ignored for that value.

Semantics:

- **No `publishAt`** → unchanged behaviour (git/`date`-driven, live immediately).
- **`publishAt` in the future** → post is fully absent from the site.
- **`publishAt` now or in the past** → post is live, identical to a normal post.
- `publishAt` and the existing `date` field are **independent**: `publishAt` gates
  *when* the post appears; `date` (if set) still overrides the *displayed* date.

## Architecture

### Visibility predicate

A single predicate, evaluated per request, centralises all gating:

```
isLive(post, now) = !post.draft && (post.publishAt == null || instant(post.publishAt) <= now.getTime())
```

where `instant(publishAt)` is the epoch-ms of the stored UTC ISO string (i.e. the
comparison is instant-vs-instant, not a string compare). `draft` and `publishAt`
both flow through the same predicate, so a draft stays hidden regardless of
`publishAt`, and a scheduled post behaves like a draft until its time.

### Data model

`Post` gains one field:

- **`publishAt?: string`** — the resolved **UTC instant** as an ISO string
  (e.g. `"2026-08-01T07:00:00.000Z"`), computed once at index time from the
  frontmatter value + `content.timezone`. `undefined` when the post has no schedule.

### Schedule module — `src/lib/publish-schedule.ts`

One pure function (plus the predicate if colocated here):

```
resolvePublishAt(value: string | undefined, timezone: string): string | null
```

- Empty/absent → `null`.
- Explicit offset or `Z` in the value → parse directly to a UTC instant.
- Bare local (no offset) → interpret as wall-clock in `timezone`, **DST-correct**:
  derive the zone's actual UTC offset *at that local moment* via
  `Intl.DateTimeFormat` with `timeZone`, so `09:00` in July (CEST, +02:00) and in
  January (CET, +01:00) both resolve correctly with no hard-coded offsets.
- Invalid datetime, or invalid/unknown IANA timezone → `null`.
- Returns a normalised UTC ISO string.

### Content store — `src/lib/content-store.ts`

- **`listPosts(now = new Date()): Post[]`** — filter to `isLive(post, now)`, then sort
  (unchanged sort). Excludes drafts *and* not-yet-published posts.
- **`getPost(url): Post | undefined`** — unchanged raw lookup (still returns
  drafts/scheduled; preserves internal callers and the existing "drafts retrievable
  by URL" test).
- **`getLivePost(url, now = new Date()): Post | undefined`** — new gated accessor:
  returns the post only if `isLive`, else `undefined`.

During `reindex`, parse `publishAt` with `resolvePublishAt(data.publishAt, cfg tz)`
and store the result on the `Post`. Invalid values → store as "scheduled but
unpublishable": keep the post **hidden** (see Error handling) and log a warning.

### Display date

`pickPublishedDate` precedence extends to:

1. explicit frontmatter `date` (valid `YYYY-MM-DD`), else
2. `publishAt`'s calendar day in `content.timezone` (if `publishAt` set), else
3. git first-add date, else
4. empty (undated).

So a post scheduled for Aug 1 shows `2026-08-01` once live rather than its earlier
commit date, unless an explicit `date` overrides.

### Consumers

| File | Change |
|---|---|
| `src/pages/index.astro` | `listPosts()` → `listPosts(new Date())` |
| `src/pages/rss.xml.ts` | `listPosts()` → `listPosts(new Date())` |
| `src/pages/[slug].astro` | replace `getPost` + `post.draft` 404 check with `getLivePost(url, new Date())`; `undefined` → 404 |
| `src/pages/[slug]/assets/[...file].ts` | gate on `getLivePost` so a scheduled post's assets 404 before its time |

Because the gate reads stored `publishAt` against `now` at request time, a post goes
live on the **next request after its time** — the 30s content sync stays purely about
content changes.

## Error handling

- **Invalid `publishAt`** (malformed datetime or unknown timezone) → the post is kept
  **hidden** and a loud `[content]` warning is logged naming the post and the bad
  value. Rationale: `publishAt` signals intent to gate, so failing safe means honouring
  the gate; the warning surfaces the typo in the container logs. (Chosen over
  fail-open, which could leak a post early and silently.)
- **Missing `content.timezone`** → schema default `"Europe/Budapest"`. An explicitly
  configured but unknown zone string passed to `resolvePublishAt` yields `null`
  (treated as invalid `publishAt` per above) and is logged.
- The gate never throws into a request path; a bad value degrades to "hidden", not an
  error page.

## Testing

Deterministic — all logic is pure or takes an injected `now`.

**`test/lib/publish-schedule.test.ts` (new)** — `resolvePublishAt`:
- Bare local time resolves DST-correctly: `09:00` in July → `+02:00`, in January →
  `+01:00`, both to the correct UTC instant.
- Explicit offset / `Z` respected (config timezone ignored).
- Invalid datetime → `null`; invalid IANA timezone → `null`; empty/undefined → `null`.

**`test/lib/content-store.test.ts` (extend)** — fixed `now` values:
- Future `publishAt`: excluded from `listPosts(now)`, `getLivePost` → `undefined`,
  `getPost` still returns it (raw).
- Past `publishAt`: in `listPosts`, `getLivePost` returns it.
- Transition: one post, two `now`s straddling `publishAt` → hidden then visible.
- Invalid `publishAt` → hidden + `console.warn` spy fires.
- Display date: scheduled post with no `date` → shows `publishAt`'s day; explicit
  `date` overrides.
- `draft: true` + past `publishAt` → still hidden.

**Schema/config:** `publishAt` accepted as optional string; `content.timezone`
parses and defaults to `"Europe/Budapest"`.

The `.astro`/RSS/asset consumers are thin wiring (swap in `listPosts(now)` /
`getLivePost`), covered by the store contract plus a local build/run check —
consistent with the repo's lib-level test approach (node env, no DOM).

## Documentation

- `config.example.yaml`: document `content.timezone`.
- `docs/blogpost-publishing.md`: a short "Scheduling a post" note on `publishAt`
  (forms, timezone, that it 404s until its time).

## Rollout / compatibility

- Purely additive: one optional config key, one optional frontmatter field, one new
  module, new store methods, and thin consumer edits. Posts without `publishAt` are
  byte-for-byte unaffected.
- No migration. Ships in the normal release → rollout (rolling restart) flow.
