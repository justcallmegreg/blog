# Blogpost Publishing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A portable GitHub Actions workflow that, on merge of a blogpost to `main` in a project repo, opens a PR in the central `blog-content` repo with the post renamed `{owner}-{repo}-{slug}.md` plus its assets — and runs live in this engine repo.

**Architecture:** A single self-contained workflow (`publish-blogpost.yml`) with a `detect` job (diff the push for added/modified `blogs/**/*.md`) feeding a matrixed `publish` job (one PR per post, via `peter-evans/create-pull-request` checked out against the content repo with a fine-grained PAT). The engine is flipped to read `content.subdir: "blogs"`. A setup doc explains adoption.

**Tech Stack:** GitHub Actions (YAML + bash), `peter-evans/create-pull-request@v6`, `jq`, fine-grained PAT secret `CONTENT_PR_TOKEN`. Engine config is YAML consumed by the existing `src/lib/config.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `.github/workflows/publish-blogpost.yml` (create) | The live workflow; also the copy-paste template (editable `env:` block at top). |
| `docs/blogpost-publishing.md` (create) | Adoption guide: PAT scopes/secret, env values, `content.subdir`, skill tie-in, caveats. |
| `config.yaml` (modify) | Flip `content.subdir` to `"blogs"` so the engine serves the migrated content. |
| `config.example.yaml` (modify) | Same flip + comment documenting the convention. |
| `README.md` (modify) | Content-layout section reflects the `blogs/` prefix. |
| `blogs/2026/06/15/hello-pipeline.md` (create, Task 5 only) | Throwaway sample post for the end-to-end dry run; deleted after. |

> **Note on testing:** This deliverable is GitHub Actions YAML + bash, which (like the repo's existing `release.yml`/`version.yml`) is not unit-testable. The approved spec chose an inline, single-file workflow over an extracted tested script for portability. Verification is therefore: YAML parses, then a `workflow_dispatch` `dry_run` prints correct destination paths, then a real end-to-end run. Tasks use **verify-by-command** rather than red-green TDD.

---

## Task 1: Flip the engine to read `content.subdir: "blogs"`

**Files:**
- Modify: `config.yaml:7`
- Modify: `config.example.yaml:8`
- Modify: `README.md:55-62`

- [ ] **Step 1: Point the live config at the `blogs/` subdir**

In `config.yaml`, change the `subdir` line under `content:` from:

```yaml
  subdir: ""
```
to:
```yaml
  subdir: "blogs"
```

- [ ] **Step 2: Update the example config + comment**

In `config.example.yaml`, change:

```yaml
  subdir: ""                # optional: content lives in a subfolder of the repo
```
to:
```yaml
  subdir: "blogs"           # posts live under blogs/ — the publish workflow places them there
```

- [ ] **Step 3: Update the README content-layout section**

In `README.md`, replace the block currently at lines 55-62:

````markdown
```
2026/06/12/my-post.md
2026/06/12/assets/diagram.png   # referenced from the post as ./assets/diagram.png
```

The date and slug come from the **path**, not frontmatter: `2026/06/12/my-post.md` is served
at `/2026/06/12/my-post`. Relative asset links (`./assets/...`) are rewritten to absolute URLs
automatically.
````

with:

````markdown
```
blogs/2026/06/12/my-post.md
blogs/2026/06/12/assets/diagram.png   # referenced from the post as ./assets/diagram.png
```

Posts live under `blogs/` (set `content.subdir: "blogs"`), which is stripped when deriving the
route. The date and slug come from the **path**, not frontmatter: `blogs/2026/06/12/my-post.md`
is served at `/2026/06/12/my-post`. Relative asset links (`./assets/...`) are rewritten to
absolute URLs automatically. Posts are published into `blogs/` automatically by the
[blogpost publishing workflow](docs/blogpost-publishing.md).
````

- [ ] **Step 4: Verify the build + full suite still pass**

Run: `npm run build && npx vitest run 2>&1 | grep -E "Tests +[0-9]|FAIL"`
Expected: build `Complete!`, `Tests  118 passed (118)` (no failures).

- [ ] **Step 5: Verify the engine actually serves the migrated content from `blogs/`**

Run:
```bash
CONTENT_LOCAL_DIR=../blog-content CONFIG_PATH=./config.yaml HOST=127.0.0.1 PORT=4399 node ./dist/server/entry.mjs &
SRV=$!; sleep 3
curl -fsS -o /dev/null -w "index: %{http_code}\n" http://127.0.0.1:4399/
curl -fsS -o /dev/null -w "post:  %{http_code}\n" http://127.0.0.1:4399/2026/06/12/todays-dispatch
kill $SRV 2>/dev/null
```
Expected: `index: 200` and `post: 200` (the engine finds `blogs/2026/06/12/todays-dispatch.md` and serves it at the subdir-stripped route).

- [ ] **Step 6: Commit**

```bash
git add config.yaml config.example.yaml README.md
git commit -m "feat(content): read posts from the blogs/ subdir"
```

---

## Task 2: Create the `publish-blogpost.yml` workflow

**Files:**
- Create: `.github/workflows/publish-blogpost.yml`

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/publish-blogpost.yml` with exactly this content:

