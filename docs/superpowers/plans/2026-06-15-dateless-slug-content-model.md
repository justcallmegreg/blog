# Dateless, Slug-Based Content Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace date-based content directories with per-source, per-post folders and slug URLs; derive the published date from git (frontmatter override); rework the publish workflow and migrate existing content.

**Architecture:** Posts live at `blogs/{owner}-{repo}/{slug}/index.md` (+ `assets/`) and serve at `/{slug}`. `paths.ts` parses that layout; `content-store` resolves each post's date via `pickPublishedDate(frontmatter.date, gitFirstAddDate)`; a full (non-shallow) clone gives git the history. New `[slug].astro` + `[slug]/assets/[...file].ts` routes replace the dated ones.

**Tech Stack:** Astro 5 SSR, TypeScript, Vitest, git CLI, gray-matter, GitHub Actions.

---

## File structure

| File | Change |
|---|---|
| `src/lib/paths.ts` | Rewrite: parse `{ns}/{slug}/index.md` → `{slug, url, urlPrefix, contentDir}`. |
| `src/lib/post-date.ts` (create) | `pickPublishedDate(frontmatterDate, gitDate)`. |
| `src/lib/frontmatter.ts` | Add optional `date`. |
| `src/lib/git.ts` | Full clone/fetch (drop `--depth 1`); add `firstAddedDate()`. |
| `src/lib/content-store.ts` | `Post` drops `year/month/day`, adds `contentDir`; date from git+frontmatter; `resolveAssetPath(slug,file)`. |
| `src/pages/[slug].astro` (create) | Post page (replaces dated route). |
| `src/pages/[slug]/assets/[...file].ts` (create) | Asset route (replaces dated route). |
| `src/pages/[year]/...` (delete) | Remove the two dated route files + empty dirs. |
| `src/pages/index.astro` | Omit the meta line for undated posts. |
| `.github/workflows/publish-blogpost.yml` | Detect post folders, copy whole folder, no date math. |
| `scripts/migrate-content-layout.mjs` (create) | One-off migration of `blog-content`. |
| `README.md`, `docs/blogpost-publishing.md` | Update layout + URL docs. |
| Tests: `test/lib/paths.test.ts`, `test/lib/post-date.test.ts`, `test/lib/git.test.ts`, `test/lib/frontmatter.test.ts` | Add/adjust. |

---

## Task 1: Rewrite `src/lib/paths.ts` (TDD)

**Files:** Modify `src/lib/paths.ts`; Modify `test/lib/paths.test.ts`.

- [ ] **Step 1: Replace the tests** in `test/lib/paths.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { parsePostPath } from '../../src/lib/paths';

describe('parsePostPath', () => {
  it('parses {ns}/{slug}/index.md into a slug URL + content dir', () => {
    expect(parsePostPath('justcallmegreg-blog/my-post/index.md')).toEqual({
      slug: 'my-post',
      url: '/my-post',
      urlPrefix: '/my-post',
      contentDir: 'justcallmegreg-blog/my-post',
    });
  });
  it('ignores asset files (no index.md match)', () => {
    expect(parsePostPath('justcallmegreg-blog/my-post/assets/x.png')).toBeNull();
  });
  it('ignores non-post paths', () => {
    expect(parsePostPath('README.md')).toBeNull();
    expect(parsePostPath('my-post/index.md')).toBeNull();  // too shallow ({slug}/index.md, no namespace)
    expect(parsePostPath('a/b/c/index.md')).toBeNull();    // too deep
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run test/lib/paths.test.ts` (old shape returns year/month/day).

- [ ] **Step 3: Replace `src/lib/paths.ts`** entirely with:

```ts
export interface PostPathInfo {
  slug: string;
  url: string;
  urlPrefix: string;
  contentDir: string; // content-root-relative dir, e.g. "justcallmegreg-blog/my-post"
}

// {namespace}/{slug}/index.md  — namespace is the source "owner-repo".
const POST_PATH = /^([^/]+)\/([^/]+)\/index\.md$/;

export function parsePostPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, ns, slug] = match;
  return {
    slug,
    url: `/${slug}`,
    urlPrefix: `/${slug}`,
    contentDir: `${ns}/${slug}`,
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run test/lib/paths.test.ts`.

- [ ] **Step 5: Commit** — `git add src/lib/paths.ts test/lib/paths.test.ts && git commit -m "feat(paths): slug-based post paths ({ns}/{slug}/index.md)"`

