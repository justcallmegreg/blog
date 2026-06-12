# Containerized Blog Engine — Design

**Date:** 2026-06-12
**Status:** Approved (pending spec review)

## Summary

A stateless, containerized blog engine built on **Astro (SSR, Node standalone adapter)**.
The container holds **no content of its own**. Content lives in a separate **git repository**
and is periodically pulled into a local cache. The engine renders markdown **live at request
time** out of that cache, so new posts go live on the next request after a sync — no rebuild,
no restart.

The aesthetic is a **RobCo / Pip-Boy terminal** look (VT323, green-on-black, optional CRT
treatment) with three client-side interactive effects: a Matrix-rain canvas on the homepage,
a character-by-character typewriter reveal of post bodies, and Web Audio click sounds.

Everything operationally relevant is driven by a single **YAML config file**. One **multi-arch
image** (`linux/amd64` + `linux/arm64`) is produced.

This repository is the **engine** (the stateless renderer). Content lives in a **separate
content repo** — a two-repo split.

## Goals

- A reusable, containerized engine you can change, customize, and deploy easily.
- Stateless container: no persistent volumes required; re-clones content on boot.
- Content sourced from a git repo; only changed files are reprocessed (via git blob hashes).
- Instant-live content (bounded by the pull interval), no rebuild step.
- Single YAML config for all behavior; secrets via environment, never in YAML.
- One image built for both arm64 and amd64.
- Simple repository layout.

## Non-goals (v1)

- Tags / categories (deliberately deferred — YAGNI).
- A build-and-swap static pipeline (rejected in favor of instant-live SSR).
- S3 / object-storage content source (rejected in favor of git).
- Admin UI, comments, search, RSS (not in scope for v1; may revisit later).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Engine | Astro, SSR via `@astrojs/node` standalone | Markdown-first; islands for interactivity; the Node adapter *is* the web server (no separate nginx). |
| Content source | Separate **git repo** | Content-addressed by design — `git pull` transfers only changed objects, satisfying "only fetch what changed" for free; version history; trivial authoring & auth. |
| Rendering | **Live at request time** from a periodically-pulled cache | Instant-live content with no rebuild/restart. Trade-off: we render markdown ourselves at runtime instead of using Astro build-time content collections. |
| Change detection | **git blob hash** diffing | Reprocess only files whose blob hash changed since last sync. |
| URL scheme | **URL mirrors path** | `2026/06/12/my-post.md` → `/2026/06/12/my-post`. Path is the single source of truth for both date and slug. |
| Date source | **Directory path** | No `date` frontmatter field needed. |
| Homepage | **Terminal directory listing** | Reverse-chron monospace listing behind the Matrix rain. Nails the RobCo aesthetic. |
| Tags | **Deferred** | Not in v1. |
| Auth | Public clone by default; **token-in-env** for private | `CONTENT_REPO_TOKEN` spliced into clone URL; never in YAML, never logged. |
| Click sound default | **ON** | With an always-available, persisted mute toggle. |

## Architecture

A single stateless Node process (no sidecars, no IPC) doing three jobs:

```
┌─────────────────────── container (stateless) ──────────────────────┐
│                                                                     │
│   ┌──────────────┐   periodic    ┌───────────────────────────┐     │
│   │ Sync worker  │── git fetch ──│  Local clone (cache)        │    │
│   │ (timer loop) │   + reset     │  /cache/<YYYY>/<MM>/<DD>/…   │    │
│   └──────┬───────┘               └───────────────────────────┘     │
│          │ reindex (diff by git blob hash)                          │
│          ▼                                                          │
│   ┌──────────────────────────────┐     reads      ┌─────────────┐  │
│   │ In-memory post index          │◀──────────────│ Astro SSR   │  │
│   │ Map<url, {meta, html, hash}>  │               │ (Node adptr)│  │
│   └──────────────────────────────┘               └──────┬──────┘  │
│                                                          │ HTTP    │
└──────────────────────────────────────────────────────────────────┘
                                                           ▼
                                                        readers
```

### Sync worker
- On boot: shallow-clone the content repo into a cache dir.
- On a configurable timer: `git fetch` + `git reset --hard origin/<branch>` (robust against
  force-pushes; stateless-friendly).
- After each sync: list files with their git blob hashes (`git ls-tree -r`), diff against the
  in-memory index, and **re-parse only the files whose blob hash changed** — added/changed
  re-render, removed get dropped from the index.

### In-memory post index
- Source of truth the server reads from: per-post metadata + pre-rendered HTML + blob hash,
  plus a date-sorted list for the homepage.
- Lives in module memory; single process means no cross-process synchronization.

### Astro SSR
- `@astrojs/node` standalone adapter — the process serves both pages and the asset route.
- Every request reads from the index; new posts appear on the next request after a sync.

## Repository structure

```
.
├── Dockerfile                  # multi-stage, multi-arch
├── docker-compose.yml          # example local run
├── config.example.yaml         # documented config template
├── astro.config.mjs            # @astrojs/node standalone, SSR
├── package.json
├── .github/workflows/build.yml # buildx → amd64 + arm64 image
├── src/
│   ├── pages/
│   │   ├── index.astro                            # terminal listing + Matrix
│   │   ├── [year]/[month]/[day]/[slug].astro      # post page (SSR)
│   │   └── [year]/[month]/[day]/assets/[...f].ts   # asset file route
│   ├── layouts/Terminal.astro
│   ├── components/{MatrixRain,Typewriter,ClickSound}.astro
│   ├── lib/
│   │   ├── config.ts         # load + zod-validate YAML
│   │   ├── content-store.ts  # in-memory index + sync worker
│   │   ├── git.ts            # clone/fetch/ls-tree wrappers
│   │   ├── markdown.ts       # unified pipeline + asset-URL rewrite
│   │   └── frontmatter.ts    # zod schema
│   └── styles/theme.css      # VT323, CRT, palette
└── docs/superpowers/specs/…
```