```yaml
name: publish-blogpost

on:
  push:
    branches: [main]
    paths: ['blogs/**']
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Print what would be published without opening PRs'
        type: boolean
        default: false

# Only the project repo is read with GITHUB_TOKEN; the content repo is written
# with CONTENT_PR_TOKEN (a fine-grained PAT), so no write perms are needed here.
permissions:
  contents: read

# ---- EDIT THESE when copying this workflow into another project repo ----
env:
  CONTENT_REPO: justcallmegreg/blog-content   # destination repo (owner/name)
  CONTENT_BRANCH: main                         # base branch for the PR
  SOURCE_DIR: blogs                            # where posts live in THIS repo
  DEST_SUBDIR: blogs                           # where posts go in the content repo
# -------------------------------------------------------------------------

jobs:
  # 1) Find the posts added/modified by this push and emit them as a JSON array.
  detect:
    runs-on: ubuntu-latest
    outputs:
      posts: ${{ steps.changed.outputs.posts }}
      count: ${{ steps.changed.outputs.count }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Collect added/modified posts
        id: changed
        env:
          EVENT: ${{ github.event_name }}
          BEFORE: ${{ github.event.before }}
          AFTER: ${{ github.sha }}
        run: |
          set -euo pipefail
          ZERO=0000000000000000000000000000000000000000
          # On manual dispatch (or a first/forced push with a zero "before"), fall
          # back to every post currently under SOURCE_DIR; otherwise diff the push.
          if [ "$EVENT" = "workflow_dispatch" ] || [ -z "${BEFORE:-}" ] || [ "$BEFORE" = "$ZERO" ]; then
            mapfile -t files < <(find "$SOURCE_DIR" -type f -name '*.md' 2>/dev/null | sort)
          else
            mapfile -t files < <(git diff --name-only --diff-filter=AM "$BEFORE" "$AFTER" -- "$SOURCE_DIR" | sort -u)
          fi
          # Keep markdown posts, drop anything under an assets/ folder.
          posts=()
          for f in "${files[@]:-}"; do
            case "$f" in
              *.md)
                case "$f" in */assets/*) ;; *) posts+=("$f") ;; esac
                ;;
            esac
          done
          if [ "${#posts[@]}" -eq 0 ]; then
            json='[]'
          else
            json=$(printf '%s\n' "${posts[@]}" | jq -R . | jq -cs .)
          fi
          count=$(printf '%s' "$json" | jq 'length')
          echo "posts=$json" >> "$GITHUB_OUTPUT"
          echo "count=$count" >> "$GITHUB_OUTPUT"
          echo "found $count post(s): $json"

  # 2) One PR per post in the content repo (re-merges update the same branch/PR).
  publish:
    needs: detect
    if: needs.detect.outputs.count != '0'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        post: ${{ fromJSON(needs.detect.outputs.posts) }}
    steps:
      - name: Checkout project repo (source post + assets)
        uses: actions/checkout@v4

      - name: Checkout content repo
        uses: actions/checkout@v4
        with:
          repository: ${{ env.CONTENT_REPO }}
          ref: ${{ env.CONTENT_BRANCH }}
          token: ${{ secrets.CONTENT_PR_TOKEN }}
          path: .content-repo
          fetch-depth: 0

      - name: Compute destination + copy files
        id: prep
        env:
          POST: ${{ matrix.post }}
        run: |
          set -euo pipefail
          rel="${POST#"$SOURCE_DIR"/}"          # YYYY/MM/DD/slug.md
          dir="$(dirname "$rel")"               # YYYY/MM/DD
          base="$(basename "$rel" .md)"         # slug
          prefix="${GITHUB_REPOSITORY//\//-}-"  # owner-repo-
          destrel="$DEST_SUBDIR/$dir/$prefix$base.md"
          dest=".content-repo/$destrel"
          mkdir -p "$(dirname "$dest")"
          cp "$POST" "$dest"
          # Copy the sibling assets/ folder if the post has one.
          srcassets="$SOURCE_DIR/$dir/assets"
          if [ -d "$srcassets" ]; then
            mkdir -p ".content-repo/$DEST_SUBDIR/$dir/assets"
            cp -R "$srcassets/." ".content-repo/$DEST_SUBDIR/$dir/assets/"
          fi
          {
            echo "slug=$base"
            echo "destrel=$destrel"
            echo "branch=blogpost/$prefix$base"
          } >> "$GITHUB_OUTPUT"
          echo "publish $POST -> $destrel (branch blogpost/$prefix$base)"

      - name: Dry-run summary (open no PR)
        if: ${{ inputs.dry_run }}
        run: |
          echo "DRY RUN — would open a PR:"
          echo "  branch: ${{ steps.prep.outputs.branch }}"
          echo "  dest:   ${{ steps.prep.outputs.destrel }}"
          echo "  title:  Publish: ${{ steps.prep.outputs.slug }} (from ${{ github.repository }})"

      - name: Create/update PR in content repo
        if: ${{ !inputs.dry_run }}
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.CONTENT_PR_TOKEN }}
          path: .content-repo
          branch: ${{ steps.prep.outputs.branch }}
          base: ${{ env.CONTENT_BRANCH }}
          add-paths: ${{ env.DEST_SUBDIR }}
          commit-message: "blog: publish ${{ steps.prep.outputs.slug }} from ${{ github.repository }}"
          title: "Publish: ${{ steps.prep.outputs.slug }} (from ${{ github.repository }})"
          delete-branch: true
          body: |
            Automated blogpost publication from [`${{ github.repository }}`](${{ github.server_url }}/${{ github.repository }}).

            - Source: `${{ matrix.post }}`
            - Destination: `${{ steps.prep.outputs.destrel }}`
            - Origin commit: ${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}
```