---

## Task 2: `src/lib/post-date.ts` (TDD)

**Files:** Create `src/lib/post-date.ts`; Create `test/lib/post-date.test.ts`.

- [ ] **Step 1: Write the failing tests** — `test/lib/post-date.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickPublishedDate } from '../../src/lib/post-date';

describe('pickPublishedDate', () => {
  it('prefers a valid frontmatter date', () => {
    expect(pickPublishedDate('2026-01-02', '2026-06-15')).toBe('2026-01-02');
  });
  it('ignores a malformed frontmatter date and uses git', () => {
    expect(pickPublishedDate('janurary', '2026-06-15')).toBe('2026-06-15');
    expect(pickPublishedDate('2026/01/02', '2026-06-15')).toBe('2026-06-15');
  });
  it('uses git when no frontmatter date', () => {
    expect(pickPublishedDate(undefined, '2026-06-15')).toBe('2026-06-15');
  });
  it('returns empty when neither is available', () => {
    expect(pickPublishedDate(undefined, null)).toBe('');
    expect(pickPublishedDate('nope', null)).toBe('');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing) — `npx vitest run test/lib/post-date.test.ts`.

- [ ] **Step 3: Implement `src/lib/post-date.ts`**:

```ts
// Resolve a post's published date: an explicit, valid frontmatter `date` wins;
// otherwise the git first-add (merge) date; otherwise empty (undated).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function pickPublishedDate(
  frontmatterDate: string | undefined,
  gitDate: string | null
): string {
  if (frontmatterDate && YMD.test(frontmatterDate)) return frontmatterDate;
  if (gitDate) return gitDate;
  return '';
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run test/lib/post-date.test.ts`.

- [ ] **Step 5: Commit** — `git add src/lib/post-date.ts test/lib/post-date.test.ts && git commit -m "feat(content): pickPublishedDate (frontmatter > git > empty)"`

---

## Task 3: Frontmatter `date` field (TDD)

**Files:** Modify `src/lib/frontmatter.ts`; Modify `test/lib/frontmatter.test.ts`.

- [ ] **Step 1: Add a failing test** to `test/lib/frontmatter.test.ts` (inside the existing `describe`):

```ts
  it('parses an optional date string', () => {
    const { data } = parseFrontmatter('---\ntitle: T\ndate: "2026-01-02"\n---\nbody');
    expect(data.date).toBe('2026-01-02');
  });
  it('leaves date undefined when absent', () => {
    const { data } = parseFrontmatter('---\ntitle: T\n---\nbody');
    expect(data.date).toBeUndefined();
  });
```
(If `test/lib/frontmatter.test.ts` lacks the `parseFrontmatter` import, add `import { parseFrontmatter } from '../../src/lib/frontmatter';` at the top.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run test/lib/frontmatter.test.ts` (`data.date` undefined / type error).

- [ ] **Step 3: Add `date` to the schema** in `src/lib/frontmatter.ts`:

```ts
const FrontmatterSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  date: z.string().optional(),
});
```
(A string is accepted as-is; `pickPublishedDate` validates the `YYYY-MM-DD` shape, so a malformed value is ignored rather than failing the parse.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run test/lib/frontmatter.test.ts`.

- [ ] **Step 5: Commit** — `git add src/lib/frontmatter.ts test/lib/frontmatter.test.ts && git commit -m "feat(frontmatter): optional date field"`

---

## Task 4: Full clone + `firstAddedDate` in `src/lib/git.ts`

**Files:** Modify `src/lib/git.ts`; Modify `test/lib/git.test.ts`.

- [ ] **Step 1: Write a failing test** in `test/lib/git.test.ts` (add the imports it needs at the top: `import { execFileSync } from 'node:child_process'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { firstAddedDate } from '../../src/lib/git';`):

```ts
describe('firstAddedDate', () => {
  it('returns the date the file was first committed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdate-'));
    const env = {
      ...process.env,
      GIT_AUTHOR_DATE: '2021-03-04T10:00:00Z',
      GIT_COMMITTER_DATE: '2021-03-04T10:00:00Z',
    };
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
    writeFileSync(join(dir, 'post.md'), 'hello');
    execFileSync('git', ['add', 'post.md'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'add'], { cwd: dir, env });
    // a later edit must NOT move the date
    writeFileSync(join(dir, 'post.md'), 'hello again');
    execFileSync('git', ['commit', '-qam', 'edit'], {
      cwd: dir,
      env: { ...process.env, GIT_COMMITTER_DATE: '2022-09-09T10:00:00Z', GIT_AUTHOR_DATE: '2022-09-09T10:00:00Z' },
    });
    expect(await firstAddedDate(dir, 'post.md')).toBe('2021-03-04');
  });
  it('returns null for an unknown file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitdate-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(await firstAddedDate(dir, 'nope.md')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run test/lib/git.test.ts` (`firstAddedDate` missing).

- [ ] **Step 3a: Drop the shallow flags.** In `src/lib/git.ts`, change `cloneRepo`'s args array — remove the `'--depth', '1',` lines so it reads:

```ts
    [
      'clone',
      '--branch',
      opts.branch,
      '--single-branch',
      url,
      opts.dir,
    ],
```

And in `fetchReset`, change the fetch line from `await git(['fetch', '--depth', '1', 'origin', opts.branch], opts.dir, opts.token);` to:

```ts
  await git(['fetch', 'origin', opts.branch], opts.dir, opts.token);
```

- [ ] **Step 3b: Add `firstAddedDate`** at the end of `src/lib/git.ts`:

```ts
/** Date (YYYY-MM-DD) of the first commit that added `repoRelPath`, or null. */
export async function firstAddedDate(dir: string, repoRelPath: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  try {
    const out = await git(
      ['log', '--diff-filter=A', '--reverse', '--format=%cI', '--', repoRelPath],
      dir
    );
    const first = out.split('\n').find((l) => l.trim());
    return first ? first.slice(0, 10) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run test/lib/git.test.ts`.

- [ ] **Step 5: Commit** — `git add src/lib/git.ts test/lib/git.test.ts && git commit -m "feat(git): full clone + firstAddedDate"`

---

## Task 5: Wire dates + new fields into `src/lib/content-store.ts`

**Files:** Modify `src/lib/content-store.ts`.

- [ ] **Step 1: Update imports + the `Post` interface.** Add to the imports at the top:

```ts
import { cloneRepo, fetchReset, lsTreeBlobs, firstAddedDate } from './git';
import { pickPublishedDate } from './post-date';
```
(Replace the existing `import { cloneRepo, fetchReset, lsTreeBlobs } from './git';` line.)

Change the `Post` interface to drop `year/month/day` and add `contentDir`:

```ts
export interface Post {
  url: string;
  urlPrefix: string;
  date: string;
  slug: string;
  contentDir: string;
  title: string;
  description?: string;
  excerpt: string;
  draft: boolean;
  html: string;
  blobHash: string;
}
```

- [ ] **Step 2: Compute the date in `reindex`.** In the `for (const [repoRel, hash] of blobs)` loop, after `const { data, content } = parseFrontmatter(raw);` and the `html`/`excerpt` lines, replace the `this.index.set(info.url, { ... })` object with:

```ts
        const gitDate = this.opts.local
          ? null
          : await firstAddedDate(this.opts.cacheDir, repoRel);
        this.index.set(info.url, {
          url: info.url,
          urlPrefix: info.urlPrefix,
          date: pickPublishedDate(data.date, gitDate),
          slug: info.slug,
          contentDir: info.contentDir,
          title: data.title ?? info.slug,
          description: data.description,
          excerpt,
          draft: data.draft,
          html,
          blobHash: hash,
        });
```

- [ ] **Step 3: Replace `resolveAssetPath`** with a slug-based version:

```ts
  resolveAssetPath(slug: string, file: string): string | null {
    const post = this.index.get(`/${slug}`);
    if (!post) return null;
    // resolve() makes baseDir absolute so the traversal check holds even when
    // contentRoot/cacheDir is a relative path (e.g. the default './cache').
    const baseDir = resolve(this.contentRoot(), post.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
```

- [ ] **Step 4: Build to verify types compile** — `npm run build 2>&1 | tail -3`. Expected: `[build] Complete!` (the old dated routes still reference `year/month/day` and `resolveAssetPath(year,...)`, so the build may error there — that's expected and fixed in Task 6; if it errors only in `src/pages/[year]/...`, proceed to Task 6, then build again).

- [ ] **Step 5: Commit** — `git add src/lib/content-store.ts && git commit -m "feat(content): post date from git+frontmatter, slug content dirs"`

---

## Task 6: New routes (`[slug].astro`, `[slug]/assets`) + remove dated routes + index polish

**Files:** Create `src/pages/[slug].astro`, `src/pages/[slug]/assets/[...file].ts`; Delete `src/pages/[year]/`; Modify `src/pages/index.astro`.

- [ ] **Step 1: Create `src/pages/[slug].astro`**:

```astro
---
import Terminal from '../layouts/Terminal.astro';
import Typewriter from '../components/Typewriter.astro';
import { ensureStarted } from '../lib/store-singleton';
import { getConfig } from '../lib/config';

const cfg = getConfig();
const { slug } = Astro.params;
const store = await ensureStarted();
const post = store.getPost(`/${slug}`);

if (!post || post.draft) {
  return new Response('Not found', { status: 404 });
}
---
<Terminal title={post.title}>
  <p><a href="/">&lt; back</a></p>
  <article>
    <h1>{post.title}</h1>
    {post.date && <p class="meta">{post.date}</p>}
    {cfg.effects.typewriter
      ? <Typewriter><Fragment set:html={post.html} /></Typewriter>
      : <Fragment set:html={post.html} />}
  </article>
</Terminal>
```

- [ ] **Step 2: Create `src/pages/[slug]/assets/[...file].ts`**:

```ts
import type { APIRoute } from 'astro';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { ensureStarted } from '../../../lib/store-singleton';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export const GET: APIRoute = async ({ params }) => {
  const { slug, file } = params;
  if (!slug || !file) return new Response('Not found', { status: 404 });

  const store = await ensureStarted();
  const path = store.resolveAssetPath(slug, file);
  if (!path) return new Response('Forbidden', { status: 403 });

  try {
    await stat(path);
    const data = await readFile(path);
    return new Response(data, {
      headers: {
        'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
```

- [ ] **Step 3: Delete the dated routes** — `git rm -r "src/pages/[year]"`.

- [ ] **Step 4: Polish the index meta** in `src/pages/index.astro` — change the entry-meta line:

from `            <div class="entry-meta">{dot(p.date)}</div>`
to `            {p.date && <div class="entry-meta">{dot(p.date)}</div>}`

- [ ] **Step 5: Build + full suite** — `npm run build && npx vitest run 2>&1 | grep -E "Tests +[0-9]|FAIL"`. Expected: `[build] Complete!`, all tests pass.

- [ ] **Step 6: Commit** — `git add -A src/pages && git commit -m "feat(routes): slug post + asset routes; drop dated routes"`

---

## Task 7: Rework the publish workflow

**Files:** Modify `.github/workflows/publish-blogpost.yml`.

- [ ] **Step 1: Replace the `detect` step's script** (the `run: |` block of "Collect added/modified posts") with folder-based detection:

```yaml
        run: |
          set -euo pipefail
          ZERO=0000000000000000000000000000000000000000
          if [ "$EVENT" = "workflow_dispatch" ] || [ -z "${BEFORE:-}" ] || [ "$BEFORE" = "$ZERO" ]; then
            mapfile -t files < <(find "$SOURCE_DIR" -type f | sort)
          else
            mapfile -t files < <(git diff --name-only --diff-filter=AM "$BEFORE" "$AFTER" -- "$SOURCE_DIR" | sort -u)
          fi
          # Map each changed path to its post slug (the segment right under SOURCE_DIR),
          # keep only those that are real posts (have an index.md), dedupe.
          slugs=()
          for f in "${files[@]:-}"; do
            rel="${f#"$SOURCE_DIR"/}"
            slug="${rel%%/*}"
            [ -n "$slug" ] || continue
            [ -f "$SOURCE_DIR/$slug/index.md" ] || continue
            slugs+=("$slug")
          done
          if [ "${#slugs[@]}" -eq 0 ]; then
            json='[]'
          else
            json=$(printf '%s\n' "${slugs[@]}" | sort -u | jq -R . | jq -cs .)
          fi
          count=$(printf '%s' "$json" | jq 'length')
          echo "posts=$json" >> "$GITHUB_OUTPUT"
          echo "count=$count" >> "$GITHUB_OUTPUT"
          echo "found $count post(s): $json"
```
(Rename the output: the matrix now iterates slugs. Keep the `outputs.posts`/`outputs.count` names.)

- [ ] **Step 2: Replace the publish job's matrix + "Compute destination + copy files" step.** The matrix stays `post: ${{ fromJSON(needs.detect.outputs.posts) }}` (now a slug). Replace the `prep` step's `run: |` block with:

```yaml
        run: |
          set -euo pipefail
          slug="$POST"
          prefix="${GITHUB_REPOSITORY//\//-}"      # owner-repo
          srcdir="$SOURCE_DIR/$slug"
          destrel="$DEST_SUBDIR/$prefix/$slug"
          dest=".content-repo/$destrel"
          mkdir -p "$(dirname "$dest")"
          rm -rf "$dest"
          cp -R "$srcdir" "$dest"               # whole post folder: index.md + assets/
          {
            echo "slug=$slug"
            echo "destrel=$destrel"
            echo "branch=blogpost/$prefix-$slug"
          } >> "$GITHUB_OUTPUT"
          echo "publish $srcdir -> $destrel (branch blogpost/$prefix-$slug)"
```
(`env: POST: ${{ matrix.post }}` on this step stays.) The dry-run summary and `create-pull-request` steps are unchanged except they already read `steps.prep.outputs.slug/destrel/branch`.

- [ ] **Step 3: Validate YAML + lint** — `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/publish-blogpost.yml','utf8')); console.log('OK')"` then `actionlint .github/workflows/publish-blogpost.yml && echo CLEAN`. Expected: `OK`, `CLEAN`.

- [ ] **Step 4: Commit** — `git add .github/workflows/publish-blogpost.yml && git commit -m "feat(ci): publish whole post folders to {owner-repo}/{slug}/"`

---

## Task 8: Update docs (README + adoption guide)

**Files:** Modify `README.md`, `docs/blogpost-publishing.md`.

- [ ] **Step 1: README content-layout section.** Replace the fenced block + paragraph under `## Content repo layout` with:

````markdown
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
````

- [ ] **Step 2: README frontmatter block** — add `date` to the example:

```yaml
---
title: "My Post Title"   # display title (falls back to the slug)
description: "..."       # used for the <meta description>
date: "2026-06-12"       # optional: overrides the git-derived published date
draft: false             # drafts are hidden from the index and 404 on direct hit
---
```

- [ ] **Step 3: README "Publish posts" section** — in the adoption steps, change the layout sentence to: author posts as `blogs/{slug}/index.md` (+ `blogs/{slug}/assets/`) in the project repo; the workflow publishes them to `blogs/{owner}-{repo}/{slug}/` in the content repo (slug-based URLs, git-derived dates).

- [ ] **Step 4: `docs/blogpost-publishing.md`** — update the diagram and the "How it works" bullets to the new paths: source `blogs/{slug}/index.md`, dest `blogs/{owner}-{repo}/{slug}/index.md`, URL `/{slug}`, date from git (frontmatter `date:` override). Remove references to `YYYY/MM/DD` and the `{owner}-{repo}-{slug}.md` rename.

- [ ] **Step 5: Commit** — `git add README.md docs/blogpost-publishing.md && git commit -m "docs: slug-based, git-dated content model"`

---

## Task 9: Migration script + migrate local `blog-content`

**Files:** Create `scripts/migrate-content-layout.mjs`.

- [ ] **Step 1: Create `scripts/migrate-content-layout.mjs`**:

```js
// One-off: migrate a content repo from blogs/YYYY/MM/DD/{slug}.md to
// blogs/{namespace}/{slug}/index.md, stamping the old path date into frontmatter
// so existing posts keep their date. Usage:
//   node scripts/migrate-content-layout.mjs <content-dir> <namespace>
import {
  readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const [, , contentDir, namespace] = process.argv;
if (!contentDir || !namespace) {
  console.error('usage: node scripts/migrate-content-layout.mjs <content-dir> <namespace>');
  process.exit(1);
}
const blogs = join(contentDir, 'blogs');
const DATE = /^(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\.md$/;

function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

const posts = walk(blogs).map((r) => ({ r, m: DATE.exec(r) })).filter((x) => x.m);
for (const { r, m } of posts) {
  const [, y, mo, d, slug] = m;
  const date = `${y}-${mo}-${d}`;
  const destDir = join(blogs, namespace, slug);
  mkdirSync(destDir, { recursive: true });
  const parsed = matter(readFileSync(join(blogs, r), 'utf8'));
  if (!parsed.data.date) parsed.data.date = date;
  writeFileSync(join(destDir, 'index.md'), matter.stringify(parsed.content, parsed.data));
  const dayAssets = join(blogs, y, mo, d, 'assets');
  if (existsSync(dayAssets)) cpSync(dayAssets, join(destDir, 'assets'), { recursive: true });
}
for (const name of readdirSync(blogs)) {
  if (/^\d{4}$/.test(name)) rmSync(join(blogs, name), { recursive: true, force: true });
}
console.log(`migrated ${posts.length} posts into blogs/${namespace}/{slug}/index.md`);
```

- [ ] **Step 2: Run it against the local content repo** —
`node scripts/migrate-content-layout.mjs ../blog-content justcallmegreg-blog`
Expected: `migrated N posts into blogs/justcallmegreg-blog/{slug}/index.md`.

- [ ] **Step 3: Verify the new layout + stamped dates** —
```bash
find ../blog-content/blogs -name index.md | head
grep -l "^date:" ../blog-content/blogs/justcallmegreg-blog/*/index.md | wc -l   # all posts dated
ls ../blog-content/blogs | grep -vx justcallmegreg-blog || echo "(only the namespace dir remains)"
```
Expected: `index.md` files under `blogs/justcallmegreg-blog/<slug>/`, every post has a `date:` line, no leftover `YYYY` dirs.

- [ ] **Step 4: Commit the script (engine repo)** — `git add scripts/migrate-content-layout.mjs && git commit -m "chore: content-layout migration script"`

- [ ] **Step 5: Commit + push the content repo** (separate repo) —
```bash
git -C ../blog-content add -A
git -C ../blog-content commit -m "migrate to slug-based per-post folders (dates stamped in frontmatter)"
git -C ../blog-content push origin main
```

---

## Task 10: Live verification

**Files:** none.

- [ ] **Step 1: Start the engine against the migrated repo** (warm `/` first so the clone happens before anything writes to CACHE_DIR):
```bash
lsof -ti tcp:4321 | xargs -r kill -9 2>/dev/null; sleep 1
CONFIG_PATH=./config.yaml CACHE_DIR="$(mktemp -d)/cache" HOST=127.0.0.1 PORT=4321 node ./dist/server/entry.mjs &
sleep 6
curl -fsS -o /dev/null -w "index: %{http_code}\n" http://127.0.0.1:4321/
```

- [ ] **Step 2: A post serves at `/{slug}` with its stamped date** —
```bash
slug=$(curl -fsS http://127.0.0.1:4321/ | grep -oE 'href="/[a-z0-9-]+"' | grep -vE '/(contributions|about|contact)"' | head -1 | sed -E 's/href="\/(.*)"/\1/')
echo "slug: $slug"
curl -fsS -o /dev/null -w "post:  %{http_code}\n" "http://127.0.0.1:4321/$slug"
curl -fsS "http://127.0.0.1:4321/$slug" | grep -oE 'class="meta">[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1
```
Expected: `index: 200`, `post: 200`, and a `YYYY-MM-DD` meta date (the stamped path date for the migrated post).

- [ ] **Step 3: Assets load** — if any migrated post has assets, fetch `/{slug}/assets/<file>` and expect `200`. (For the known one: `reactor-diagnostics` → `reactor.svg`.)
```bash
curl -fsS -o /dev/null -w "asset: %{http_code}\n" "http://127.0.0.1:4321/reactor-diagnostics/assets/reactor.svg"
```
Expected: `asset: 200`.

- [ ] **Step 4: Stop the server** — `lsof -ti tcp:4321 | xargs -r kill -9 2>/dev/null`.

---

## Self-review notes

- **Spec coverage:** layout/URL (Tasks 1,5,6), date precedence + git (Tasks 2,3,4,5), full clone (Task 4), routes incl. assets (Task 6), publish workflow folder copy + detection (Task 7), docs (Task 8), migration with date-stamping (Task 9), reserved-route note (docs), dev-mode/undated handling (`local→null` in Task 5, `{post.date && …}` in Task 6 + index polish), live verify (Task 10). All spec sections map to a task.
- **Type/name consistency:** `parsePostPath → {slug,url,urlPrefix,contentDir}` (Task 1) consumed in Task 5; `pickPublishedDate(frontmatterDate, gitDate)` (Task 2) called in Task 5; `firstAddedDate(dir, repoRelPath)` (Task 4) called in Task 5; `Post.contentDir` (Task 5) used by `resolveAssetPath(slug,file)` (Task 5) called from the asset route (Task 6); workflow outputs `posts`/`count` + step outputs `slug`/`destrel`/`branch` (Task 7) match the unchanged PR step. Consistent.
- **Placeholders:** none — every code/command step is complete.
