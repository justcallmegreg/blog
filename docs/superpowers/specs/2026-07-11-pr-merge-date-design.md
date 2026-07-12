# Post date = PR merge date — design

Date: 2026-07-11
Status: approved (brainstorming)

## Summary

The displayed date of a blog post (and deck) becomes **the day its pull request
was merged into the content repo's mainline**, always. Frontmatter `date`
survives only as a fallback for environments with no usable git history (local
dev via `opts.local`, or a missing clone at startup). `publishAt` keeps
controlling *visibility* of scheduled posts but no longer influences the
displayed date.

No new data sources: the merge date is already encoded in the content repo's
history. The first **mainline** (`--first-parent`) commit that adds a file is
the PR's merge commit (merge-commit strategy), squash commit (squash strategy),
or rebased commit (rebase strategy — rebase rewrites committer dates to merge
time). Its committer date is the merge date in all three cases.

## Current behavior (what changes)

- `firstAddedDate` (`src/lib/git.ts:76`) runs
  `git log --diff-filter=A --reverse --format=%cI -- <path>` **without**
  `--first-parent`, so for merge-commit PRs it returns the author's branch
  commit date, not the merge date.
- `pickPublishedDate` (`src/lib/post-date.ts:5`) precedence is
  frontmatter `date` → git date → `''`, and both call sites pass
  `publishAtDay ?? gitDate` as the git side, so frontmatter and `publishAt`
  both beat the git date today.

## Changes

### 1. `src/lib/git.ts` — mainline-only first-add

Add `--first-parent` to the `git log` invocation in `firstAddedDate`:

```
git log --first-parent --diff-filter=A --reverse --format=%cI -- <path>
```

With `--first-parent`, merge commits are diffed against their first parent
(`--diff-merges=first-parent` is implied), so a merge that introduces the file
registers as an `A` on the mainline. Update the doc comment to say the result
is the mainline merge date. Error/missing-dir behavior is unchanged: return
`null`.

The clone is full-depth single-branch (`cloneRepo`), so the mainline history
needed for this walk is always present.

### 2. `src/lib/post-date.ts` — precedence flip

`pickPublishedDate(frontmatterDate, gitDate)` becomes: **git merge date wins;
frontmatter is the fallback**:

1. `gitDate` if present (already `YYYY-MM-DD`),
2. else frontmatter `date` if it matches `YYYY-MM-DD`,
3. else `''` (undated — callers already handle this).

Signature and return type stay the same; only the order of the two checks
swaps. `relativeDay` is untouched.

### 3. `src/lib/content-store.ts` — call sites stop feeding `publishAt` into the date

Both call sites (posts, `indexBlog` scan loop; decks, `indexDeck`) currently
pass `pickPublishedDate(meta.date, publishAtDay ?? gitDate)`. They change to
`pickPublishedDate(meta.date, gitDate)` — `publishAtDay` is no longer part of
date selection. `parsePublishAt` and the `publishAt` / `scheduleInvalid` index
fields are unchanged; scheduling still gates visibility.

Consequence (accepted in brainstorming): a post merged early with a future
`publishAt` displays its merge date once it goes live, not its scheduled day.

Downstream consumers (index grouping, post page, RSS `rss.xml.ts`, decks
listing) all read the indexed `date` field and need no changes.

### 4. Tests

- Update `pickPublishedDate` unit tests for the new precedence: git date beats
  frontmatter; frontmatter used only when git date is `null`; invalid
  frontmatter still yields `''` when git date is absent.
- Update/extend content-store tests that assert `publishAtDay` feeds the date —
  scheduled posts now expect the git/frontmatter date.
- Add a git-fixture test for `firstAddedDate`: build a temp repo, add a file on
  a branch (backdated committer date), merge with `--no-ff` at a later date,
  assert the returned date is the merge date, not the branch commit date.

## Error handling

Unchanged by design: `firstAddedDate` returns `null` on any git failure, and
`pickPublishedDate` then falls back to frontmatter, then `''`. A transient git
problem degrades to the frontmatter date rather than blanking or failing the
index — consistent with the engine's fail-safe posture.

## Out of scope

- GitHub API lookups (`merged_at`) — rejected: adds token/network/rate-limit
  failure modes for a fact git history already holds.
- CI stamping dates into frontmatter — rejected: mutates the content repo.
- Any change to `publishAt` visibility gating or the newsletter/RSS pipelines.