The static segment `assets` takes routing priority over the dynamic `[slug]`, so
`/2026/06/12/assets/x.png` matches the asset route and `/2026/06/12/my-post` matches the post
route.

## Configuration

Single YAML file; path via `CONFIG_PATH` env (default `./config.yaml`); parsed and
**zod-validated at boot** (bad config fails fast with a clear error). Secrets never live here.

```yaml
site:
  title: "RobCo Termlink"
  description: "Personal log"
  baseUrl: "https://blog.example.com"   # optional; canonical URLs / feed
content:
  repo: "https://github.com/you/blog-content.git"
  branch: "main"
  subdir: ""                # optional: content lives in a subfolder
  syncIntervalSeconds: 300
effects:
  matrixRain: true
  typewriter: true
  clickSound: true          # default ON; persisted mute toggle available to readers
server:
  port: 4321
```

- **Auth:** if `CONTENT_REPO_TOKEN` env var is present, splice it into the clone URL
  (`https://x-access-token:<token>@…`) for private repos. Absent → public clone. Token is
  **never logged** and never written to YAML.
- Customizing behavior is "edit YAML, restart."

## Content, frontmatter & assets

- **Path is truth:** `2026/06/12/my-post.md` → date `2026-06-12`, slug `my-post`, URL
  `/2026/06/12/my-post`.
- **Frontmatter (minimal, zod-validated):**
  ```yaml
  ---
  title: "My Post Title"      # required (display; falls back to slug if absent)
  description: "..."          # optional
  draft: false                # optional; drafts excluded from index + 404 on direct hit
  ---
  ```
  No `date` field — it comes from the path. Invalid frontmatter logs a warning and skips that
  file rather than crashing the whole index.
- **Assets:** `2026/06/12/assets/diagram.png`, referenced from a post as `./assets/diagram.png`
  (the `assets/` dir is a sibling of the `.md`, shared per-day). A rehype step rewrites relative
  `./assets/...` URLs to absolute `/2026/06/12/assets/...`. The asset route streams the file
  from the cache dir with **path-traversal guarding** (resolved path must stay inside that day's
  folder).

## Runtime markdown rendering

A `unified` pipeline (same family Astro uses), run once per file when its blob hash changes,
cached as HTML in the index:

`gray-matter` (frontmatter) → `remark-parse` → `remark-gfm` → `remark-rehype` →
`@shikijs/rehype` (terminal-friendly code highlighting) → asset-URL rewrite → `rehype-stringify`.

The post page injects that HTML via `set:html` inside the `Terminal` layout, wrapped by the
`Typewriter` island.

## Aesthetic & interactive islands

**Look:** VT323 font, green-on-black RobCo palette, optional CRT treatment (scanlines + subtle
flicker/vignette via CSS), defined in `theme.css` for easy retuning.

Three islands, each client-side vanilla JS, each toggleable from YAML, each built as
**progressive enhancement** (page fully readable with JS off):

- **`MatrixRain`** — `<canvas>` falling-glyph effect behind the homepage listing only.
  Viewport-sized, `requestAnimationFrame` loop, pauses when the tab is hidden.
- **`Typewriter`** — wraps the already-rendered post HTML and reveals it character-by-character
  with a blinking cursor. Walks the DOM's **text nodes** (never breaks tags/markup/code blocks);
  a click anywhere **skips to fully revealed**.
- **`ClickSound`** — short Web Audio blip on link/button activation. Gesture-bound (not autoplay).
  **Default ON**, with a persistent mute toggle in `localStorage`.

**Accessibility / UX guardrails:**
- **`prefers-reduced-motion`** → Matrix rain renders a static/dimmed frame; typewriter shows
  full text immediately (no animation).
- **No-JS / SEO** → full post HTML is in the document; the typewriter only *reveals* what's
  already there, so crawlers and no-JS readers get everything.
- **Sound** → gesture-bound only; mutable and remembered.

## Container & multi-arch build

- **Multi-stage Dockerfile:**
  - *builder* (`node:22-alpine`): `npm ci`, `astro build` → standalone server bundle.
  - *runtime* (`node:22-alpine`): `apk add git` (needed for clone/pull), copy build output +
    production deps, non-root user, `EXPOSE` the port, `CMD` starts the Node server — which
    clones content and starts the sync loop on boot.
- **Multi-arch:** `.github/workflows/build.yml` uses Docker Buildx with
  `platforms: linux/amd64,linux/arm64`, pushing a single multi-arch tag to a registry (GHCR by
  default).
- `docker-compose.yml` ships as a local-run example: mounts `config.yaml`, passes
  `CONTENT_REPO_TOKEN`, maps the port.

## Testing approach

TDD on the pure logic:
- path → date/slug/URL derivation
- frontmatter parse + zod validation (valid, invalid, missing title)
- markdown rendering + relative-asset URL rewrite
- blob-hash diffing (added / changed / removed → correct reindex)
- config load + validation (good config, bad config fails fast)
- asset route path-traversal guard

**Integration:** create a throwaway local git repo as the content source, run a real sync,
assert the index builds and that a follow-up commit reprocesses *only* the changed file.

Islands (canvas/audio) get light smoke tests + manual visual verification — not worth heavy
automation.

## Open questions / future work

- Tags/categories, RSS/Atom feed, search — possible v2.
- Optional webhook-triggered sync (push instead of poll) — possible v2.
- Image optimization for assets — deferred (terminal aesthetic de-emphasizes it).
