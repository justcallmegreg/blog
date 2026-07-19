# Transmissions Plane B — Overseer CRUD — design

Date: 2026-07-19
Status: approved (brainstorming)

## Summary

Manage transmissions from the **overseer** (the private admin console): create,
edit, hide/unhide, and delete. Git (`blog-content`) stays the source of truth —
every action commits to it via the **GitHub API**; the overseer then forces a
content re-sync so the change shows immediately. The heavy HLS bytes never touch
the overseer pod: a **local tool (Plane C)** transcodes and uploads them to R2,
and the overseer only handles the small poster, the entry metadata, and the git
commit. On delete, the overseer also removes the R2 objects.

Builds on Plane A (`docs/superpowers/specs/2026-07-19-transmissions-vlog-design.md`),
which shipped the read surface (`transmissions` content type, `/transmissions`
routes, config). Plane B is the write surface.

## Decisions (from brainstorming)

- **Upload path:** the local Plane C tool transcodes AND uploads the HLS bundle
  to `R2 transmissions/{slug}/`. The overseer never receives the bundle — only
  metadata + the small poster. The Pi cluster never transcodes or streams video
  bytes.
- **Source of truth:** git (`blog-content`). The overseer **commits directly to
  `main`** via the GitHub API (no PR), consistent with it being the trusted admin
  surface.
- **List source:** the overseer reads the current transmissions from its **own
  `ContentStore`** (same engine image, already cloning `blog-content`), including
  hidden/draft entries. After each write it calls `store.sync()` so the console
  reflects the change without waiting for the poll.
- **Commit mechanism:** the **Git Data API** (ref → base tree → blobs → new tree
  → commit → update ref) for atomic multi-file add/remove.
- **R2:** `@aws-sdk/client-s3` (new dep) against the R2 S3-compatible endpoint.
  The overseer uses it for **delete only**; R2 write creds live locally (Plane C).
- **Auth:** unchanged — network-privacy-only (private ingress) + the existing
  confirm-token on destructive actions. No new auth code. The overseer MUST stay
  on the private ingress; it now holds a `blog-content`-write GitHub token and R2
  delete creds as env secrets that the public engine never receives.

## Architecture

The overseer is the same image as the public engine, so it already runs a
`ContentStore`. Plane B uses both directions:

- **Read** the management list from `ContentStore` (`getTransmission` /
  a new raw lister that includes drafts).
- **Write** by committing to `blog-content` main via the GitHub API, then
  `store.sync()` to refresh the local index immediately.

### Create flow

Precondition (done locally via Plane C): HLS bundle already at
`R2 transmissions/{slug}/master.m3u8` (+ renditions/segments); a `poster.jpg`
and auto-detected `duration` in hand.

1. Overseer **New transmission** form (multipart): `title`, `description`,
   `date`, `slug`, `duration`, `poster` file, and `video` (defaults to
   `{slug}/master.m3u8`).
2. Handler validates: slug matches `^[a-z0-9][a-z0-9-]*$`; `title` and `video`
   present; `poster` present and an accepted image type; `date` is `YYYY-MM-DD`
   or empty.
3. Compose `index.md` frontmatter and read the poster bytes.
4. `commitFiles` — one atomic commit adding
   `transmissions/justcallmegreg-blog/{slug}/index.md` and
   `transmissions/justcallmegreg-blog/{slug}/assets/poster.jpg`.
5. `store.sync()`; redirect to the list with a success flash.

### Manage flows

- **Edit:** form pre-filled from `store.getTransmission(url)`; submit rewrites
  the frontmatter and commits. Poster replacement optional.
- **Hide / Unhide:** toggles `draft` in the frontmatter and commits (a dedicated
  button; no full form).
- **Delete:** confirm-token gated. **Git-first ordering:** commit the removal of
  `transmissions/justcallmegreg-blog/{slug}/` (the entry vanishes from the site),
  **then** best-effort `deletePrefix("transmissions/{slug}/")` in R2. A failed R2
  delete leaves an invisible orphaned bundle (cheap, GC-able) rather than a live
  entry pointing at missing media.

## Components

### Routes

- `src/pages/overseer/transmissions/index.astro` — management list: every
  transmission incl. hidden, each with Edit / Hide / Delete; plus a New form.
  Adds a `{ id: 'transmissions', label: 'Transmissions', href: '/overseer/transmissions' }`
  entry to the `tabs` array in `src/layouts/Overseer.astro`.
- `src/pages/overseer/transmissions/[slug].astro` — the edit form for one entry.
- `src/pages/overseer/transmissions/api/create.ts` — POST, multipart.
- `src/pages/overseer/transmissions/api/update.ts` — POST (edit + hide/unhide).
- `src/pages/overseer/transmissions/api/delete.ts` — POST, confirm-token.