- [ ] **Step 2: Verify the YAML parses**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/publish-blogpost.yml','utf8')); console.log('publish-blogpost.yml OK')"`
Expected: `publish-blogpost.yml OK`

- [ ] **Step 3: Lint with actionlint if available (optional but preferred)**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/publish-blogpost.yml && echo "actionlint clean" || echo "actionlint not installed — skipping"`
Expected: `actionlint clean` (or the skip message). If actionlint reports errors, fix them.

- [ ] **Step 4: Verify the bash path-derivation logic in isolation**

This proves the rename rule without running CI. Run:
```bash
SOURCE_DIR=blogs DEST_SUBDIR=blogs GITHUB_REPOSITORY=justcallmegreg/blog \
POST=blogs/2026/06/15/my-post.md bash -c '
  rel="${POST#"$SOURCE_DIR"/}"; dir="$(dirname "$rel")"; base="$(basename "$rel" .md)"
  prefix="${GITHUB_REPOSITORY//\//-}-"
  echo "$DEST_SUBDIR/$dir/$prefix$base.md"
  echo "branch blogpost/$prefix$base"
'
```
Expected:
```
blogs/2026/06/15/justcallmegreg-blog-my-post.md
branch blogpost/justcallmegreg-blog-my-post
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish-blogpost.yml
git commit -m "feat(ci): publish-blogpost workflow (PR posts into blog-content)"
```

---

## Task 3: Write the adoption guide

**Files:**
- Create: `docs/blogpost-publishing.md`

- [ ] **Step 1: Write the doc**

Create `docs/blogpost-publishing.md` with exactly this content:

````markdown
# Publishing blogposts to `blog-content`

The blog engine serves content from a central **`blog-content`** repo. You write posts inside a
*project* repo (e.g. with the `blogpost-creator` Claude skill, which can use that project's
source, README, and notes), and the `publish-blogpost` workflow opens a PR in `blog-content`
when the post lands on `main`.

```
project repo: blogs/2026/06/15/my-post.md   ──merge to main──▶  PR in blog-content:
                                                                  blogs/2026/06/15/{owner}-{repo}-my-post.md
