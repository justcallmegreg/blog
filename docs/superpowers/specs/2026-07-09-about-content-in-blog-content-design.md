# About content in `blog-content` — design

**Status:** approved design, ready for implementation planning
**Date:** 2026-07-09

## Summary

Move the About page's **content** — headline, bio, and the achievements/projects
list — out of the engine config and into an `about.yaml` file at the root of the
`blog-content` repo. The engine reads and validates that file through the same
clone/fetch/sync machinery it already uses for posts, so editing achievements
becomes a commit to `blog-content` that goes live within the normal content sync
interval, with **zero redeploy**.

The feature flag `about.enabled` **stays in engine config**: it gates the nav tab
and the CV-request overlay, which render synchronously per request, and keeping it
in config avoids giving the navigation an async dependency on content loading.

This makes the engine more generic — nothing that *identifies the owner* (bio,
achievements) is baked into the deployment config anymore; the engine is a renderer
and the content repo is the single source of that identity.

## Goals

- About headline, bio, and projects live in `blog-content/about.yaml`, editable
  like any post (commit → live within one sync cycle, no redeploy).
- The engine validates the file and degrades gracefully: a missing or malformed
  `about.yaml` never crashes the page.
- `about.enabled` remains a deploy-time feature flag in engine config.
- No behaviour change to the CV-request flow, the captcha, or the webhook.

## Non-goals

- Not moving any other config into content (`site.title`, social links, effects,
  webhooks, etc. stay in config). Scope is the About block only.
- No markdown/rich-text bio — the bio stays a plain string (structured YAML only).
- No new content *type* in the post index — `about.yaml` is a repo-level file, not
  a post, and never appears in the list, RSS, or as a URL.
- No change to how `about.enabled` gates the tab/overlay.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Content source | `about.yaml` at `blog-content` repo root | One structured file; edits sync live, no redeploy. Lifts today's `config.about` shape verbatim. |
| File location | Repo root, sibling of the posts subdir (`blogs/`) | Outside `contentRoot`, so the post scanner never treats it as a post. |
| Feature flag | `about.enabled` stays in engine config | Used synchronously by the layout (nav tab, CV overlay); config avoids an async nav dependency. |
| Loading | `ContentStore.getAbout()`, parsed on `start()`/`sync()` | Reuses the existing clone/fetch/local-mode lifecycle; refreshes with the same cadence as posts. |
| Missing/invalid file | Return `null`, log once, render graceful empty state | Content is external and user-edited; a bad file must never crash `/about`. |
| Config schema | Remove `headline`/`bio`/`projects`; keep `enabled` | Content leaves config; the on/off switch is behaviour, not identity. |

## Data model

`about.yaml` at the content repo root:

```yaml
# blog-content/about.yaml
headline: "Greg — software engineer"
bio: "Short background summary — who I am, what I work on."
projects:
  - start: 2021
    end: 2023
    description: "Confidential project — what it was (no client name)."
    responsibilities: "What I owned / led."   # optional
    deliveries: "What I shipped / achieved."  # optional
```

Validation schema (new `AboutSchema`, mirrors today's `config.about` minus
`enabled`):

- `headline`: string, default `''`
- `bio`: string, default `''`
- `projects`: array (default `[]`) of:
  - `start`: int (required)
  - `end`: int (required)
  - `description`: string (required)
  - `responsibilities`: string, default `''`
  - `deliveries`: string, default `''`

An empty or absent `projects` list is valid (the page renders "> no entries
listed."). A file that fails schema validation is treated as **absent** (`null`),
with a single warning logged — never a thrown error.

## Components and flow

**`src/lib/about.ts`** (new): `AboutSchema` + `AboutData` type + a
`parseAbout(raw: string): AboutData` that validates and throws on invalid input.
Small and independently testable; owns the schema only, no I/O.

**`src/lib/content-store.ts`**: 
- New private field caching the parsed `AboutData | null`.
- New public `getAbout(): AboutData | null`.
- On `start()` and at the end of each successful `sync()`, read
  `<cacheDir>/about.yaml` (repo root — **not** `contentRoot()`, which includes the
  posts subdir). If the file is absent → cache `null`. If present, parse via
  `parseAbout`; on parse failure, cache `null` and log one warning. This runs in
  both git mode and local mode (`CONTENT_LOCAL_DIR`), reading from the same base
  dir the posts are read from.

**`src/pages/about.astro`**:
- Unchanged 404 guard: `if (!cfg.about.enabled) return 404`.
- Replace `cfg.about.*` reads with `store.getAbout()`:
  - `const about = store.getAbout()` → may be `null`.
  - `headline = about?.headline ?? ''`, `bio = about?.bio ?? ''`.
  - `projects = [...(about?.projects ?? [])].sort((a, b) => b.end - a.end || b.start - a.start)`.
- Markup unchanged: empty headline/bio simply render nothing; empty projects
  renders the existing "> no entries listed." line.

**`src/lib/config.ts`**: the `about` schema keeps `enabled` (default `true`) and
**drops** `headline`, `bio`, `projects`.

## Migration

- `config.example.yaml`: trim the `about:` block to `enabled: true` plus a comment
  pointing at `blog-content/about.yaml`; remove the sample `headline`/`bio`/
  `projects`.
- README: document `about.yaml`, its location, and a sample.
- The live ignition `values.yaml` carries no `about` block today, so it already
  relies on the schema default (`enabled: true`, previously empty projects) — this
  change does not alter the deployed config. Populating the About page is a matter
  of adding `about.yaml` to `blog-content`.
- No engine deploy is required to *edit* About content after this ships.

## Error handling

- **Missing `about.yaml`**: `getAbout()` → `null`; `/about` renders the empty
  state; logged once at info level (not an error — the common state for a fresh
  content repo).
- **Malformed YAML / schema violation**: caught during parse; `getAbout()` →
  `null`; a single `console.warn` names the file and the validation issue; the
  page still renders the empty state. Never throws, never 500s.
- **Content not yet cloned** (initial clone failing): same as missing — `null`,
  empty state; the next successful sync populates it.

## Testing

- `src/lib/about.ts`: valid YAML → parsed with defaults applied; missing optional
  fields default correctly; invalid (missing `start`/`end`/`description`, wrong
  types) → throws.
- `content-store`: `about.yaml` present → `getAbout()` returns parsed data;
  absent → `null`; malformed → `null` with no throw; value refreshes after a
  `sync()` that changes the file; local mode (`CONTENT_LOCAL_DIR`) reads it the
  same way.
- `config`: the `about` config schema no longer exposes `projects`/`bio`/
  `headline`; `enabled` still defaults to `true`.
- Existing About-page / CV-request tests continue to pass unchanged (the flag and
  overlay behaviour are untouched).
