# Blog Engine

[![Release](https://img.shields.io/github/v/release/justcallmegreg/blog?sort=semver&label=release)](https://github.com/justcallmegreg/blog/releases)
[![Release pipeline](https://github.com/justcallmegreg/blog/actions/workflows/release.yml/badge.svg)](https://github.com/justcallmegreg/blog/actions/workflows/release.yml)

A stateless, containerized **Astro SSR** blog engine with a RobCo/Pip-Boy terminal aesthetic.
Content lives in a **separate git repo** organized as `blogs/YYYY/MM/DD/<slug>.md` (with a sibling
`assets/` dir per day). The engine periodically `git pull`s that repo and renders markdown
**live** — no rebuild, no restart. New posts go live on the next request after a sync.

One multi-arch image (amd64 + arm64), configured by a single `config.yaml` plus a few
environment variables for secrets. No database; the only state is an ephemeral clone of the
content repo and an in-memory render index.

## Features

**Content**
- Live content from a separate git repo — periodic `git fetch` + re-index of only the files
  whose git blob hash changed; posts render to HTML once and are held in memory.
- Markdown with syntax-highlighted code, relative `./assets/...` links rewritten to absolute URLs.
- Path-derived routing: `blogs/2026/06/12/my-post.md` → `/2026/06/12/my-post`. Drafts hidden + 404.
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
- **About me** (`/about`) — a config-driven bio + unnamed (confidential) project list, with a
  **Request CV** flow: GDPR consent → slide-puzzle captcha → JSON to a webhook → "received".
- **Contact** — an in-page terminal overlay: dial-in sound, per-field block cursor, a
  typewriter transmission preview, then a JSON POST to a webhook.
- **Newsletter** — a tab + modal to subscribe/unsubscribe to a weekly post-summary digest
  (config-driven blurb: `summaryDays`, `timezone`, `schedule`); slide-puzzle captcha, a typed
  "transferring message sequence" status, and a JSON POST routed to the subscribe/unsubscribe
  webhooks. The Subscribe button carries a localized CRT effect.

**Privacy & integrity**
- A **GDPR consent gate** on first visit (choice stored in a cookie) + a configurable
  data-erasure contact email.
- A server-validated **slide-puzzle captcha** (no Python dependency) guarding the forms.
- Optional, consent-gated, **self-hosted Matomo** analytics (page views + time-on-page).

## Content repo layout

```
blogs/2026/06/12/my-post.md
blogs/2026/06/12/assets/diagram.png   # referenced from the post as ./assets/diagram.png
```

Posts live under `blogs/` (set `content.subdir: "blogs"`), which is stripped when deriving the
route. The date and slug come from the **path**, not frontmatter: `blogs/2026/06/12/my-post.md`
is served at `/2026/06/12/my-post`. Relative asset links (`./assets/...`) are rewritten to
absolute URLs automatically. Posts are placed into `blogs/` by the
[blogpost publishing workflow](docs/blogpost-publishing.md).

Frontmatter (all optional):

```yaml
---
title: "My Post Title"   # display title (falls back to the slug)
description: "..."       # used for the <meta description>
draft: false             # drafts are hidden from the index and 404 on direct hit
---
```

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
  enabled: true                  # show the About me tab + page
  headline: "Greg — software engineer"
  bio: "Short background summary — who I am, what I work on."
  projects:                      # unnamed for confidentiality; newest-first
    - start: 2021
      end: 2023
      description: "Confidential project — what it was (no client name)."
      responsibilities: "What I owned / led."
      deliveries: "What I shipped / achieved."

privacy:
  email: "you@example.com"       # GDPR data-erasure contact (consent gate + CV form); empty hides it
  consentBanner: true            # first-visit "accept data processing" gate (choice stored in a cookie)

analytics:
  enabled: false                 # self-hosted Matomo; loads ONLY after a visitor accepts the gate
  matomoUrl: "https://analytics.example.com"   # Matomo base URL (no trailing /matomo.php)
  siteId: 1                      # the Matomo site id for this blog
```

## Environment variables

Secrets and runtime settings live in the environment, never in `config.yaml`:

| Variable | Purpose |
|---|---|
| `CONFIG_PATH` | Path to `config.yaml` (default `./config.yaml`; the Docker image mounts `/config/config.yaml`). |
| `PORT` / `HOST` | Server bind address (read by the `@astrojs/node` server; default port `4321`). |
| `CONTENT_REPO_TOKEN` | Read-only token for a **private** content repo; spliced into the clone URL. |
| `CONTENT_LOCAL_DIR` | Dev mode: serve a local content folder directly instead of cloning (see below). |
| `CACHE_DIR` | Where the content repo is cloned + the Contributions cache is stored (ephemeral; defaults to a temp dir). |
| `GITHUB_TOKEN` | Optional: raises GitHub API rate limits for the Contributions tab. |
| `CONTACT_WEBHOOK_URL` | Where the Contact form POSTs its JSON. Unset → logged server-side ("stage mode"). |
| `CV_WEBHOOK_URL` | Where Request-CV POSTs its JSON. Unset → logged server-side. |
| `NEWSLETTER_SUBSCRIBE_WEBHOOK_URL` | Where a newsletter **subscribe** POSTs its JSON. Unset → stage-logged. |
| `NEWSLETTER_UNSUBSCRIBE_WEBHOOK_URL` | Where a newsletter **unsubscribe** POSTs its JSON. Unset → stage-logged. |

Both webhook payloads are plain JSON, so you can wire them to Zapier, a mailer, or your own
endpoint — the engine itself sends no email and stores no submissions.

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

The terminal effects (Matrix rain, typewriter, click sounds, CRT glitch, Vault Boy) are
client-side islands gated by `config.yaml` and built as progressive enhancement. The
Contributions tab calls the GitHub REST API at request time (cached briefly). The Contact and
Request-CV flows validate server-side, gate on the slide-puzzle captcha, and forward JSON to
their webhooks — keeping the engine stateless. Consent-gated Matomo analytics, when enabled,
loads entirely in the browser.

The image's build provenance is served at **`GET /version`**
(`{"version":"X.Y.Z","commit":"<sha>","builtAt":"<iso>"}`) — version from `VERSION.txt`, commit
and timestamp injected at build time. Versioning/publishing is automated — see
[docs/ci-versioning.md](docs/ci-versioning.md).
