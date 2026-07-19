# Publishing blogposts to `blog-content`

The blog engine serves content from a central **`blog-content`** repo. You write posts inside a
*project* repo (e.g. with the `blogpost-creator` Claude skill, which can use that project's
source, README, and notes), and the `publish-blogpost` workflow opens a PR in `blog-content`
when the post lands on `main`.

```
project repo: blogs/my-post/index.md   ──merge to main──▶  PR in blog-content:
              blogs/my-post/assets/...                      blogs/{owner}-{repo}/my-post/index.md
                                                            blogs/{owner}-{repo}/my-post/assets/...
```

The post folder is published under a `blogs/{owner}-{repo}/` prefix so posts from different repos
never collide. The post is served at its **slug** (`/my-post`), and its published **date comes from
git** — the day its PR was merged into `blog-content` (the first mainline commit containing the
file). A `date:` frontmatter field is only a fallback for environments without git history (e.g.
local dev).

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
- **Publish:** one PR per post. The whole post folder is copied to
  `blogs/{owner}-{repo}/{slug}/index.md`, with its sibling `assets/` folder copied alongside under
  `blogs/{owner}-{repo}/{slug}/assets/`. The PR uses a deterministic branch
  (`blogpost/{owner}-{repo}-{slug}`), so editing a post and re-merging **updates the same PR**
  instead of opening a duplicate.
- **Review:** a human reviews and merges the `blog-content` PR; the engine then syncs and serves
  the post at `/{slug}`. Its published date is the day the `blog-content` PR was merged; a `date:`
  frontmatter field is only a fallback when git history is unavailable.

## Testing it safely

Run the workflow manually with **Run workflow → dry_run: true** (Actions tab). It prints the
destination path, branch, and PR title for every current post **without opening any PR**.

## Notes & limits

- **Deletions** of posts in the project repo are **not** propagated to `blog-content`.
- **Drafts** (`draft: true` frontmatter) are still published — the `blog-content` PR is the
  review gate, and the engine hides drafts from its index regardless.
- The **display title** comes from the post's frontmatter `title:` (falling back to the slug), so
  give every post a `title:`. The `owner-repo` prefix lives only in the content-repo folder path,
  not in the URL — the post is served at its bare slug, `/{slug}`.
- **Slug collisions:** the `blogs/{owner}-{repo}/` prefix namespaces each source repo, so two
  repos can publish the same slug without colliding. Within one repo, keep slugs unique.
- **Asset pruning:** the asset copy is additive — assets removed or renamed in the project repo
  are not deleted from `blog-content` on re-publish.

## Scheduling a post

Add a quoted `publishAt` to a post's frontmatter to hold it until a future moment:

```yaml
---
title: "My scheduled post"
publishAt: "2026-08-01T09:00"     # 09:00 in content.timezone (default Europe/Budapest)
---
```

- Until `publishAt` passes, the post is absent from the site — the blog list, the
  RSS feed, and its own URL (and its assets) all return 404. It appears
  automatically on the next request after its time (no redeploy or sync needed).
- Bare times are read in `content.timezone`; include an explicit offset (e.g.
  `"2026-08-01T09:00+02:00"` or `"...Z"`) to override. **Quote the value** — an
  unquoted datetime is rejected.
- `publishAt` is independent of `date`: `date` still sets the *displayed* date;
  if you omit it, a scheduled post is dated by `publishAt`'s day.
- A malformed `publishAt` keeps the post hidden and logs a `[content]` warning.

> Note: content merged into `blog-content` is public on GitHub immediately — this
> hides the post *on the site*, it does not keep the file secret.

## Presentation decks

The engine also serves presentation decks (Fallout Pip-Boy presenter) from the
content repo. A deck is one Markdown file in the deck dialect — frontmatter +
slides separated by `---`, five layouts via `<!-- slide: … -->` directives; see
`docs/superpowers/specs/2026-07-09-deck-dialect-and-presenter-design.md`.

- Location in `blog-content`: `decks/{owner}-{repo}/{slug}/index.md`
  (assets in `assets/` next to it) — served at `/decks/{slug}`.
- Publishing is automated: `publish-deck.yml` (the decks twin of
  `publish-blogpost.yml`) watches `decks/**` on `main` and opens one PR per
  deck in `blog-content` under `decks/{owner}-{repo}/{slug}/`. Its PR branches
  are prefixed `deck/` so a deck and a post sharing a slug never collide. Same
  `CONTENT_PR_TOKEN` secret, same `workflow_dispatch` + `dry_run` switch.
- `draft: true` and `publishAt` behave exactly as for posts: hidden from the
  route (404) until live.

## Transmissions (vlog)

The engine also serves video vlogs (Transmissions) from the content repo. A
transmission is a Markdown entry with frontmatter and an associated HLS video file.

- **Location in `blog-content`:** `transmissions/{owner}-{repo}/{slug}/index.md`
  (with a sibling `assets/poster.jpg` for the thumbnail) — served at `/transmissions/{slug}`,
  with a list view at `/transmissions`.
- **Frontmatter** (required field: `video`; optional: `title`, `date`, `description`, `duration`, `poster`, `draft`, `publishAt`):
  - `video`: relative HLS path (e.g. `hls/my-vlog.m3u8`) — required; the engine composes the playback URL as `${transmissions.mediaBaseUrl}/transmissions/${video}`
  - `title`: display title for the transmission entry (optional; falls back to slug, like posts)
  - `date`: publication date (ISO 8601 format; optional; falls back to git merge date like posts)
  - `description`: shown in the entry preview
  - `duration`: human-readable video length (e.g. `"12:34"`)
  - `poster`: thumbnail image path (optional; defaults to `poster.jpg`)
  - `draft: true` and `publishAt`: hide the transmission exactly as for posts/decks — it is absent from the list, returns 404 on direct hit, and becomes visible automatically when `publishAt` passes
- **Media storage:** HLS media files are stored in R2 (Cloudflare) and are NOT committed to git. The `video` field references them by their relative path within the R2 bucket; the engine's `transmissions.mediaBaseUrl` config setting provides the base URL.
- **Publishing:** transmissions are authored directly in the content repo (no automated publish workflow yet). Future versions will mirror the `publish-deck.yml` pattern for transmissions authored in project repos.

### Overseer: managing transmissions

Transmissions can be managed from the overseer console at `/overseer/transmissions`. After uploading an HLS bundle to R2 via the local publishing tool, the overseer allows you to create a transmission entry, edit its metadata, hide/unhide it, or delete it entirely. Each action commits to `blog-content` via the GitHub API; delete also removes the associated media from R2. The overseer must stay on the private ingress and receive only the necessary R2 and GitHub credentials.

**Known limitation:** overseer edit and hide operations do not preserve a `publishAt` schedule; the console forms don't expose that field. If you need to schedule a transmission, edit the `index.md` file directly in a git PR or commit.
