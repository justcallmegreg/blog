# About content in blog-content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the About page's headline/bio/projects out of engine config into `blog-content/about.yaml`, read through the existing content-sync machinery, so achievements are editable with no redeploy.

**Architecture:** A new `src/lib/about.ts` owns the `AboutData` schema + a pure `parseAbout(raw)` (YAML + zod). `ContentStore` reads `<cacheDir>/about.yaml` on every reindex and exposes `getAbout(): AboutData | null`. `about.astro` reads from the store instead of config. The `about.enabled` feature flag stays in config (used synchronously by the layout).

**Tech Stack:** TypeScript, Astro (SSR), zod, `yaml`, vitest.

## Global Constraints

- `about.yaml` lives at the **content repo root** (`<cacheDir>/about.yaml`), a sibling of the posts subdir — never inside it.
- A missing or malformed `about.yaml` must yield `null` and a log line, **never a thrown error / 500**.
- `about.enabled` stays in engine config; `headline`/`bio`/`projects` are **removed** from the config schema.
- Bio stays a plain string (no markdown rendering).
- Follow existing patterns: `parseYaml` from `'yaml'` (as in `config.ts`), zod schemas with `.default()`, `[content]`-prefixed log lines.
- Commit after each task. Run `npm test` (vitest) for the touched files.

---

### Task 1: About schema + parser (`src/lib/about.ts`)

**Files:**
- Create: `src/lib/about.ts`
- Test: `test/lib/about.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AboutProject = { start: number; end: number; description: string; responsibilities: string; deliveries: string }`
  - `type AboutData = { headline: string; bio: string; projects: AboutProject[] }`
  - `function parseAbout(raw: string): AboutData` — parses a YAML string and validates it; **throws** on invalid input.

- [ ] **Step 1: Write the failing test**

Create `test/lib/about.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAbout } from '../../src/lib/about';

describe('parseAbout', () => {
  it('parses a full document', () => {
    const data = parseAbout(`
headline: "Greg — engineer"
bio: "Short bio."
projects:
  - start: 2021
    end: 2023
    description: "A project."
    responsibilities: "Led it."
    deliveries: "Shipped it."
`);
    expect(data.headline).toBe('Greg — engineer');
    expect(data.bio).toBe('Short bio.');
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]).toEqual({
      start: 2021,
      end: 2023,
      description: 'A project.',
      responsibilities: 'Led it.',
      deliveries: 'Shipped it.',
    });
  });

  it('applies defaults for missing optional fields', () => {
    const data = parseAbout(`
projects:
  - start: 2020
    end: 2021
    description: "Minimal."
`);
    expect(data.headline).toBe('');
    expect(data.bio).toBe('');
    expect(data.projects[0].responsibilities).toBe('');
    expect(data.projects[0].deliveries).toBe('');
  });

  it('defaults projects to an empty array when absent', () => {
    const data = parseAbout(`headline: "Only a headline"`);
    expect(data.projects).toEqual([]);
  });

  it('treats an empty document as all-defaults', () => {
    const data = parseAbout('');
    expect(data).toEqual({ headline: '', bio: '', projects: [] });
  });

  it('throws when a project is missing a required field', () => {
    expect(() =>
      parseAbout(`
projects:
  - start: 2020
    description: "No end year."
`)
    ).toThrow();
  });

  it('throws when start/end are not integers', () => {
    expect(() =>
      parseAbout(`
projects:
  - start: "twenty"
    end: 2021
    description: "Bad start."
`)
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/about.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/about`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/about.ts`:

```ts
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const AboutSchema = z.object({
  headline: z.string().default(''),
  bio: z.string().default(''),
  projects: z
    .array(
      z.object({
        start: z.number().int(),
        end: z.number().int(),
        description: z.string(),
        responsibilities: z.string().default(''),
        deliveries: z.string().default(''),
      })
    )
    .default([]),
});

export type AboutData = z.infer<typeof AboutSchema>;
export type AboutProject = AboutData['projects'][number];

