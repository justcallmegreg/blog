# Dateless, Slug-Based Content Model — Design

**Status:** Approved (2026-06-15)

**Goal:** Remove date-based directories from the content model. Posts are stored in a stable
per-source, per-post folder; URLs are slug-based; the published date is derived from git history
(with a frontmatter override). This fixes the bug where a post's dated directory is chosen at
authoring time and becomes wrong when review/merge takes days or weeks.

## Problem

Today a post lives at `blogs/YYYY/MM/DD/{slug}.md`. The date is baked into the path by the author
(via the blogpost-creator skill) *before* review. If peer review takes a week, the post lands in a
directory that no longer matches when it was actually published. The date directory is also
redundant now that we can derive the real publish date from git. So: drop the date from the path,
let git own the date.

## Decisions (locked)

1. **URL scheme:** slug-only — `/{slug}`. (Existing `/YYYY/MM/DD/{slug}` URLs break; acceptable, the
   blog is new.)
2. **Storage layout:** per-source, per-post folder — `blogs/{owner}-{repo}/{slug}/index.md` with
   sibling `blogs/{owner}-{repo}/{slug}/assets/…`. The `{owner}-{repo}` namespace is stable
   (never changes with review time) and isolates repos; the per-post folder isolates assets.
3. **Published date precedence:** `frontmatter.date` (valid `YYYY-MM-DD`) → **git first-add commit
   date** → undated (empty) if neither is available — an undated post sorts last and omits its date
   line. No path date anymore.
4. **"Originally merged"** = the date of the first commit that added the file to `blog-content`.
5. **Engine reads git** (Approach A): full (non-shallow) clone so history is available.

## New content model

| Location | Path |
|---|---|
| Author's project repo | `blogs/{slug}/index.md` (+ `blogs/{slug}/assets/…`) — no date dir |
| `blog-content` repo | `blogs/{owner}-{repo}/{slug}/index.md` (+ `…/assets/…`) |
| Served URL | `/{slug}` (assets at `/{slug}/assets/…`) |

`{owner}-{repo}` is `${github.repository}` with `/`→`-` (e.g. `justcallmegreg-blog`).

## Engine changes

### Routing & paths
- `src/lib/paths.ts` — new parse of a content-root-relative path
  `{ns}/{slug}/index.md` → `{ url: '/'+slug, urlPrefix: '/'+slug, slug, contentDir: '{ns}/{slug}' }`.
  Non-`index.md` files (e.g. anything under `assets/`) return null and are ignored. Drop
  `year/month/day`.
- Replace `src/pages/[year]/[month]/[day]/[slug].astro` with **`src/pages/[slug].astro`**
  (looks up `store.getPost('/' + Astro.params.slug)`).
- Replace `src/pages/[year]/[month]/[day]/assets/[...file].ts` with
  **`src/pages/[slug]/assets/[...file].ts`**: resolve the post by slug → its `contentDir` →
  serve `{contentRoot}/{contentDir}/assets/{file}` (404 if no such post/asset). Reuses the
  existing asset content-type + read logic.

### Content store (`src/lib/content-store.ts`)
- `Post` drops `year/month/day`; adds `contentDir`; `url`/`urlPrefix` become slug-based; `date`
  becomes the resolved published date.
- During reindex, for each post compute:
  `gitDate = opts.local ? null : firstAddedDate(opts.cacheDir, repoRel)` and
  `date = pickPublishedDate(frontmatter.date, gitDate)` (see below).
- Asset lookup helper (used by the asset route): given a slug, return the post's `contentDir`.

### Dates
- `src/lib/frontmatter.ts` — add optional `date` (string; validated leniently — a malformed value
  is ignored, never fatal).
- `src/lib/post-date.ts` (new, pure, unit-tested) — `pickPublishedDate(frontmatterDate, gitDate)`:
  return `frontmatterDate` if it is a valid `YYYY-MM-DD`; else `gitDate` if non-null; else `''`
  (undated → sorts last; the post page omits the date line when empty).
- `src/lib/git.ts`:
  - `cloneRepo` + `fetchReset`: drop `--depth 1` (full clone + full fetch) so history persists.
  - `firstAddedDate(dir, repoRelPath)`: run `git log --diff-filter=A --reverse --format=%cI --
    <path>`, take the first line, return its `YYYY-MM-DD` (or `null`).

### Downstream (no change needed)
Index links, RSS, the post page, sorting, the Today/Yesterday/This-week buckets, the heatmap, and
the blog post counter all read `post.url` / `post.date`, so they follow automatically.

## Publish workflow (`.github/workflows/publish-blogpost.yml`)

- **Detect:** added/modified paths under `${SOURCE_DIR}/**` in the push; map each to its post folder
  (the `${SOURCE_DIR}/{slug}/` ancestor that contains `index.md`); dedupe → the set of changed
  posts. (This also catches asset-only edits.)
- **Publish (one PR per post):** copy the whole `${SOURCE_DIR}/{slug}/` folder to
  `${DEST_SUBDIR}/{owner}-{repo}/{slug}/` in `blog-content`; open/update a PR on branch
  `blogpost/{owner}-{repo}-{slug}`.
- `SOURCE_DIR`/`DEST_SUBDIR` stay `blogs`. Date math is gone.

## Migration of existing `blog-content`

A one-off migration (run against the local `../blog-content`, then pushed) for each existing
`blogs/YYYY/MM/DD/{slug}.md`:
1. Move it to `blogs/justcallmegreg-blog/{slug}/index.md`.
2. Move its sibling `assets/` (if any) to `blogs/justcallmegreg-blog/{slug}/assets/`.
3. **Stamp `date: "YYYY-MM-DD"` into the post's frontmatter** from the old path, so every existing
   post keeps its current displayed date via the override (no collapse to the single import-commit
   date). New posts get git dates going forward.

## Edge cases

- **Reserved-route slugs:** Astro serves static routes (`/contributions`, `/about`, `/contact`,
  `/rss.xml`, `/version`) ahead of the dynamic `[slug]`, so a post slugged like one of those would
  be shadowed. Documented; don't name a post that.
- **Dev mode** (`CONTENT_LOCAL_DIR`, no git): `gitDate` is null → `frontmatter.date` or undated.
- **Undated post** (no frontmatter date, no git date): `date=''` → sorts last; the post page and
  meta omit the date rather than show an empty value.
- **Asset-only edit:** detection maps any changed `blogs/**` path to its post folder, so the post
  re-publishes.

## Testing / verification

- Unit: `paths.ts` parse (post vs asset vs junk), `pickPublishedDate` precedence (valid/invalid
  frontmatter date, null git), `firstAddedDate` against a temp git repo (matches `git.test.ts`).
- Build + full suite green; routing smoke test for `/{slug}` and `/{slug}/assets/…`.
- Live: after migration, a post serves at `/{slug}`, shows its stamped date, and its assets load;
  a freshly published post (new merge) shows its git merge date.
