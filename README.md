# Blog Engine

A stateless, containerized Astro SSR blog engine with a RobCo/Pip-Boy terminal aesthetic.
Content lives in a **separate git repo** organized as `YYYY/MM/DD/<slug>.md` (with a sibling
`assets/` dir per day). The engine periodically `git pull`s that repo and renders markdown
live — no rebuild, no restart. New posts go live on the next request after a sync.

## Content repo layout

```
2026/06/12/my-post.md
2026/06/12/assets/diagram.png   # referenced from the post as ./assets/diagram.png
```

The date and slug come from the **path**, not frontmatter: `2026/06/12/my-post.md` is served
at `/2026/06/12/my-post`. Relative asset links (`./assets/...`) are rewritten to absolute URLs
automatically.

Frontmatter (all optional):

```yaml
---
title: "My Post Title"   # display title (falls back to the slug)
description: "..."       # used for the <meta description>
draft: false             # drafts are hidden from the index and 404 on direct hit
---
```

## Configure

Copy `config.example.yaml` to `config.yaml` and edit it:

```yaml
site:
  title: "RobCo Termlink"
  description: "Personal log"
content:
  repo: "https://github.com/you/blog-content.git"
  branch: "main"
  subdir: ""                # optional: content in a subfolder of the repo
  syncIntervalSeconds: 300
effects:
  matrixRain: true
  typewriter: true
  clickSound: true
```

For a **private** content repo, pass a read-only token via the `CONTENT_REPO_TOKEN`
environment variable — never put it in the YAML. The engine splices it into the clone URL.

The HTTP **port** is controlled by the `PORT` environment variable (and the published port by
the Docker/compose `ports:` mapping), not by `config.yaml`.

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

## Develop

```bash
npm install
npm run dev      # local Astro dev server
npm test         # Vitest
npm run build    # production build → dist/server/entry.mjs
```

## How it works

A single Node process runs the Astro `@astrojs/node` standalone server. A background worker
shallow-clones the content repo, then on a timer runs `git fetch` + `git reset --hard` and
re-indexes only the files whose git blob hash changed. Posts are rendered to HTML once and held
in an in-memory index that SSR routes read from. The interactive effects (Matrix rain,
typewriter, click sounds) are client-side islands gated by the config and built as progressive
enhancement (the site is fully readable with JavaScript disabled, and `prefers-reduced-motion`
is respected).
