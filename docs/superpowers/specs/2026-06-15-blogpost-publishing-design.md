# Blogpost Publishing Workflow — Design

**Status:** Approved (2026-06-15)

**Goal:** A reusable GitHub Actions workflow that lives in a project repo and, when a
blogpost is merged to `main`, opens a pull request in the central `blog-content` repo with
the post (renamed to avoid collisions) and its assets. Ships as a copy-paste template and
runs live in this engine repo.

## Problem & context

Authors write blogposts inside a *project* repo using the `blogpost-creator` Claude skill,
which can draw on that project's source, docs, README, and notes. The skill saves a post to
`blogs/YYYY/MM/DD/{slug}.md` (with an optional sibling `blogs/YYYY/MM/DD/assets/`). Posts are
reviewed and merged in the project repo like any other change.

The blog engine, however, serves content from a **separate** `blog-content` repo. We want the
hand-off from "merged in the project repo" to "PR opened in `blog-content`" to be automatic,
so authoring stays in the project repo and `blog-content` remains the single source the engine
syncs from.

## Data flow

```
project repo (e.g. justcallmegreg/blog)
  └─ blogs/2026/06/15/my-post.md          ← skill writes it; PR'd & merged to main
        │  push to main (paths: blogs/**)
        ▼
  .github/workflows/publish-blogpost.yml
        │  detect added/modified blogs/**/*.md in this push
        ▼  one PR per post, authenticated with a fine-grained PAT
blog-content repo
  └─ blogs/2026/06/15/justcallmegreg-blog-my-post.md   ← renamed (owner-repo prefix)
  └─ blogs/2026/06/15/assets/...                        ← sibling assets copied alongside
        │  human reviews & merges
        ▼
  engine syncs blog-content (content.subdir = "blogs") and serves the post
```

## Decisions (locked)

1. **Auth:** fine-grained PAT scoped to `blog-content` only, with **Contents: write** +
   **Pull requests: write**, stored as the secret `CONTENT_PR_TOKEN` in each project repo.
2. **Destination path:** `blogs/YYYY/MM/DD/{owner}-{repo}-{slug}.md` — date path preserved,
   `blogs/` prefix kept, owner+repo prefixed onto the **filename only**.
3. **Assets:** for each published post, copy its sibling `blogs/YYYY/MM/DD/assets/` dir into
   the same destination day folder, filenames unchanged.
4. **Batching:** **one PR per post**, on a deterministic branch so re-merges update the same PR.
5. **Engine convention change:** content now lives under `blogs/` in `blog-content`, so the
   engine reads `content.subdir: "blogs"`. The `blog-content` repo has already been migrated.

## Components

### A. The workflow — `.github/workflows/publish-blogpost.yml`

Self-contained (no dependency on engine scripts) so it is portable as a template. Configurable
via a clearly-marked `env:` block at the top — the only lines a copying user edits:

```yaml
env:
  CONTENT_REPO:   justcallmegreg/blog-content   # destination repo (owner/name)
  CONTENT_BRANCH: main                           # base branch for the PR
  SOURCE_DIR:     blogs                          # where posts live in THIS repo
  DEST_SUBDIR:    blogs                           # where posts go in the content repo
```

**Triggers:**
- `push` to `main`, filtered to `paths: ['blogs/**']`.
- `workflow_dispatch` with a `dry_run` boolean input (prints computed destination paths and PR
  titles, opens no PRs) for safe testing.

**Jobs:**

1. **detect** — `runs-on: ubuntu-latest`. Checks out the project repo (`fetch-depth: 0`).
   Computes the set of **added or modified** `${SOURCE_DIR}/**/*.md` files in the triggering
   push (`git diff --name-status <before>..<after>`, or against the first parent when `before`
   is the zero-SHA). Emits a JSON array of post paths as an output. If empty, downstream jobs
   are skipped.

2. **publish** — `needs: detect`, runs only if the post list is non-empty, as a matrix over the
   posts (`strategy.matrix.post: ${{ fromJSON(needs.detect.outputs.posts) }}`,
   `fail-fast: false`). For each post:
   - Check out the **project repo** (default token) to read the source post + assets.
   - Check out **`CONTENT_REPO`** into a separate path using `CONTENT_PR_TOKEN`.
   - Derive `slug` (basename without `.md`), `prefix` (`${owner}-${repo}-`, i.e.
     `${github.repository}` with `/` → `-`), `relDate` (the `YYYY/MM/DD` between `SOURCE_DIR`
     and the file), and `destPath = ${DEST_SUBDIR}/${relDate}/${prefix}${slug}.md`.
   - Copy the post to `destPath`; if `${SOURCE_DIR}/${relDate}/assets/` exists, copy it to
     `${DEST_SUBDIR}/${relDate}/assets/`.
   - Open/update a PR with `peter-evans/create-pull-request@v6`: `token: CONTENT_PR_TOKEN`,
     `path:` the content checkout, `branch: blogpost/${prefix}${slug}` (deterministic →
     idempotent), `base: CONTENT_BRANCH`, title `Publish: ${slug} (from ${owner}/${repo})`,
     body linking back to the source commit/PR.
   - On `dry_run`, log the derived `destPath` / branch / title and stop before the PR step.

The path-derivation is done inline in a shell step (kept simple; portability beats a shared
script here).

### B. Setup guide — `docs/blogpost-publishing.md`

- How to create the fine-grained PAT, exact scopes (`Contents: write`, `Pull requests: write`)
  on `blog-content` only, and add it as the `CONTENT_PR_TOKEN` secret.
- Which `env:` values to edit when copying the template.
- The `content.subdir: "blogs"` engine convention and the `blogs/YYYY/MM/DD/{slug}.md` layout.
- How it ties into the `blogpost-creator` skill (skill writes under `blogs/`, you PR/merge,
  automation publishes).
- The asset same-day/same-name collision caveat and the deletions-are-ignored behavior.

### C. Engine convention change

- `config.yaml` (this repo): `content.subdir: "blogs"`.
- `config.example.yaml`: `content.subdir: "blogs"` with a comment explaining the publishing
  convention.
- `README.md`: content-repo layout section shows `blogs/2026/06/12/my-post.md` and the
  `./assets/` sibling under the dated folder.
- Code default for `subdir` stays `""` (non-breaking for other engine users).
- `blog-content` migration: already done (content moved under `blogs/`).

## Edge cases & behavior

- **No posts changed** in the push → workflow is a no-op (matrix is empty).
- **Edited post re-merged** → same deterministic branch → the existing PR updates rather than a
  duplicate being opened.
- **Deletions** of posts in the source repo are **not** propagated (documented; YAGNI for v1).
- **Drafts** (`draft: true` frontmatter) are still published — the `blog-content` PR is the
  human review gate.
- **Asset name collisions** across different repos on the same day are possible (filenames are
  not namespaced); unlikely, documented, future hardening.
- **Display title** comes from the post's frontmatter `title:`; only the slug/URL carries the
  `owner-repo` prefix.

## Testing / verification

- `js-yaml` parses `publish-blogpost.yml`.
- `workflow_dispatch` with `dry_run: true` prints correct `destPath` / branch / title for the
  current posts under `blogs/`, opening no PRs.
- End-to-end dry run: add a sample post under `blogs/` in this repo, merge to `main`, and
  confirm a PR appears in `blog-content` at `blogs/.../justcallmegreg-blog-*.md` with assets.
