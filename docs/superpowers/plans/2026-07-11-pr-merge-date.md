# Post Date = PR Merge Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The displayed date of a post/deck becomes the day its PR was merged into the content repo's mainline; frontmatter `date` is only a fallback when git history is unavailable.

**Architecture:** Three small changes down one call chain: `firstAddedDate` (src/lib/git.ts) gains `--first-parent` so it returns the first *mainline* commit containing the file (= the PR's merge/squash commit); `pickPublishedDate` (src/lib/post-date.ts) flips precedence so the git date beats frontmatter; both `ContentStore` call sites stop feeding `publishAt` into date selection. Spec: `docs/superpowers/specs/2026-07-11-pr-merge-date-design.md`.

**Tech Stack:** TypeScript, Astro SSR, vitest (`npm test` = `vitest run`), git CLI via `execFile`.

## Global Constraints

- Dates are `YYYY-MM-DD` strings throughout; `''` means undated (callers already handle it).
- `firstAddedDate` must return `null` on any git failure — a git problem degrades to the frontmatter date, never fails indexing.
- `publishAt` continues to gate *visibility*; it must no longer influence the displayed date.
- No new dependencies, no network calls, no GitHub API.

---

### Task 1: `firstAddedDate` returns the mainline merge date

**Files:**
- Modify: `src/lib/git.ts:75-88`
- Test: `test/lib/git.test.ts` (inside the existing `describe('firstAddedDate')`, after the test ending at line 111)

**Interfaces:**
- Produces: `firstAddedDate(dir: string, repoRelPath: string): Promise<string | null>` — unchanged signature; now returns the `YYYY-MM-DD` committer date of the first **first-parent** commit that added the path.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('firstAddedDate', ...)` block in `test/lib/git.test.ts`:

```ts
  it('returns the merge date, not the branch commit date, for a merged PR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdate-'));
    const at = (iso: string) => ({
      ...process.env,
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
    });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
    writeFileSync(join(dir, 'seed.txt'), 'seed');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, env: at('2021-01-01T10:00:00Z') });
    // Author writes the post on a branch on 2021-03-04...
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir });
    writeFileSync(join(dir, 'post.md'), 'hello');
    execFileSync('git', ['add', 'post.md'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'write post'], { cwd: dir, env: at('2021-03-04T10:00:00Z') });
    // ...and the PR is merged into main on 2022-05-06.
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
    execFileSync('git', ['merge', '--no-ff', '-q', '-m', 'Merge PR', 'feature'], {
      cwd: dir,
      env: at('2022-05-06T10:00:00Z'),
    });
    expect(await firstAddedDate(dir, 'post.md')).toBe('2022-05-06');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/git.test.ts -t "merge date"`
Expected: FAIL — received `'2021-03-04'` (the branch commit date), expected `'2022-05-06'`.

- [ ] **Step 3: Implement — add `--first-parent`**

In `src/lib/git.ts`, replace the doc comment and the `git log` args of `firstAddedDate`:

```ts
/**
 * Date (YYYY-MM-DD) the file first landed on the mainline, or null.
 * `--first-parent` walks only mainline commits and diffs merges against their
 * first parent, so the returned date is the PR's merge/squash commit date —
 * not the author's branch commit date.
 */