/**
 * Parse and validate an about.yaml document. Throws on invalid input — callers
 * (the content store) catch and degrade to null so a bad file never 500s a page.
 */
export function parseAbout(raw: string): AboutData {
  const data = parseYaml(raw) ?? {};
  const result = AboutSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid about.yaml: ${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/about.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/about.ts test/lib/about.test.ts
git commit -m "feat(about): about.yaml schema + parseAbout"
```

---

### Task 2: `ContentStore.getAbout()` loads about.yaml on reindex

**Files:**
- Modify: `src/lib/content-store.ts` (import; new field; `loadAbout()`; call in `reindex()`; `getAbout()` accessor)
- Test: `test/lib/content-store.test.ts` (append cases)

**Interfaces:**
- Consumes: `parseAbout`, `AboutData` from Task 1.
- Produces: `ContentStore.getAbout(): AboutData | null` — the parsed about.yaml at the content repo root, or `null` if absent/malformed. Refreshed on every `start()`/`sync()`.

- [ ] **Step 1: Write the failing test**

Append to `test/lib/content-store.test.ts` (inside the `describe('ContentStore', …)` block, before its closing `});`):

```ts
  it('exposes about.yaml from the repo root, refreshed on sync', async () => {
    // Absent initially → null.
    const store = makeStore();
    await store.start();
    expect(store.getAbout()).toBeNull();

    // Add about.yaml at the repo root (sibling of the posts, NOT under a subdir).
    writeFileSync(
      join(originDir, 'about.yaml'),
      'headline: "Greg"\nbio: "Bio."\nprojects:\n  - start: 2021\n    end: 2023\n    description: "A project."\n'
    );
    git(originDir, 'add', '-A');
    git(originDir, 'commit', '-m', 'add about');
    await store.sync();

    const about = store.getAbout();
    expect(about?.headline).toBe('Greg');
    expect(about?.bio).toBe('Bio.');
    expect(about?.projects).toEqual([
      { start: 2021, end: 2023, description: 'A project.', responsibilities: '', deliveries: '' },
    ]);
  });

  it('returns null and does not throw on a malformed about.yaml', async () => {
    writeFileSync(join(originDir, 'about.yaml'), 'projects:\n  - start: 2020\n    description: "no end"\n');
    git(originDir, 'add', '-A');
    git(originDir, 'commit', '-m', 'bad about');
    const store = makeStore();
    await store.start();
    expect(store.getAbout()).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/content-store.test.ts -t about`
Expected: FAIL — `store.getAbout is not a function`.

- [ ] **Step 3: Add the import**

In `src/lib/content-store.ts`, add after the existing `./git` import (line 3):

```ts
import { parseAbout, type AboutData } from './about';
```

- [ ] **Step 4: Add the cache field**

In `src/lib/content-store.ts`, immediately after `private index = new Map<string, Post>();` (line 80), add:

```ts
  private about: AboutData | null = null;
```

- [ ] **Step 5: Load about.yaml during reindex**

In `src/lib/content-store.ts`, in `reindex()`, find its final two lines:

```ts
    this.lastScan = { scanned: blobs.size, underSubdir, matched };
    return changed;
```

Insert the `loadAbout()` call between them:

```ts
    this.lastScan = { scanned: blobs.size, underSubdir, matched };
    this.loadAbout();
    return changed;
```

- [ ] **Step 6: Add loadAbout() + getAbout()**

In `src/lib/content-store.ts`, add these two methods immediately after the `getPost(url: string)` method (right after its closing `}`):

```ts
  /** Parsed about.yaml from the content repo root, or null if absent/malformed. */
  getAbout(): AboutData | null {
    return this.about;
  }

  // about.yaml is a repo-level file at the cache dir root (sibling of the posts
  // subdir), so read from cacheDir directly — NOT contentRoot(), which includes
  // the subdir. Malformed/absent degrades to null; never throws.
  private loadAbout(): void {
    const file = join(this.opts.cacheDir, 'about.yaml');
    if (!existsSync(file)) {
      this.about = null;
      return;
    }
    try {
      this.about = parseAbout(readFileSync(file, 'utf8'));
    } catch (err) {
      console.warn(`[content] about.yaml ignored: ${(err as Error).message}`);
      this.about = null;
    }
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: PASS (all existing cases + the 2 new ones).

- [ ] **Step 8: Commit**

```bash
git add src/lib/content-store.ts test/lib/content-store.test.ts
git commit -m "feat(about): ContentStore.getAbout() reads about.yaml on reindex"
```

---

### Task 3: Trim the config schema, example, and README

**Files:**
- Modify: `src/lib/config.ts:62-79` (the `about` block)
- Modify: `test/lib/config.test.ts:54-57`
- Modify: `config.example.yaml:39-50`
- Modify: `README.md:38, 149-158`

**Interfaces:**
- Consumes: nothing.
- Produces: `cfg.about` now has only `{ enabled: boolean }` (default `true`).

- [ ] **Step 1: Update the config test first (failing)**

In `test/lib/config.test.ts`, replace these four lines (54-57):

```ts
    expect(cfg.about.enabled).toBe(true);
    expect(cfg.about.headline).toBe('');
    expect(cfg.about.bio).toBe('');
    expect(cfg.about.projects).toEqual([]);
```

with:

```ts
    expect(cfg.about.enabled).toBe(true);
    expect(cfg.about).toEqual({ enabled: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — `cfg.about` still contains `headline`/`bio`/`projects`, so the `toEqual({ enabled: true })` assertion fails.

- [ ] **Step 3: Trim the config schema**

In `src/lib/config.ts`, replace the entire `about` block (lines 62-79):

```ts
  about: z
    .object({
      enabled: z.boolean().default(true),
      headline: z.string().default(''),
      bio: z.string().default(''),
      projects: z
        .array(
          z.object({
            start: z.number().int(),
            end: z.number().int(),
            description: z.string(),
            responsibilities: z.string().default(''),
            deliveries: z.string().default(''),
          })
        )
        .default([]),
    })
    .default({}),
```

with:

```ts
  about: z
    .object({
      // Feature flag only: gates the About tab + CV overlay (rendered
      // synchronously by the layout). The About *content* — headline, bio,
      // projects — lives in blog-content/about.yaml, read via the content store.
      enabled: z.boolean().default(true),
    })
    .default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Update config.example.yaml**

In `config.example.yaml`, replace the `about:` block (lines 39-50):

```yaml
about:
  enabled: true
  headline: "Greg — software engineer"
  bio: "Short background summary — who I am, what I work on."
  projects:
    - start: 2021
      end: 2023
      description: "Confidential project — what it was (no client name)."
      responsibilities: "What I owned / led."
      deliveries: "What I shipped / achieved."
  # CV requests are sent to the CV_WEBHOOK_URL env var (not stored here);
  # stage-mode logs the request when unset.
```

with:

```yaml
about:
  enabled: true                  # show the About me tab + page
  # The About page CONTENT (headline, bio, achievements) lives in the content
  # repo at about.yaml (repo root), so it can be edited without redeploying:
  #
  #   # blog-content/about.yaml
  #   headline: "Greg — software engineer"
  #   bio: "Short background summary — who I am, what I work on."
  #   projects:
  #     - start: 2021
  #       end: 2023
  #       description: "Confidential project — what it was (no client name)."
  #       responsibilities: "What I owned / led."
  #       deliveries: "What I shipped / achieved."
  #
  # CV requests are sent to the CV_WEBHOOK_URL env var (not stored here);
  # stage-mode logs the request when unset.
```

- [ ] **Step 6: Update README.md**

In `README.md`, replace the About bullet (line 38):

```
- **About me** (`/about`) — a config-driven bio + unnamed (confidential) project list, with a
```

with:

```
- **About me** (`/about`) — a bio + unnamed (confidential) project list sourced from
  `about.yaml` in the content repo (edit without redeploying), with a
```

Then replace the README `about:` example block (lines 149-158):

```yaml
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
```

with:

```yaml
about:
  enabled: true                  # show the About me tab + page (content lives in about.yaml)
```

Then add, immediately after that `about:` block, a new paragraph documenting the content file:

```markdown
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
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml README.md
git commit -m "refactor(about): drop headline/bio/projects from config (moved to about.yaml)"
```

---

### Task 4: Wire `about.astro` to the content store

**Files:**
- Modify: `src/pages/about.astro`

**Interfaces:**
- Consumes: `ensureStarted()` from `../lib/store-singleton`; `store.getAbout()` from Task 2; `cfg.about.enabled` from Task 3.
- Produces: the rendered `/about` page.

- [ ] **Step 1: Update the page frontmatter + render**

Replace the frontmatter block and the two heading/bio lines in `src/pages/about.astro`. Change the top block (lines 1-12):

```astro
---
import Terminal from '../layouts/Terminal.astro';
import { getConfig } from '../lib/config';

const cfg = getConfig();
const about = cfg.about;
if (!about.enabled) return new Response('Not found', { status: 404 });
const projects = [...about.projects].sort((a, b) => b.end - a.end || b.start - a.start);
---
<Terminal title="About">
  <h1>&gt; ABOUT{about.headline && <span class="muted"> // </span>}{about.headline}</h1>
  {about.bio && <p class="about-bio">{about.bio}</p>}
```

to:

```astro
---
import Terminal from '../layouts/Terminal.astro';
import { getConfig } from '../lib/config';
import { ensureStarted } from '../lib/store-singleton';

const cfg = getConfig();
if (!cfg.about.enabled) return new Response('Not found', { status: 404 });

// About content (headline/bio/projects) comes from blog-content/about.yaml via
// the content store; null when the file is absent/malformed → graceful empty page.
const store = await ensureStarted();
const about = store.getAbout();
const headline = about?.headline ?? '';
const bio = about?.bio ?? '';
const projects = [...(about?.projects ?? [])].sort((a, b) => b.end - a.end || b.start - a.start);
---
<Terminal title="About">
  <h1>&gt; ABOUT{headline && <span class="muted"> // </span>}{headline}</h1>
  {bio && <p class="about-bio">{bio}</p>}
```

The rest of the file (the `REQUEST CV` button, `// ACHIEVEMENTS` heading, and the `projects.map(...)` list using `projects`) is unchanged — it already references the local `projects` variable.

- [ ] **Step 2: Typecheck + build**

Run: `npx astro check 2>/dev/null || true` then `npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Verify rendering end-to-end**

Create a local content dir with an about.yaml and drive the page:

```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/blogs"
cat > "$SCRATCH/about.yaml" <<'YAML'
headline: "Greg — software engineer"
bio: "Short background summary."
projects:
  - start: 2021
    end: 2023
    description: "Confidential project."
    responsibilities: "Led it."
    deliveries: "Shipped it."
YAML
cp config.example.yaml config.yaml
CONTENT_LOCAL_DIR="$SCRATCH" CONFIG_PATH=./config.yaml npx astro dev --port 4396 &
sleep 4
curl -s http://localhost:4396/about | grep -o 'ABOUT.*software engineer\|Confidential project\|no entries listed' | head
kill %1
```

Expected: output contains `Confidential project` (about.yaml rendered). Then remove `about.yaml` and repeat the curl → expect `no entries listed` (graceful empty state).

- [ ] **Step 4: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat(about): render About page from content store's about.yaml"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — expected: all pass (includes the new `about.test.ts` + content-store + config cases).
- [ ] `npm run build` — clean.
- [ ] Grep for stragglers: `grep -rn "about.projects\|about.bio\|about.headline" src` — expected: no matches in `src/` (only the local `projects`/`bio`/`headline` variables in `about.astro`, which are fine).