All API routes are thin: parse input → call a pure handler with injected deps →
return JSON, mirroring `src/pages/overseer/api/delete.ts`.

### Libraries

- `src/lib/overseer/github.ts`
  - `githubConfig(): GitHubConfig` — `{ owner, repo, branch, token }`. `owner`/
    `repo` are parsed from the existing `cfg.content.repo` URL and `branch` from
    `cfg.content.branch`; only `token` is from env (`CONTENT_REPO_TOKEN`, which
    already exists and must carry **contents:write**). No new repo-location env
    vars.
  - `interface GitHubLike { request(...) }` — injectable for tests.
  - `commitFiles(cfg, { message, put: {path, bytes}[], remove: string[] }, gh?): Promise<{ commitSha: string }>`
    via the Git Data API (get ref → base commit+tree → create blobs for `put` →
    build a new tree adding `put` and omitting `remove` → create commit → update
    ref). One network round of calls, one resulting commit.
- `src/lib/overseer/r2.ts`
  - `r2ConfigFromEnv(): R2Config` — `{ endpoint, bucket, accessKeyId, secretAccessKey }`
    (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
  - `interface S3Like { send(cmd): Promise<any> }` — injectable.
  - `deletePrefix(cfg, prefix, s3?): Promise<{ deleted: number }>` — `ListObjectsV2`
    under `prefix` then `DeleteObjects` (batched ≤1000).
- `src/lib/overseer/transmissions.ts` — pure logic, no I/O:
  - `composeTransmissionMarkdown(fields): string` — frontmatter → `index.md`.
  - `transmissionEntryPaths(slug): { dir, indexMd, posterAsset }` — the
    `transmissions/justcallmegreg-blog/{slug}/…` layout.
  - `validateCreateInput(input): { ok: true, fields } | { ok: false, error }`.
  - `deletePlan(slug): { gitDir, r2Prefix }`.

### ContentStore addition

- `listAllTransmissions(): Transmission[]` — like `listTransmissions` but
  **without** the `isLive` filter, so the console shows hidden/scheduled entries.
  (One-line addition next to `listTransmissions`.)

## Error handling

- GitHub or R2 failure returns a clear, specific error to the form; the create
  commit is atomic (single commit) so there is no half-written entry.
- Delete uses the git-first ordering above; a failed R2 delete is logged and
  reported but does not resurrect the entry. Orphaned R2 objects can be
  re-deleted later (a future GC, out of scope).
- `store.sync()` after a write is best-effort: if it fails, the change is still
  committed and will appear on the next poll — the console shows a "committed;
  refresh pending" note rather than an error.

## Testing

- `composeTransmissionMarkdown`, `transmissionEntryPaths`, `validateCreateInput`,
  `deletePlan` — pure unit tests (valid/invalid slugs, missing fields, frontmatter
  shape incl. `draft`/`publishAt`, path layout).
- `commitFiles` — with an injected `GitHubLike` fake: asserts the Git Data API
  call sequence and that `put`/`remove` produce the right tree (add paths present,
  removed paths absent).
- `deletePrefix` — with an injected `S3Like` fake: lists then deletes, batches,
  reports count; empty prefix is a no-op.
- Handlers (`create`/`update`/`delete`) — with injected deps, mirroring the SES
  `delete.ts` handler test: success path, validation failure, confirm-token
  required on delete, and delete ordering (git commit before R2 delete; R2
  failure still reports the git success).
- `listAllTransmissions` — content-store fixture: includes a draft entry that
  `listTransmissions` excludes.

## Security & deployment

- The overseer stays on the private ingress (hard rule). It gains env secrets:
  `CONTENT_REPO_TOKEN` with **contents:write** on `blog-content`, and the four
  `R2_*` delete creds. The public engine deployment does NOT get the R2 creds and
  needs only read (clone) scope on the content token.
- No change to the public engine's behavior or trust surface.

## Decomposition & build order

- **Plane B (this spec)** is independently buildable and testable: unit tests use
  injected GitHub/R2 fakes; end-to-end can run against a manually-placed R2 bundle
  (or the hls.js test stream) without Plane C.
- **Plane C** (local transcode + R2 upload tool) remains a small separate spec,
  built afterward. B depends only on the shared R2 key convention
  (`transmissions/{slug}/master.m3u8`), not on C's code.

## Out of scope

- Plane C (the local transcode/upload tool).
- Any in-pod transcoding, R2 upload from the overseer, or presigned browser
  uploads.
- A shared-secret/login auth layer (explicitly deferred; network privacy is the
  boundary).
- Orphaned-R2 garbage collection beyond the best-effort delete.