```

The filename is prefixed with `{owner}-{repo}-` so posts from different repos never collide.

## One-time setup

### 1. Create a fine-grained PAT

GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**:

- **Resource owner:** the owner of `blog-content`.
- **Repository access:** *Only select repositories* → `blog-content`.
- **Permissions:** **Contents: Read and write** and **Pull requests: Read and write**.

Copy the token.

### 2. Add it as a secret in the project repo

In the **project** repo (the one holding `blogs/`): **Settings → Secrets and variables →
Actions → New repository secret**:

- **Name:** `CONTENT_PR_TOKEN`
- **Value:** the token from step 1.

(For many repos, add it once as an **organization** secret instead.)

### 3. Copy the workflow and edit the `env:` block

Copy [`.github/workflows/publish-blogpost.yml`](../.github/workflows/publish-blogpost.yml) into
your project repo and edit only the marked `env:` block:

```yaml
env:
  CONTENT_REPO: your-org/blog-content   # destination repo
  CONTENT_BRANCH: main
  SOURCE_DIR: blogs                     # where posts live in this repo
  DEST_SUBDIR: blogs                    # where posts go in the content repo
```

### 4. Make sure the engine reads `blogs/`

In the engine's `config.yaml`, set `content.subdir: "blogs"` so it serves posts published under
`blogs/` in `blog-content`.

## How it works

- **Trigger:** a push to `main` that touches `blogs/**` (i.e. a merged post).
- **Detect:** the workflow diffs the push for **added or modified** `blogs/**/*.md` files.
- **Publish:** one PR per post. The post is copied to
  `blogs/YYYY/MM/DD/{owner}-{repo}-{slug}.md` and its sibling `assets/` folder is copied
  alongside. The PR uses a deterministic branch (`blogpost/{owner}-{repo}-{slug}`), so editing a
  post and re-merging **updates the same PR** instead of opening a duplicate.
- **Review:** a human reviews and merges the `blog-content` PR; the engine then syncs and serves
  the post.

## Testing it safely

Run the workflow manually with **Run workflow → dry_run: true** (Actions tab). It prints the
destination path, branch, and PR title for every current post **without opening any PR**.

## Notes & limits

- **Deletions** of posts in the project repo are **not** propagated to `blog-content`.
- **Drafts** (`draft: true` frontmatter) are still published — the `blog-content` PR is the
  review gate, and the engine hides drafts from its index regardless.
- The **display title** comes from the post's frontmatter `title:`; only the slug/URL carries
  the `owner-repo` prefix, so give every post a `title:`.
- **Asset collisions:** asset filenames are not namespaced, so two repos publishing on the same
  day with an identically-named asset would collide. Unlikely; keep asset names specific.
````

- [ ] **Step 2: Verify the doc links resolve**

Run: `test -f .github/workflows/publish-blogpost.yml && grep -q "content.subdir" docs/blogpost-publishing.md && echo "links + refs OK"`
Expected: `links + refs OK`

- [ ] **Step 3: Commit**

```bash
git add docs/blogpost-publishing.md
git commit -m "docs: blogpost publishing setup guide"
```

---

## Task 4: Provision the secret + dry-run on the live repo

> This task needs the running repo and a real PAT, so it is done with the user during execution. It validates the workflow end-to-end without side effects.

**Files:** none (GitHub settings + manual workflow run).

- [ ] **Step 1: Confirm the `CONTENT_PR_TOKEN` secret exists**

Run: `gh secret list --repo justcallmegreg/blog | grep -q CONTENT_PR_TOKEN && echo "secret present" || echo "MISSING — user must add CONTENT_PR_TOKEN (see docs/blogpost-publishing.md)"`
Expected: `secret present`. If missing, the user creates the fine-grained PAT and adds the secret per the doc, then re-run this step.

- [ ] **Step 2: Ensure the workflow is on `main`**

The `workflow_dispatch` trigger is only available once `publish-blogpost.yml` is on the default branch. Confirm Tasks 1-3 have been merged to `main` (via the project's normal PR flow) before dispatching.

Run: `gh workflow list --repo justcallmegreg/blog | grep -q publish-blogpost && echo "workflow registered" || echo "not on main yet"`
Expected: `workflow registered`.

- [ ] **Step 3: Trigger a dry run and inspect the output**

Run:
```bash
gh workflow run publish-blogpost.yml --repo justcallmegreg/blog -f dry_run=true
sleep 8
rid=$(gh run list --repo justcallmegreg/blog --workflow=publish-blogpost.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$rid" --repo justcallmegreg/blog --exit-status || true
gh run view "$rid" --repo justcallmegreg/blog --log | grep -E "found [0-9]+ post|DRY RUN|dest:|branch:" | head -40
```
Expected: the log lists the current posts and, for each, a `DRY RUN` block showing
`dest: blogs/YYYY/MM/DD/justcallmegreg-blog-<slug>.md` and `branch: blogpost/justcallmegreg-blog-<slug>` — and **no PR is opened** in `blog-content`.

- [ ] **Step 4: Confirm no PR was created by the dry run**

Run: `gh pr list --repo justcallmegreg/blog-content --search "in:title Publish:" --json number --jq 'length'`
Expected: `0` (dry run opens nothing).

---

## Task 5: End-to-end live publish (real PR)

> Final acceptance: prove a merged post produces a real PR in `blog-content`, then clean up.

**Files:**
- Create (temporary): `blogs/2026/06/15/hello-pipeline.md`

- [ ] **Step 1: Add a sample post on a branch**

```bash
mkdir -p blogs/2026/06/15
cat > blogs/2026/06/15/hello-pipeline.md <<'EOF'
---
title: "Hello, Pipeline"
description: "First post published via the blogpost publishing workflow."
---

This post was written in the engine repo and published to `blog-content` automatically.
EOF
git checkout -b test/publish-pipeline
git add blogs/2026/06/15/hello-pipeline.md
git commit -m "test: sample post to exercise the publish workflow"
git push -u origin test/publish-pipeline
```

- [ ] **Step 2: Open + merge the PR to `main`**

```bash
gh pr create --repo justcallmegreg/blog --base main --head test/publish-pipeline \
  --title "test: publish pipeline sample post" \
  --body "Exercises publish-blogpost end to end."
# wait for the required version-and-build check, then:
gh pr merge --repo justcallmegreg/blog --squash
```

- [ ] **Step 3: Confirm the publish workflow ran and opened a PR in `blog-content`**

```bash
sleep 10
rid=$(gh run list --repo justcallmegreg/blog --workflow=publish-blogpost.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$rid" --repo justcallmegreg/blog --exit-status
gh pr list --repo justcallmegreg/blog-content --search "in:title Publish: hello-pipeline" \
  --json number,title,headRefName --jq '.[]'
```
Expected: a PR titled `Publish: hello-pipeline (from justcallmegreg/blog)` on branch
`blogpost/justcallmegreg-blog-hello-pipeline`, adding
`blogs/2026/06/15/justcallmegreg-blog-hello-pipeline.md`.

- [ ] **Step 4: Verify the published file path in that PR**

```bash
prnum=$(gh pr list --repo justcallmegreg/blog-content --search "in:title Publish: hello-pipeline" --json number --jq '.[0].number')
gh pr diff "$prnum" --repo justcallmegreg/blog-content --name-only
```
Expected: `blogs/2026/06/15/justcallmegreg-blog-hello-pipeline.md`.

- [ ] **Step 5: Clean up the sample on both sides**

```bash
# Close the content-repo PR + delete its branch (sample, not a real post).
gh pr close "$prnum" --repo justcallmegreg/blog-content --delete-branch
# Remove the sample post from the engine repo on a new branch + merge.
git checkout main && git pull origin main
git checkout -b chore/remove-pipeline-sample
git rm blogs/2026/06/15/hello-pipeline.md
# remove now-empty dirs if present
rmdir -p blogs/2026/06/15 2>/dev/null || true
git commit -m "chore: remove publish-pipeline sample post"
git push -u origin chore/remove-pipeline-sample
gh pr create --repo justcallmegreg/blog --base main --head chore/remove-pipeline-sample \
  --title "chore: remove pipeline sample" --body "Cleanup after e2e verification." --label patch
# merge after checks pass
```
Expected: sample removed from `main`; the content-repo PR closed and its branch deleted.

> The deletion does **not** propagate (deletions are intentionally ignored), so removing the
> sample post from the engine repo will not touch `blog-content` — exactly the documented
> behavior.

---

## Self-review notes

- **Spec coverage:** auth/PAT (Tasks 3-4), destination path + rename (Task 2 step 1/4), assets copy (Task 2 step 1), one-PR-per-post matrix + deterministic branch (Task 2), engine `subdir` change + README + example (Task 1), setup doc with caveats (Task 3), dry-run + e2e verification (Tasks 4-5). All spec sections map to a task.
- **Deletions/drafts/collisions** behaviors are documented in Task 3 and re-asserted in Task 5 step 5.
- **Naming consistency:** `CONTENT_PR_TOKEN`, `CONTENT_REPO`, `SOURCE_DIR`, `DEST_SUBDIR`, branch `blogpost/{owner}-{repo}-{slug}`, dest `blogs/YYYY/MM/DD/{owner}-{repo}-{slug}.md` are used identically across the workflow, doc, and verification commands.
