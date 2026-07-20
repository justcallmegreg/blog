# Blog Engine

[![Release](https://img.shields.io/github/v/release/justcallmegreg/blog?sort=semver&label=release)](https://github.com/justcallmegreg/blog/releases)
[![Release pipeline](https://github.com/justcallmegreg/blog/actions/workflows/release.yml/badge.svg)](https://github.com/justcallmegreg/blog/actions/workflows/release.yml)

A stateless, containerized **Astro SSR** blog engine with a RobCo/Pip-Boy terminal aesthetic.
Content lives in a **separate git repo** organized as `blogs/{owner}-{repo}/{slug}/index.md` (with a
sibling `assets/` dir per post). The engine periodically `git pull`s that repo and renders markdown
**live** — no rebuild, no restart. New posts go live on the next request after a sync.

One multi-arch image (amd64 + arm64), configured by a single `config.yaml` plus a few
environment variables for secrets. No database; the only state is an ephemeral clone of the
content repo and an in-memory render index.

## Features

**Content**
- Live content from a separate git repo — periodic `git fetch` + re-index of only the files
  whose git blob hash changed; posts render to HTML once and are held in memory.
- Markdown with syntax-highlighted code, relative `./assets/...` links rewritten to absolute URLs.
- Path-derived routing: a post's URL is its slug, `/my-post`. Drafts hidden + 404.
- **RSS feed** at `/rss.xml`.

**Terminal UI**
- Timed **Matrix rain** on the index, periodic **CRT beam-roll** glitch, **typewriter** boot
  title, **click sounds** with a persisted mute toggle, a decorative **Vault Boy** GIF, and a
  pale profile-picture avatar / favicon.
- Pip-Boy **tab bar** — Blogs · Contributions · About me · Contact — plus top-right social
  links (LinkedIn · GitHub · RSS).
- Fully readable with JavaScript disabled; `prefers-reduced-motion` is respected.

**Pages**
- **Blogs** (`/`) — posts grouped Today / Yesterday / This week / This month & earlier, each
  with a teaser; **fuzzy search** with a Fallout-style block cursor + typing sounds; a
  posting-activity **heatmap**.
- **Contributions** (`/contributions`) — a GitHub activity **heatmap** (commits *and* PRs, last
  five weeks), owned repositories, and a recent pull-request timeline.
- **About me** (`/about`) — a bio + unnamed (confidential) project list sourced from
  `about.yaml` in the content repo (edit without redeploying), with a
  **Request CV** flow: GDPR consent → slide-puzzle captcha → JSON to a webhook → "received".
- **Contact** — an in-page terminal overlay: dial-in sound, per-field block cursor, a
  typewriter transmission preview, then a JSON POST to a webhook.
- **Newsletter** — a tab + modal to subscribe/unsubscribe to a weekly post-summary digest
  (config-driven blurb: `summaryDays`, `timezone`, `schedule`); slide-puzzle captcha, a typed
  "transferring message sequence" status, and a JSON POST routed to the subscribe/unsubscribe
  webhooks. The Subscribe button carries a localized CRT effect.
- **Transmissions** (`/transmissions`) — a video vlog; entries list newest-first with a poster
  thumbnail, each opening a player page that streams the video (progressive mp4, served from R2).

**Privacy & integrity**
- A **GDPR consent gate** on first visit (choice stored in a cookie) + a configurable
  data-erasure contact email.
- A server-validated **slide-puzzle captcha** (no Python dependency) guarding the forms.
- Optional, consent-gated, **self-hosted Matomo** analytics (page views + time-on-page).

## Content repo layout

```
blogs/{owner}-{repo}/my-post/index.md
blogs/{owner}-{repo}/my-post/assets/diagram.png   # referenced from the post as ./assets/diagram.png
```

Posts live in a per-source, per-post folder (`content.subdir: "blogs"`). The URL is the **slug**:
`blogs/justcallmegreg-blog/my-post/index.md` is served at `/my-post`. Relative asset links
(`./assets/...`) resolve under `/my-post/assets/...`. The **published date is derived from git** —
the first commit that added the post to the content repo — and can be overridden with a `date:`
field in frontmatter. Posts are placed into `blogs/{owner}-{repo}/` automatically by the
[blogpost publishing workflow](docs/blogpost-publishing.md).

Frontmatter (all optional):

```yaml
---
title: "My Post Title"   # display title (falls back to the slug)
description: "..."       # used for the <meta description>
date: "2026-06-12"       # optional: overrides the git-derived published date
draft: false             # drafts are hidden from the index and 404 on direct hit
---
```

## Publish posts from a project repo (GitHub Action template)

You don't have to commit posts to the content repo by hand. A reusable GitHub Action —
[`.github/workflows/publish-blogpost.yml`](.github/workflows/publish-blogpost.yml) — watches a
**project** repo where you author a post as `blogs/{slug}/index.md` (plus its
`blogs/{slug}/assets/`), and when it's merged to `main` it opens a pull request in your
`blog-content` repo that copies the whole post folder to `blogs/{owner}-{repo}/{slug}/` (the
`{owner}-{repo}` prefix keeps posts from different repos from colliding). The post is served at its
slug, `/{slug}`, and its published date comes from git — the first commit that added it to
`blog-content` — overridable with a `date:` frontmatter field. So you can draft a post inside any
project's own repo (for example with a Claude *blogpost-creator* skill that draws on that project's
source, README, and notes), merge it there, and just review the auto-opened PR in `blog-content`.

The workflow is **self-contained**, so it doubles as a copy-paste template. To adopt it in your
own repo:

1. **Copy** `.github/workflows/publish-blogpost.yml` into your project repo (under
   `.github/workflows/`).
2. **Edit the `env:` block** at the top — set `CONTENT_REPO` to your `owner/blog-content`,
   plus `CONTENT_BRANCH` and `SOURCE_DIR` / `DEST_SUBDIR` (both default to `blogs`). If you change
   `SOURCE_DIR`, update the `on.push.paths` glob to match (the trigger can't read `env`).
3. **Add a `CONTENT_PR_TOKEN` secret** to the project repo — a fine-grained PAT scoped to
   `blog-content` with **Contents: write** + **Pull requests: write**.
4. **Point the engine at `blogs/`** — set `content.subdir: "blogs"` so it serves the published posts.

Test it safely first with **Actions → Run workflow → `dry_run: true`**, which prints the
destination path, branch, and PR title for each post **without opening any PR**. The full
walkthrough — PAT scopes, one-PR-per-post behavior, and caveats (deletions not propagated, drafts
still published, slug collisions) — is in **[docs/blogpost-publishing.md](docs/blogpost-publishing.md)**.

## Configure

Copy `config.example.yaml` to `config.yaml` and edit it. Every block has sensible defaults; the
only required field is `content.repo`.

```yaml
site:
  title: "RobCo Termlink"
  description: "Personal log"
  # baseUrl: "https://blog.example.com"   # optional, used for absolute links/RSS

content:
  repo: "https://github.com/you/blog-content.git"
  branch: "main"
  subdir: "blogs"           # posts live under blogs/ — the publish workflow places them there
  syncIntervalSeconds: 300

effects:                    # terminal eye-candy — all optional, all default on (except as noted)
  matrixRain: true
  matrixRainDurationSeconds: 7    # matrix runs this long on the index, then fades
  typewriter: true               # type the brand title out on first load
  clickSound: true               # UI blips; readers get a persisted mute toggle
  crtGlitch: true                # periodic CRT beam-roll sweep
  crtGlitchIntervalSeconds: 15
  vaultBoy: true                 # decorative Vault Boy GIF, bottom-right
  vaultBoyLoops: 3               # GIF loops N times then freezes (0 = infinite)
  vaultDoorIntro: true           # vault-door opening animation, first visit only (cookie-gated)
  vaultDoorNumber: 94            # number painted on the vault door

github:
  username: "justcallmegreg"     # GitHub user summarized on the Contributions tab

contact:
  enabled: true                  # show the Contact tab + overlay
  captcha: true                  # require the slide-puzzle captcha (needs images in public/puzzles/)

social:                          # top-bar links (handles only; empty string hides a link)
  github: "justcallmegreg"
  linkedin: "justcallmegreg"
  medium: ""                     # e.g. "@justcallmegreg"

about:
  enabled: true                  # show the About me tab + page (content lives in about.yaml)

privacy:
  email: "you@example.com"       # GDPR data-erasure contact (consent gate + CV form); empty hides it
  consentBanner: true            # first-visit "accept data processing" gate (choice stored in a cookie)

analytics:
  enabled: false                 # self-hosted Matomo; loads ONLY after a visitor accepts the gate
  matomoUrl: "https://analytics.example.com"   # Matomo base URL (no trailing /matomo.php)
  siteId: 1                      # the Matomo site id for this blog
```

The About page's content lives in the **content repo** at `about.yaml` (repo
root, alongside the posts folder), so it syncs live like posts — no redeploy:

```yaml
# blog-content/about.yaml
headline: "Greg — software engineer"
bio: "Short background summary — who I am, what I work on."
projects:                        # unnamed for confidentiality; newest-first
  - start: 2021
    end: 2023
    description: "Confidential project — what it was (no client name)."
    responsibilities: "What I owned / led."
    deliveries: "What I shipped / achieved."
```

## Environment variables

Secrets and runtime settings live in the environment, never in `config.yaml`:

| Variable | Purpose |
|---|---|
| `CONFIG_PATH` | Path to `config.yaml` (default `./config.yaml`; the Docker image mounts `/config/config.yaml`). |
| `PORT` / `HOST` | Server bind address (read by the `@astrojs/node` server; default port `4321`). |
| `CONTENT_REPO_TOKEN` | Read-only token for a **private** content repo; spliced into the clone URL. (The **overseer** needs a `contents:write` token instead — see [Overseer](#overseer-admin).) |
| `CONTENT_LOCAL_DIR` | Dev mode: serve a local content folder directly instead of cloning (see below). |
| `CACHE_DIR` | Where the content repo is cloned + the Contributions cache is stored (ephemeral; defaults to a temp dir). |
| `GITHUB_TOKEN` | Optional: raises GitHub API rate limits for the Contributions tab. |
| `MAILER_URL` | Base URL of the internal [mailer](mailer/) service (e.g. `http://mailer.app-mailer.svc:8080`). Contact, CV, and newsletter flows build email content and POST it to `/send` (+ `/subscribe`/`/unsubscribe`). Unset → "stage mode" (logged server-side, nothing sent). |
| `OWNER_EMAIL` | Recipient for owner notifications (contact/CV/newsletter events). Falls back to `privacy.email`. |

The engine builds the email content and hands it to the mailer, which sends via AWS SES;
the engine itself holds no SES credentials and stores no submissions. With `MAILER_URL`
unset it stays in stage-mode, so local dev sends nothing.

The Contributions tab caches the GitHub data on local disk under `CACHE_DIR/contributions/`
(stale-while-revalidate; tunable via `github.cache.enabled` / `github.cache.ttlSeconds`), so the
tab opens fast and survives restarts — each instance keeps its own cache.

## Analytics & privacy

On the first visit a **GDPR consent gate** asks the visitor to accept data processing; the
choice is stored in the first-party `gregco-consent` cookie (~180 days) so it isn't asked
again. Toggle it with `privacy.consentBanner`. The `privacy.email` address is shown in the gate
and in the Request-CV form as the contact for data-erasure ("right to be forgotten") requests.

Optional **self-hosted [Matomo](https://matomo.org/)** analytics records which pages visitors
open and **how long they spend on each** (Matomo's heartbeat timer). It is privacy-respecting by
design:

- **Disabled by default** — nothing loads until you set the `analytics` block.
- **Consent-gated** — the tracking snippet loads **only after** a visitor clicks **ACCEPT**;
  decliners are never tracked. (So analytics requires `privacy.consentBanner: true` — the
  consent cookie is what unlocks it.)
- **Stateless engine** — the browser talks directly to your Matomo; the blog stores and proxies
  nothing. Matomo runs as a separate container + database on your own host.

Full setup is in **[docs/analytics-matomo.md](docs/analytics-matomo.md)** (with a
`docker-compose.matomo.example.yml` to copy).

## Run with Docker

```bash
docker compose up --build
```

This mounts your `config.yaml` and serves on http://localhost:4321.

Or pull the published multi-arch image (built by CI for amd64 + arm64) and run it with your
config mounted:

```bash
docker run -p 4321:4321 \
  -v "$PWD/config.yaml:/config/config.yaml:ro" \
  -e CONTENT_REPO_TOKEN=... \
  ghcr.io/<owner>/<repo>:main
```

The container is stateless — it clones the content repo into an ephemeral cache on start and
re-syncs on a timer. No volumes are required for content.

> **Note:** `content.repo` must be reachable *from inside the container*. A remote URL
> (`https://github.com/you/blog-content.git`) works. A host `file://` path does **not** — the
> container can't see your host filesystem. To serve a local folder, use dev mode below.

## Overseer (admin)

An internal admin console, served from the **same image** as the blog engine but deployed
separately on its own ingress host. **There's no auth yet — the private ingress is the only
boundary, so it must never be exposed publicly.** The route guard 404s the whole `/overseer`
path (pages *and* APIs) whenever `OVERSEER_ENABLED` is off, so the public engine never serves it.

Tabs:

- **Subscribers** — a newsletter-signup heatmap and a subscriber table with an APPROVE-guarded
  delete (you must type `APPROVE` to confirm — enforced server-side, not just in the UI).
- **Transmissions** — manage the video vlog: create, edit, hide/unhide, and delete entries. Each
  action commits to the `blog-content` repo via the GitHub API (create/edit also commit the small
  poster; delete also removes the video's media from R2). The video files themselves are transcoded
  and uploaded to R2 out-of-band (locally), so the overseer pod only handles metadata + the poster +
  the git commit — it never touches video bytes.

### Setup

1. **Enable it** in the Helm chart: `overseer.enabled: true` (sets `OVERSEER_ENABLED=true`) with its
   own private `overseer.ingress` host. Keep it off the public internet.
2. **Give the overseer these secrets** (via `overseer.existingSecret` / `overseer.env`) — the public
   `blog-engine` deployment must **not** have them:

   | Variable | Purpose |
   |---|---|
   | `CONTENT_REPO_TOKEN` | GitHub PAT with **`contents:write`** on `blog-content` — the overseer commits transmission entries. (The public engine only needs a **read-scoped** token for cloning.) |
   | `R2_ENDPOINT` | Cloudflare R2 S3-API endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com`. |
   | `R2_BUCKET` | R2 bucket holding the transmission media. |
   | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API-token credentials with **`PutObject` (upload) and `DeleteObject` scope** — the overseer uploads video via presigned URLs and deletes media when transmission entries are removed. |
   | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SES credentials for the Subscribers tab (you can reuse the mailer's Secret, e.g. `mailer-secrets`, for now). |

   **R2 bucket CORS:** The bucket must allow `PUT` requests from the overseer's origin, otherwise browser uploads are blocked. Add this CORS rule:

   ```json
   [{ "AllowedOrigins": ["https://overseer.<your-domain>"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type"],
      "MaxAgeSeconds": 3600 }]
   ```

   **Never put the `R2_*` credentials on the public `blog-engine` deployment**, and keep its
   `CONTENT_REPO_TOKEN` read-only — only the overseer needs write + R2 access. The public engine
   serves R2 objects for playback via `transmissions.mediaBaseUrl`.
3. **Point the public engine at your media**: set `transmissions.mediaBaseUrl` in `config.yaml` to
   your R2 public domain. See the Transmissions notes in
   [docs/blogpost-publishing.md](docs/blogpost-publishing.md).

> **Known limitation:** the overseer's edit/hide forms don't carry a transmission's `publishAt`
> schedule or a custom `poster:` filename — editing or hiding such an entry reverts those to their
> defaults. Schedule a transmission (or set a non-default poster) with a direct git edit instead.

## Deploy with Helm

A Helm chart lives in [`helm/blog-engine`](helm/blog-engine/) — a stateless blog Deployment
(HA-ready, `/version` probes, config via ConfigMap, secrets via Secret) with an optional
self-hosted Matomo + MariaDB subchart (`--set matomo.enabled=true`). See its
[README](helm/blog-engine/README.md), including the captcha/affinity note for multi-replica setups.

## Dev mode (serve a local content folder)

To preview your local content repo in the container **without pushing or committing**, mount
the folder and set `CONTENT_LOCAL_DIR`. In this mode the engine reads the directory directly
(no git clone/fetch) and detects changes by file mtime+size, so edits appear on the next sync.

```bash
# uses ../blog-content by default; override with CONTENT_DIR=/abs/path
docker compose -f docker-compose.dev.yml up --build
```

Open http://localhost:4321, edit a markdown file in your content folder, and it shows up within
`syncIntervalSeconds` — no restart, no commit. (Set a low `syncIntervalSeconds` in `config.yaml`
for snappier dev feedback.)

The same toggle works without Docker:

```bash
npm run build && CONTENT_LOCAL_DIR=../blog-content CONFIG_PATH=./config.yaml npm start
```

## Develop

Requires Node ≥ 20.3.

```bash
npm install
npm run dev      # local Astro dev server
npm test         # Vitest
npm run build    # production build → dist/server/entry.mjs
```

## How it works

A single Node process runs the Astro `@astrojs/node` standalone server. A background worker
shallow-clones the content repo, then on a timer runs `git fetch` + `git reset --hard` and
re-indexes only the files whose git blob hash changed; posts are rendered to HTML once and held
in an in-memory index that SSR routes read from.

The terminal effects (Matrix rain, typewriter, click sounds, CRT glitch, Vault Boy, first-visit
vault-door intro) are client-side islands gated by `config.yaml` and built as progressive
enhancement. The
Contributions tab calls the GitHub REST API at request time (cached briefly). The Contact and
Request-CV flows validate server-side, gate on the slide-puzzle captcha, and forward JSON to
their webhooks — keeping the engine stateless. Consent-gated Matomo analytics, when enabled,
loads entirely in the browser.

The image's build provenance is served at **`GET /version`**
(`{"version":"X.Y.Z","commit":"<sha>","builtAt":"<iso>"}`) — version from `VERSION.txt`, commit
and timestamp injected at build time. Versioning/publishing is automated — see
[docs/ci-versioning.md](docs/ci-versioning.md).