export async function firstAddedDate(dir: string, repoRelPath: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  try {
    const out = await git(
      ['log', '--first-parent', '--diff-filter=A', '--reverse', '--format=%cI', '--', repoRelPath],
      dir
    );
    const first = out.split('\n').find((l) => l.trim());
    return first ? first.slice(0, 10) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the git tests**

Run: `npx vitest run test/lib/git.test.ts`
Expected: PASS — all tests, including the pre-existing linear-history test (`'returns the date the file was first committed'` still passes: on a linear history `--first-parent` changes nothing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/git.ts test/lib/git.test.ts
git commit -m "feat(dates): firstAddedDate walks first-parent to return the merge date"
```

---

### Task 2: `pickPublishedDate` — git merge date beats frontmatter

**Files:**
- Modify: `src/lib/post-date.ts:1-12`
- Test: `test/lib/post-date.test.ts:4-19` (replace the `pickPublishedDate` describe block; leave `relativeDay` tests untouched)

**Interfaces:**
- Consumes: nothing from other tasks (pure function).
- Produces: `pickPublishedDate(frontmatterDate: string | undefined, gitDate: string | null): string` — unchanged signature; new precedence: `gitDate` → valid frontmatter `date` → `''`.

- [ ] **Step 1: Replace the `pickPublishedDate` tests with the new precedence**

In `test/lib/post-date.test.ts`, replace the whole `describe('pickPublishedDate', ...)` block with:

```ts
describe('pickPublishedDate', () => {
  it('prefers the git merge date over an explicit frontmatter date', () => {
    expect(pickPublishedDate('2026-01-02', '2026-06-15')).toBe('2026-06-15');
  });
  it('falls back to a valid frontmatter date when git has none', () => {
    expect(pickPublishedDate('2026-01-02', null)).toBe('2026-01-02');
  });
  it('ignores a malformed frontmatter date', () => {
    expect(pickPublishedDate('janurary', null)).toBe('');
    expect(pickPublishedDate('2026/01/02', null)).toBe('');
  });
  it('returns empty when neither is available', () => {
    expect(pickPublishedDate(undefined, null)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/post-date.test.ts`
Expected: FAIL — `'prefers the git merge date over an explicit frontmatter date'` receives `'2026-01-02'`.

- [ ] **Step 3: Flip the precedence**

In `src/lib/post-date.ts`, replace lines 1–12 (the header comment and `pickPublishedDate`) with:

```ts
// Resolve a post's published date: the git mainline merge date wins;
// a valid frontmatter `date` is the fallback for environments without git
// history (local dev, missing clone); otherwise empty (undated).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function pickPublishedDate(
  frontmatterDate: string | undefined,
  gitDate: string | null
): string {
  if (gitDate) return gitDate;
  if (frontmatterDate && YMD.test(frontmatterDate)) return frontmatterDate;
  return '';
}
```

`relativeDay` below it is untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/post-date.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/post-date.ts test/lib/post-date.test.ts
git commit -m "feat(dates): git merge date takes precedence over frontmatter date"
```

---

### Task 3: `ContentStore` — drop `publishAt` from date selection, pin test fixture dates

**Files:**
- Modify: `src/lib/content-store.ts` (two call sites: the post loop around line 274–287 and `indexDeck` around line 344–356)
- Test: `test/lib/content-store.test.ts` (fixture in `beforeEach` at lines 41–44; the two scheduled-date tests at lines 233–246)

**Interfaces:**
- Consumes: `pickPublishedDate(frontmatterDate, gitDate)` with Task 2's precedence (git wins); `firstAddedDate` from Task 1 (merge date).
- Produces: indexed posts/decks whose `date` field is the merge date (or frontmatter fallback in `local` mode). No signature changes.

- [ ] **Step 1: Update the content-store tests for the new precedence**

In `test/lib/content-store.test.ts`:

(a) Replace the fixture comment + three `commitPost` calls in `beforeEach` (lines 41–44). Commit dates are now what orders posts, so pin them (frontmatter dates stay as realistic noise that must NOT win):

```ts
  // Commit dates pinned — the git (merge) date is what dates a post now.
  commitPost('first', '---\ntitle: First\ndate: "2026-06-12"\n---\nHello', '2026-06-12T10:00:00Z');
  commitPost('older', '---\ntitle: Older\ndate: "2026-06-10"\n---\nOld', '2026-06-10T10:00:00Z');
  commitPost('draft', '---\ntitle: Draft\ndate: "2026-06-11"\ndraft: true\n---\nWIP', '2026-06-11T10:00:00Z');
```

(b) Replace the test `'dates a scheduled post by its publishAt day when no explicit date is set'` (lines 233–239) with:

```ts
  it('dates a scheduled post by its merge date, not its publishAt day', async () => {
    commitPost('dbs', '---\ntitle: DBS\npublishAt: "2020-03-04T09:00:00Z"\n---\nx', '2020-01-15T10:00:00Z');
    const store = makeStore();
    await store.start();
    expect(store.getPost('/dbs')?.date).toBe('2020-01-15');
  });
```

(c) Replace the test `'lets an explicit date override the publishAt day'` (lines 241–246) with:

```ts
  it('lets the merge date override an explicit frontmatter date', async () => {
    commitPost('exp', '---\ntitle: E\ndate: "2019-12-31"\npublishAt: "2020-03-04T09:00:00Z"\n---\nx', '2020-01-15T10:00:00Z');
    const store = makeStore();
    await store.start();
    expect(store.getPost('/exp')?.date).toBe('2020-01-15');
  });
```

The local-mode tests (lines 128–148, 151–173) stay as-is — they exercise the frontmatter fallback (`gitDate` is `null` when `local: true`).

- [ ] **Step 2: Run test to verify the new expectations fail**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: FAIL — the two rewritten tests receive the publishAt day / frontmatter date (`'2020-03-04'` / `'2019-12-31'`) instead of `'2020-01-15'`.

- [ ] **Step 3: Drop `publishAtDay` from date selection at both call sites**

In `src/lib/content-store.ts`, post loop — delete the `publishAtDay` line and change the `date:` field:

```ts
        const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;   // DELETE this line
          date: pickPublishedDate(data.date, publishAtDay ?? gitDate),        // BEFORE
          date: pickPublishedDate(data.date, gitDate),                        // AFTER
```

In `indexDeck` — same change:

```ts
      const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;     // DELETE this line
        date: pickPublishedDate(parsed.meta.date, publishAtDay ?? gitDate),   // BEFORE
        date: pickPublishedDate(parsed.meta.date, gitDate),                   // AFTER
```

Everything else around them (the `parsePublishAt` call, the `sched.kind === 'invalid'` warning, the `publishAt`/`scheduleInvalid` index fields) stays — scheduling still gates visibility.

- [ ] **Step 4: Run the content-store tests**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: PASS — including the ordering tests (`['first', 'older']`), which now hold via the pinned commit dates.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-store.ts test/lib/content-store.test.ts
git commit -m "feat(dates): displayed post/deck date is the PR merge date"
```

---

### Task 4: Docs + full-suite verification

**Files:**
- Modify: `docs/blogpost-publishing.md:15-17` and `docs/blogpost-publishing.md:73-75`

**Interfaces:**
- Consumes: the behavior shipped in Tasks 1–3.
- Produces: nothing consumed by other tasks (docs + green suite).

- [ ] **Step 1: Update the two doc passages describing date derivation**

In `docs/blogpost-publishing.md`, the sentence around line 16 currently reads:

> ...and its published **date comes from git** — the first commit that added it to `blog-content` — overridable with a `date:` frontmatter field.

Replace with:

> ...and its published **date comes from git** — the day its PR was merged into `blog-content` (the first mainline commit containing the file). A `date:` frontmatter field is only a fallback for environments without git history (e.g. local dev).

The bullet around line 74 currently reads:

> Its published date is derived from git (the first commit that added it), overridable with a `date:` frontmatter field.

Replace with:

> Its published date is the day the `blog-content` PR was merged; a `date:` frontmatter field is only a fallback when git history is unavailable.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all files; the changes touch nothing outside the three libs and their tests (RSS/index/heatmap read the indexed `date` field and are covered transitively).

- [ ] **Step 3: Commit**

```bash
git add docs/blogpost-publishing.md
git commit -m "docs: published date is the PR merge date"
```
