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

If you change `SOURCE_DIR` to something other than `blogs`, also update the `on.push.paths`
glob near the top of the workflow to match — the `on:` trigger can't read `env`, so a mismatch
makes the workflow silently never run.

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
- **Asset pruning:** the asset copy is additive — assets removed or renamed in the project repo
  are not deleted from `blog-content` on re-publish.
