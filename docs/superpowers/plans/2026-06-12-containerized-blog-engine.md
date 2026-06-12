# Containerized Blog Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless, containerized Astro SSR blog engine that renders markdown live from a periodically git-pulled content repo, with a RobCo/Pip-Boy terminal aesthetic.

**Architecture:** A single Node process runs the Astro `@astrojs/node` standalone server. A background sync worker shallow-clones a content git repo into a cache dir and periodically `git fetch` + `git reset --hard`s it. After each sync it diffs files by git blob hash and re-renders only changed markdown into an in-memory index. SSR routes read from that index, so new posts go live on the next request after a sync — no rebuild, no restart.

**Tech Stack:** Astro 5 (SSR) · `@astrojs/node` · TypeScript · Vitest · `yaml` · `zod` · `gray-matter` · `unified`/`remark`/`rehype` + `@shikijs/rehype` · vanilla-JS islands · Docker Buildx (multi-arch).

---

## File Structure & Responsibilities

```
src/lib/paths.ts          # pure: content-path -> {date, slug, url}
src/lib/config.ts         # load + zod-validate YAML config; memoized singleton
src/lib/frontmatter.ts    # gray-matter + zod frontmatter parse
src/lib/markdown.ts       # unified pipeline + relative-asset URL rewrite
src/lib/git.ts            # clone / fetch-reset / ls-tree blob listing (execFile git)
src/lib/content-store.ts  # in-memory index, sync worker, getPost/listPosts/getContentRoot
src/layouts/Terminal.astro
src/pages/index.astro                              # terminal listing + Matrix island
src/pages/[year]/[month]/[day]/[slug].astro        # post page (SSR)
src/pages/[year]/[month]/[day]/assets/[...file].ts # asset file route
src/components/MatrixRain.astro
src/components/Typewriter.astro
src/components/ClickSound.astro
src/styles/theme.css
Dockerfile · docker-compose.yml · config.example.yaml
.github/workflows/build.yml
```

Test files live beside source under `test/` mirroring `src/lib/`.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `astro.config.mjs`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `src/env.d.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
.astro/
cache/
*.local
.DS_Store
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
dist
.astro
cache
.git
docs
test
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "blog-engine",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "start": "node ./dist/server/entry.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@astrojs/node": "^9.0.0",
    "@shikijs/rehype": "^1.24.0",
    "astro": "^5.0.0",
    "gray-matter": "^4.0.3",
    "rehype-raw": "^7.0.0",
    "rehype-stringify": "^10.0.1",
    "remark-gfm": "^4.0.0",
    "remark-parse": "^11.0.0",
    "remark-rehype": "^11.1.1",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.0.0",
    "yaml": "^2.6.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "types": ["node"],
    "verbatimModuleSyntax": false
  },
  "include": ["src", "test", "*.config.*"],
  "exclude": ["dist", "node_modules", "cache"]
}
```

- [ ] **Step 5: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true },
});
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: Create `src/env.d.ts`**

```ts
/// <reference types="astro/client" />
```

- [ ] **Step 8: Create `test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Install deps and run the smoke test**

Run: `npm install && npm test`
Expected: install succeeds; Vitest reports `1 passed`.

- [ ] **Step 10: Verify the project builds**

Run: `npm run build`
Expected: build succeeds and produces `dist/server/entry.mjs`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Astro SSR project with Vitest"
```

---

## Task 2: Path derivation (`src/lib/paths.ts`)

**Files:**
- Create: `src/lib/paths.ts`
- Test: `test/lib/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parsePostPath } from '../../src/lib/paths';

describe('parsePostPath', () => {
  it('parses a valid dated post path', () => {
    expect(parsePostPath('2026/06/12/my-post.md')).toEqual({
      year: '2026',
      month: '06',
      day: '12',
      slug: 'my-post',
      date: '2026-06-12',
      url: '/2026/06/12/my-post',
      urlPrefix: '/2026/06/12',
    });
  });

  it('returns null for non-dated paths', () => {
    expect(parsePostPath('README.md')).toBeNull();
    expect(parsePostPath('2026/06/my-post.md')).toBeNull();
    expect(parsePostPath('2026/06/12/notes.txt')).toBeNull();
    expect(parsePostPath('2026/6/12/my-post.md')).toBeNull();
  });

  it('rejects nested slugs and assets', () => {
    expect(parsePostPath('2026/06/12/assets/diagram.png')).toBeNull();
    expect(parsePostPath('2026/06/12/sub/post.md')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/paths.test.ts`
Expected: FAIL — cannot find module `paths`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface PostPathInfo {
  year: string;
  month: string;
  day: string;
  slug: string;
  date: string;
  url: string;
  urlPrefix: string;
}

const POST_PATH = /^(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\.md$/;

export function parsePostPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, year, month, day, slug] = match;
  const urlPrefix = `/${year}/${month}/${day}`;
  return {
    year,
    month,
    day,
    slug,
    date: `${year}-${month}-${day}`,
    url: `${urlPrefix}/${slug}`,
    urlPrefix,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/paths.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts test/lib/paths.test.ts
git commit -m "feat: parse dated content paths into post metadata"
```

---

## Task 3: Config loader (`src/lib/config.ts`)

**Files:**
- Create: `src/lib/config.ts`
- Test: `test/lib/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/lib/config';

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, contents);
  return path;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('loads a full config and applies defaults', () => {
    const path = writeConfig(`
site:
  title: "RobCo Termlink"
content:
  repo: "https://github.com/you/content.git"
`);
    dirs.push(join(path, '..'));
    const cfg = loadConfig(path);
    expect(cfg.site.title).toBe('RobCo Termlink');
    expect(cfg.content.repo).toBe('https://github.com/you/content.git');
    expect(cfg.content.branch).toBe('main');
    expect(cfg.content.subdir).toBe('');
    expect(cfg.content.syncIntervalSeconds).toBe(300);
    expect(cfg.effects).toEqual({ matrixRain: true, typewriter: true, clickSound: true });
    expect(cfg.server.port).toBe(4321);
  });

  it('throws a clear error when required fields are missing', () => {
    const path = writeConfig(`site:\n  title: "x"\n`);
    dirs.push(join(path, '..'));
    expect(() => loadConfig(path)).toThrow(/content\.repo/);
  });

  it('throws when the file does not exist', () => {
    expect(() => loadConfig('/no/such/config.yaml')).toThrow(/config/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — cannot find module `config`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ConfigSchema = z.object({
  site: z.object({
    title: z.string(),
    description: z.string().default(''),
    baseUrl: z.string().optional(),
  }),
  content: z.object({
    repo: z.string(),
    branch: z.string().default('main'),
    subdir: z.string().default(''),
    syncIntervalSeconds: z.number().int().positive().default(300),
  }),
  effects: z
    .object({
      matrixRain: z.boolean().default(true),
      typewriter: z.boolean().default(true),
      clickSound: z.boolean().default(true),
    })
    .default({}),
  server: z
    .object({ port: z.number().int().positive().default(4321) })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}`);
  }
  const raw = parseYaml(readFileSync(path, 'utf8')) ?? {};
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid config (${path}): ${issues}`);
  }
  return result.data;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    cached = loadConfig(process.env.CONFIG_PATH ?? './config.yaml');
  }
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts
git commit -m "feat: load and validate YAML config with defaults"
```

---

## Task 4: Frontmatter parsing (`src/lib/frontmatter.ts`)

**Files:**
- Create: `src/lib/frontmatter.ts`
- Test: `test/lib/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/lib/frontmatter';

describe('parseFrontmatter', () => {
  it('parses frontmatter and returns body', () => {
    const raw = `---\ntitle: "Hello"\ndescription: "A post"\ndraft: true\n---\n# Body\n`;
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({ title: 'Hello', description: 'A post', draft: true });
    expect(content.trim()).toBe('# Body');
  });

  it('defaults draft to false and allows missing title', () => {
    const { data } = parseFrontmatter(`---\ndescription: "x"\n---\nbody\n`);
    expect(data.draft).toBe(false);
    expect(data.title).toBeUndefined();
  });

  it('throws on wrong field types', () => {
    expect(() => parseFrontmatter(`---\ntitle: 5\n---\nbody`)).toThrow(/title/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/frontmatter.test.ts`
Expected: FAIL — cannot find module `frontmatter`.

- [ ] **Step 3: Write minimal implementation**

```ts
import matter from 'gray-matter';
import { z } from 'zod';

const FrontmatterSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
});

export type PostFrontmatter = z.infer<typeof FrontmatterSchema>;

export function parseFrontmatter(raw: string): {
  data: PostFrontmatter;
  content: string;
} {
  const parsed = matter(raw);
  const result = FrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter: ${issues}`);
  }
  return { data: result.data, content: parsed.content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/frontmatter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/frontmatter.ts test/lib/frontmatter.test.ts
git commit -m "feat: parse and validate post frontmatter"
```

---

## Task 5: Markdown rendering + asset rewrite (`src/lib/markdown.ts`)

**Files:**
- Create: `src/lib/markdown.ts`
- Test: `test/lib/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

describe('renderMarkdown', () => {
  it('renders markdown to HTML', async () => {
    const html = await renderMarkdown('# Title\n\nHello **world**', '/2026/06/12');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>world</strong>');
  });

  it('rewrites relative ./assets and assets/ image URLs to absolute', async () => {
    const html = await renderMarkdown(
      '![d](./assets/diagram.png)\n\n![e](assets/photo.jpg)',
      '/2026/06/12'
    );
    expect(html).toContain('src="/2026/06/12/assets/diagram.png"');
    expect(html).toContain('src="/2026/06/12/assets/photo.jpg"');
  });

  it('leaves absolute and external URLs untouched', async () => {
    const html = await renderMarkdown(
      '![a](/already/abs.png)\n\n![b](https://x.com/i.png)',
      '/2026/06/12'
    );
    expect(html).toContain('src="/already/abs.png"');
    expect(html).toContain('src="https://x.com/i.png"');
  });

  it('highlights fenced code blocks', async () => {
    const html = await renderMarkdown('```js\nconst x = 1;\n```', '/2026/06/12');
    expect(html).toContain('<pre');
    expect(html).toContain('shiki');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/markdown.test.ts`
Expected: FAIL — cannot find module `markdown`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeShiki from '@shikijs/rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

const RELATIVE = /^(?:\.\/)?assets\//;

function rewriteAssets(urlPrefix: string) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const attr =
        node.tagName === 'img'
          ? 'src'
          : node.tagName === 'a'
            ? 'href'
            : null;
      if (!attr) return;
      const value = node.properties?.[attr];
      if (typeof value === 'string' && RELATIVE.test(value)) {
        node.properties![attr] = `${urlPrefix}/${value.replace(/^\.\//, '')}`;
      }
    });
  };
}

export async function renderMarkdown(
  content: string,
  urlPrefix: string
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeShiki, { theme: 'github-dark' })
    .use(rewriteAssets, urlPrefix)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content);
  return String(file);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/markdown.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown.ts test/lib/markdown.test.ts
git commit -m "feat: render markdown with Shiki and rewrite relative asset URLs"
```

---

## Task 6: Git wrappers (`src/lib/git.ts`)

**Files:**
- Create: `src/lib/git.ts`
- Test: `test/lib/git.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyToken, cloneRepo, fetchReset, lsTreeBlobs } from '../../src/lib/git';

let originDir: string;
let workDir: string;

function git(dir: string, ...args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

beforeAll(() => {
  originDir = mkdtempSync(join(tmpdir(), 'origin-'));
  workDir = mkdtempSync(join(tmpdir(), 'work-'));
  git(originDir, 'init', '-b', 'main');
  git(originDir, 'config', 'user.email', 't@t.t');
  git(originDir, 'config', 'user.name', 'T');
  mkdirSync(join(originDir, '2026/06/12'), { recursive: true });
  writeFileSync(join(originDir, '2026/06/12/a.md'), '---\ntitle: A\n---\nbody');
  git(originDir, 'add', '-A');
  git(originDir, 'commit', '-m', 'init');
});

afterAll(() => {
  rmSync(originDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

describe('applyToken', () => {
  it('splices a token into an https URL', () => {
    expect(applyToken('https://github.com/u/r.git', 'TKN')).toBe(
      'https://x-access-token:TKN@github.com/u/r.git'
    );
  });
  it('returns the URL unchanged without a token', () => {
    expect(applyToken('https://github.com/u/r.git', undefined)).toBe(
      'https://github.com/u/r.git'
    );
  });
});

describe('git operations', () => {
  it('clones, lists blobs, and reflects new commits after fetchReset', async () => {
    const dest = join(workDir, 'clone');
    await cloneRepo({ repo: originDir, branch: 'main', dir: dest });
    let blobs = await lsTreeBlobs(dest);
    expect([...blobs.keys()]).toContain('2026/06/12/a.md');
    const firstHash = blobs.get('2026/06/12/a.md');

    writeFileSync(join(originDir, '2026/06/12/a.md'), '---\ntitle: A2\n---\nbody2');
    git(originDir, 'commit', '-am', 'update');

    await fetchReset({ dir: dest, branch: 'main' });
    blobs = await lsTreeBlobs(dest);
    expect(blobs.get('2026/06/12/a.md')).not.toBe(firstHash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/git.test.ts`
Expected: FAIL — cannot find module `git`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const run = promisify(execFile);

export function applyToken(repo: string, token: string | undefined): string {
  if (!token) return repo;
  return repo.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 1024 * 1024 * 64 });
  return stdout;
}

export interface CloneOptions {
  repo: string;
  branch: string;
  dir: string;
  token?: string;
}

export async function cloneRepo(opts: CloneOptions): Promise<void> {
  const url = applyToken(opts.repo, opts.token);
  await git([
    'clone',
    '--depth',
    '1',
    '--branch',
    opts.branch,
    '--single-branch',
    url,
    opts.dir,
  ]);
}

export async function fetchReset(opts: {
  dir: string;
  branch: string;
}): Promise<void> {
  await git(['fetch', '--depth', '1', 'origin', opts.branch], opts.dir);
  await git(['reset', '--hard', `origin/${opts.branch}`], opts.dir);
  await git(['clean', '-fd'], opts.dir);
}

/** Map of repo-relative path -> git blob hash for all tracked files. */
export async function lsTreeBlobs(dir: string): Promise<Map<string, string>> {
  if (!existsSync(dir)) return new Map();
  const out = await git(['ls-tree', '-r', 'HEAD'], dir);
  const map = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (!line) continue;
    // format: "<mode> blob <hash>\t<path>"
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const path = line.slice(tab + 1);
    if (meta[1] === 'blob') map.set(path, meta[2]);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/git.test.ts`
Expected: PASS (4 tests). Note: requires `git` on PATH.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git.ts test/lib/git.test.ts
git commit -m "feat: git clone/fetch-reset/ls-tree wrappers with token auth"
```

---

## Task 7: Content store + sync worker (`src/lib/content-store.ts`)

**Files:**
- Create: `src/lib/content-store.ts`
- Test: `test/lib/content-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContentStore } from '../../src/lib/content-store';

let originDir: string;
let cacheDir: string;

function git(dir: string, ...args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}
function commitFile(rel: string, body: string) {
  const full = join(originDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(originDir, 'add', '-A');
  git(originDir, 'commit', '-m', rel);
}

beforeEach(() => {
  originDir = mkdtempSync(join(tmpdir(), 'origin-'));
  cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
  rmSync(cacheDir, { recursive: true, force: true }); // store will clone into it
  git(originDir, 'init', '-b', 'main');
  git(originDir, 'config', 'user.email', 't@t.t');
  git(originDir, 'config', 'user.name', 'T');
  commitFile('2026/06/12/first.md', '---\ntitle: First\n---\nHello');
  commitFile('2026/06/10/older.md', '---\ntitle: Older\n---\nOld');
  commitFile('2026/06/11/draft.md', '---\ntitle: Draft\ndraft: true\n---\nWIP');
});

afterEach(() => {
  rmSync(originDir, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

function makeStore() {
  return new ContentStore({
    repo: originDir,
    branch: 'main',
    subdir: '',
    cacheDir,
  });
}

describe('ContentStore', () => {
  it('indexes posts and sorts them newest-first, excluding drafts from the list', async () => {
    const store = makeStore();
    await store.start();
    const posts = store.listPosts();
    expect(posts.map((p) => p.slug)).toEqual(['first', 'older']);
    expect(posts[0].date).toBe('2026-06-12');
    expect(posts[0].title).toBe('First');
    expect(store.getPost('/2026/06/12/first')?.html).toContain('Hello');
  });

  it('keeps drafts retrievable by URL but flagged', async () => {
    const store = makeStore();
    await store.start();
    const draft = store.getPost('/2026/06/11/draft');
    expect(draft?.draft).toBe(true);
  });

  it('reindexes only changed files after a sync', async () => {
    const store = makeStore();
    await store.start();
    const olderHashBefore = store.getPost('/2026/06/10/older')!.blobHash;

    commitFile('2026/06/12/first.md', '---\ntitle: First v2\n---\nHello again');
    commitFile('2026/06/13/new.md', '---\ntitle: New\n---\nFresh');

    const changed = await store.sync();
    // only the changed and the new file are reprocessed — not the untouched one
    expect(changed.sort()).toEqual(['2026/06/12/first.md', '2026/06/13/new.md']);
    expect(store.getPost('/2026/06/12/first')!.title).toBe('First v2');
    expect(store.getPost('/2026/06/13/new')!.title).toBe('New');
    // untouched post kept its identity (same blob hash, never re-rendered)
    expect(store.getPost('/2026/06/10/older')!.blobHash).toBe(olderHashBefore);
  });

  it('drops posts whose files were removed', async () => {
    const store = makeStore();
    await store.start();
    git(originDir, 'rm', '2026/06/10/older.md');
    git(originDir, 'commit', '-m', 'remove older');
    await store.sync();
    expect(store.getPost('/2026/06/10/older')).toBeUndefined();
  });

  it('resolves asset file paths under the content root with traversal guard', async () => {
    const store = makeStore();
    await store.start();
    expect(store.resolveAssetPath('2026', '06', '12', 'd.png')).toBe(
      join(cacheDir, '2026/06/12/assets/d.png')
    );
    expect(store.resolveAssetPath('2026', '06', '12', '../../../etc/passwd')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: FAIL — cannot find module `content-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { cloneRepo, fetchReset, lsTreeBlobs } from './git';
import { parsePostPath } from './paths';
import { parseFrontmatter } from './frontmatter';
import { renderMarkdown } from './markdown';

export interface Post {
  url: string;
  urlPrefix: string;
  year: string;
  month: string;
  day: string;
  date: string;
  slug: string;
  title: string;
  description?: string;
  draft: boolean;
  html: string;
  blobHash: string;
}

export interface ContentStoreOptions {
  repo: string;
  branch: string;
  subdir: string;
  cacheDir: string;
  token?: string;
}

export class ContentStore {
  private index = new Map<string, Post>();
  private started = false;

  constructor(private opts: ContentStoreOptions) {}

  private contentRoot(): string {
    return this.opts.subdir
      ? join(this.opts.cacheDir, this.opts.subdir)
      : this.opts.cacheDir;
  }

  /** Repo-relative path -> content-root-relative path, or null if outside subdir. */
  private toContentRel(repoRel: string): string | null {
    if (!this.opts.subdir) return repoRel;
    const prefix = `${this.opts.subdir.replace(/\/$/, '')}/`;
    return repoRel.startsWith(prefix) ? repoRel.slice(prefix.length) : null;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!existsSync(join(this.opts.cacheDir, '.git'))) {
      await cloneRepo({
        repo: this.opts.repo,
        branch: this.opts.branch,
        dir: this.opts.cacheDir,
        token: this.opts.token,
      });
    }
    await this.reindex();
  }

  /** git fetch + reset, then reindex. Returns content-root-relative paths that changed. */
  async sync(): Promise<string[]> {
    await fetchReset({ dir: this.opts.cacheDir, branch: this.opts.branch });
    return this.reindex();
  }

  private async reindex(): Promise<string[]> {
    const blobs = await lsTreeBlobs(this.opts.cacheDir);
    const seenUrls = new Set<string>();
    const changed: string[] = [];

    for (const [repoRel, hash] of blobs) {
      const contentRel = this.toContentRel(repoRel);
      if (contentRel === null) continue;
      const info = parsePostPath(contentRel);
      if (!info) continue;
      seenUrls.add(info.url);
      const existing = this.index.get(info.url);
      if (existing && existing.blobHash === hash) continue;

      const raw = readFileSync(join(this.contentRoot(), contentRel), 'utf8');
      try {
        const { data, content } = parseFrontmatter(raw);
        const html = await renderMarkdown(content, info.urlPrefix);
        this.index.set(info.url, {
          url: info.url,
          urlPrefix: info.urlPrefix,
          year: info.year,
          month: info.month,
          day: info.day,
          date: info.date,
          slug: info.slug,
          title: data.title ?? info.slug,
          description: data.description,
          draft: data.draft,
          html,
          blobHash: hash,
        });
        changed.push(contentRel);
      } catch (err) {
        console.warn(`Skipping ${contentRel}: ${(err as Error).message}`);
      }
    }

    for (const url of [...this.index.keys()]) {
      if (!seenUrls.has(url)) this.index.delete(url);
    }
    return changed;
  }

  listPosts(): Post[] {
    return [...this.index.values()]
      .filter((p) => !p.draft)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getPost(url: string): Post | undefined {
    return this.index.get(url);
  }

  resolveAssetPath(
    year: string,
    month: string,
    day: string,
    file: string
  ): string | null {
    const baseDir = join(this.contentRoot(), year, month, day, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/content-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-store.ts test/lib/content-store.test.ts
git commit -m "feat: in-memory content store with blob-hash reindex and sync"
```

---

## Task 8: Store singleton + sync loop (`src/lib/store-singleton.ts`)

**Files:**
- Create: `src/lib/store-singleton.ts`
- Test: `test/lib/store-singleton.test.ts`

This wires `ContentStore` to `getConfig()` and an interval timer, and exposes one idempotent `ensureStarted()` for the Astro routes to await.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { __resetStoreForTests, getStore } from '../../src/lib/store-singleton';

afterEach(() => __resetStoreForTests());

describe('store-singleton', () => {
  it('returns the same store instance on repeated calls', () => {
    const a = getStore({
      repo: 'r',
      branch: 'main',
      subdir: '',
      cacheDir: '/tmp/x',
    });
    const b = getStore({
      repo: 'r',
      branch: 'main',
      subdir: '',
      cacheDir: '/tmp/x',
    });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/store-singleton.test.ts`
Expected: FAIL — cannot find module `store-singleton`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { ContentStore, type ContentStoreOptions } from './content-store';
import { getConfig } from './config';

let store: ContentStore | undefined;
let startPromise: Promise<void> | undefined;
let timer: NodeJS.Timeout | undefined;

export function getStore(opts: ContentStoreOptions): ContentStore {
  if (!store) store = new ContentStore(opts);
  return store;
}

/** Idempotent: clones + first index once, then starts the periodic sync loop. */
export async function ensureStarted(): Promise<ContentStore> {
  const cfg = getConfig();
  const s = getStore({
    repo: cfg.content.repo,
    branch: cfg.content.branch,
    subdir: cfg.content.subdir,
    cacheDir: process.env.CACHE_DIR ?? './cache',
    token: process.env.CONTENT_REPO_TOKEN,
  });
  if (!startPromise) {
    startPromise = s.start().then(() => {
      timer = setInterval(() => {
        s.sync().catch((err) =>
          console.error(`Sync failed: ${(err as Error).message}`)
        );
      }, cfg.content.syncIntervalSeconds * 1000);
      timer.unref?.();
    });
  }
  await startPromise;
  return s;
}

export function __resetStoreForTests(): void {
  store = undefined;
  startPromise = undefined;
  if (timer) clearInterval(timer);
  timer = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/store-singleton.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store-singleton.ts test/lib/store-singleton.test.ts
git commit -m "feat: content store singleton with periodic sync loop"
```

---

## Task 9: Theme styles (`src/styles/theme.css`)

**Files:**
- Create: `src/styles/theme.css`

- [ ] **Step 1: Create the stylesheet**

```css
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');

:root {
  --bg: #0b0f0b;
  --fg: #33ff66;
  --fg-dim: #1f9a3f;
  --accent: #b6ff00;
  --font: 'VT323', monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
  font-size: 22px;
  line-height: 1.4;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.crt::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0,
    rgba(0, 0, 0, 0) 2px,
    rgba(0, 0, 0, 0.18) 3px
  );
  z-index: 50;
}

.container { max-width: 820px; margin: 0 auto; padding: 2rem 1.25rem; position: relative; z-index: 2; }

pre { padding: 1rem; overflow-x: auto; border: 1px solid var(--fg-dim); }
img { max-width: 100%; }

.cursor { display: inline-block; width: 0.6ch; background: var(--fg); animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }

.post-list { list-style: none; padding: 0; }
.post-list li { white-space: pre; }

@media (prefers-reduced-motion: reduce) {
  .cursor { animation: none; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/theme.css
git commit -m "feat: RobCo terminal theme stylesheet"
```

---

## Task 10: Interactive islands

**Files:**
- Create: `src/components/MatrixRain.astro`, `src/components/Typewriter.astro`, `src/components/ClickSound.astro`

These are client-side, progressive-enhancement islands. Verification is via build + manual browser check (Task 13).

- [ ] **Step 1: Create `src/components/MatrixRain.astro`**

```astro
---
// Falling-glyph canvas backdrop. Renders nothing meaningful without JS.
---
<canvas id="matrix-rain" aria-hidden="true"></canvas>
<style>
  #matrix-rain { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; opacity: 0.35; }
</style>
<script>
  const canvas = document.getElementById('matrix-rain') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glyphs = 'アイウエオカキクケコ0123456789ABCDEF<>/'.split('');
  let cols: number[] = [];
  const fontSize = 18;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = new Array(Math.ceil(canvas.width / fontSize)).fill(0);
  }
  resize();
  window.addEventListener('resize', resize);

  function frame() {
    ctx.fillStyle = 'rgba(11, 15, 11, 0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#33ff66';
    ctx.font = `${fontSize}px monospace`;
    for (let i = 0; i < cols.length; i++) {
      const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillText(ch, i * fontSize, cols[i] * fontSize);
      if (cols[i] * fontSize > canvas.height && Math.random() > 0.975) cols[i] = 0;
      cols[i]++;
    }
  }

  if (reduce) {
    frame();
  } else {
    let running = true;
    const loop = () => { if (running) { frame(); requestAnimationFrame(loop); } };
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) loop();
    });
    loop();
  }
</script>
```

- [ ] **Step 2: Create `src/components/Typewriter.astro`**

```astro
---
// Reveals already-rendered slotted HTML character-by-character over text nodes.
// Without JS (or with reduced motion), the full content is visible immediately.
---
<div id="typewriter" data-typewriter><slot /></div>
<script>
  const root = document.getElementById('typewriter')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; full: string }[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      nodes.push({ node: t, full: t.data });
      t.data = '';
    }
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    cursor.textContent = ' ';
    root.appendChild(cursor);

    let ni = 0, ci = 0;
    let done = false;
    function reveal() {
      if (ni >= nodes.length) { finish(); return; }
      const cur = nodes[ni];
      cur.node.data = cur.full.slice(0, ++ci);
      if (ci >= cur.full.length) { ni++; ci = 0; }
    }
    function finish() {
      if (done) return;
      done = true;
      for (const { node, full } of nodes) node.data = full;
      cursor.remove();
      clearInterval(timer);
    }
    const timer = setInterval(reveal, 12);
    root.addEventListener('click', finish);
  }
</script>
```

- [ ] **Step 3: Create `src/components/ClickSound.astro`**

```astro
---
// Web Audio click feedback on link/button activation. Default ON, mutable, persisted.
---
<button id="sound-toggle" type="button" aria-label="Toggle sound"></button>
<style>
  #sound-toggle {
    position: fixed; top: 0.5rem; right: 0.5rem; z-index: 60;
    background: transparent; color: var(--fg); border: 1px solid var(--fg-dim);
    font-family: var(--font); font-size: 16px; cursor: pointer; padding: 0.1rem 0.4rem;
  }
</style>
<script>
  const KEY = 'blog-sound-muted';
  const toggle = document.getElementById('sound-toggle') as HTMLButtonElement;
  let muted = localStorage.getItem(KEY) === '1';
  let ctx: AudioContext | null = null;

  function render() { toggle.textContent = muted ? '[ SND OFF ]' : '[ SND ON ]'; }
  render();

  function blip() {
    if (muted) return;
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('a, button') && t.id !== 'sound-toggle') blip();
  });

  toggle.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem(KEY, muted ? '1' : '0');
    render();
  });
</script>
```

- [ ] **Step 4: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds (component scripts compile).

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "feat: Matrix rain, typewriter, and click-sound islands"
```

---

## Task 11: Layout + pages (terminal listing, post, assets)

**Files:**
- Create: `src/layouts/Terminal.astro`, `src/pages/index.astro`, `src/pages/[year]/[month]/[day]/[slug].astro`, `src/pages/[year]/[month]/[day]/assets/[...file].ts`

- [ ] **Step 1: Create `src/layouts/Terminal.astro`**

```astro
---
import '../styles/theme.css';
import ClickSound from '../components/ClickSound.astro';
import { getConfig } from '../lib/config';

interface Props { title?: string; clickSound?: boolean }
const { title } = Astro.props;
const cfg = getConfig();
const pageTitle = title ? `${title} — ${cfg.site.title}` : cfg.site.title;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{pageTitle}</title>
    {cfg.site.description && <meta name="description" content={cfg.site.description} />}
  </head>
  <body class="crt">
    {cfg.effects.clickSound && <ClickSound />}
    <slot name="background" />
    <main class="container">
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Create `src/pages/index.astro`**

```astro
---
import Terminal from '../layouts/Terminal.astro';
import MatrixRain from '../components/MatrixRain.astro';
import { ensureStarted } from '../lib/store-singleton';
import { getConfig } from '../lib/config';

const cfg = getConfig();
const store = await ensureStarted();
const posts = store.listPosts();
---
<Terminal>
  {cfg.effects.matrixRain && <MatrixRain slot="background" />}
  <h1>&gt; {cfg.site.title}<span class="cursor"> </span></h1>
  {cfg.site.description && <p>{cfg.site.description}</p>}
  <ul class="post-list">
    {posts.map((p) => (
      <li>&gt; {p.date.replace(/-/g, '.')}  <a href={p.url}>{p.title}</a></li>
    ))}
    {posts.length === 0 && <li>&gt; no log entries found.</li>}
  </ul>
</Terminal>
```

- [ ] **Step 3: Create `src/pages/[year]/[month]/[day]/[slug].astro`**

```astro
---
import Terminal from '../../../../layouts/Terminal.astro';
import Typewriter from '../../../../components/Typewriter.astro';
import { ensureStarted } from '../../../../lib/store-singleton';
import { getConfig } from '../../../../lib/config';

const cfg = getConfig();
const { year, month, day, slug } = Astro.params;
const store = await ensureStarted();
const post = store.getPost(`/${year}/${month}/${day}/${slug}`);

if (!post || post.draft) {
  return new Response('Not found', { status: 404 });
}
---
<Terminal title={post.title}>
  <p><a href="/">&lt; back</a></p>
  <article>
    <h1>{post.title}</h1>
    <p class="meta">{post.date}</p>
    {cfg.effects.typewriter
      ? <Typewriter><Fragment set:html={post.html} /></Typewriter>
      : <Fragment set:html={post.html} />}
  </article>
</Terminal>
```

- [ ] **Step 4: Create `src/pages/[year]/[month]/[day]/assets/[...file].ts`**

```ts
import type { APIRoute } from 'astro';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { ensureStarted } from '../../../../../lib/store-singleton';

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
  const { year, month, day, file } = params;
  if (!year || !month || !day || !file) return new Response('Not found', { status: 404 });

  const store = await ensureStarted();
  const path = store.resolveAssetPath(year, month, day, file);
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

- [ ] **Step 5: Verify the project builds**

Run: `npm run build`
Expected: build succeeds and produces `dist/server/entry.mjs`.

- [ ] **Step 6: Commit**

```bash
git add src/layouts src/pages
git commit -m "feat: terminal layout, index listing, post page, and asset route"
```

---

## Task 12: Config template, Dockerfile, compose

**Files:**
- Create: `config.example.yaml`, `Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Create `config.example.yaml`**

```yaml
site:
  title: "RobCo Termlink"
  description: "Personal log"
  # baseUrl: "https://blog.example.com"   # optional
content:
  repo: "https://github.com/you/blog-content.git"
  branch: "main"
  subdir: ""                # optional: content lives in a subfolder of the repo
  syncIntervalSeconds: 300
effects:
  matrixRain: true
  typewriter: true
  clickSound: true          # default ON; readers get a persisted mute toggle
server:
  port: 4321
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache git
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV CONFIG_PATH=/config/config.yaml
ENV CACHE_DIR=/tmp/content-cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /tmp/content-cache && chown -R app:app /app /tmp/content-cache
USER app
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  blog:
    build: .
    ports:
      - "4321:4321"
    environment:
      # CONTENT_REPO_TOKEN: "ghp_xxx"   # only for private content repos
      PORT: "4321"
      HOST: "0.0.0.0"
      CONFIG_PATH: /config/config.yaml
    volumes:
      - ./config.yaml:/config/config.yaml:ro
```

- [ ] **Step 4: Build the image locally**

Run: `docker build -t blog-engine:dev .`
Expected: image builds successfully through both stages.

- [ ] **Step 5: Commit**

```bash
git add config.example.yaml Dockerfile docker-compose.yml
git commit -m "feat: config template, multi-stage Dockerfile, and compose example"
```

---

## Task 13: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Create a throwaway local content repo**

```bash
mkdir -p /tmp/content/2026/06/12/assets
printf -- '---\ntitle: First Post\ndescription: hello\n---\n# Hello\n\nSome **bold** text and code:\n\n```js\nconst x = 1;\n```\n\n![diagram](./assets/d.svg)\n' > /tmp/content/2026/06/12/first-post.md
printf '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%2333ff66"/></svg>' > /tmp/content/2026/06/12/assets/d.svg
git -C /tmp/content init -b main && git -C /tmp/content add -A && git -C /tmp/content -c user.email=t@t.t -c user.name=t commit -m init
```

- [ ] **Step 2: Create a local `config.yaml` pointing at it**

```bash
cp config.example.yaml config.yaml
# edit config.yaml: set content.repo to "file:///tmp/content"
```

Run: `sed -i '' 's#https://github.com/you/blog-content.git#file:///tmp/content#' config.yaml` (macOS sed)

- [ ] **Step 3: Run the built server**

Run: `CACHE_DIR=./cache CONFIG_PATH=./config.yaml npm run build && CACHE_DIR=./cache CONFIG_PATH=./config.yaml npm start`
Expected: server logs it is listening on port 4321.

- [ ] **Step 4: Verify in a browser (or curl)**

- Visit `http://localhost:4321/` — Matrix rain behind a listing showing `> 2026.06.12  First Post`.
- Click the post — typewriter reveals the body; code block is highlighted; the SVG asset loads.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/2026/06/12/assets/d.svg` → `200`.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/2026/06/12/nope` → `404`.
- Toggle `[ SND ON ]` / `[ SND OFF ]`; reload and confirm the choice persists.

- [ ] **Step 5: Verify instant-live sync**

```bash
printf -- '---\ntitle: Second Post\n---\nfresh\n' > /tmp/content/2026/06/13/second.md 2>/dev/null || (mkdir -p /tmp/content/2026/06/13 && printf -- '---\ntitle: Second Post\n---\nfresh\n' > /tmp/content/2026/06/13/second.md)
git -C /tmp/content add -A && git -C /tmp/content -c user.email=t@t.t -c user.name=t commit -m second
```

Wait up to `syncIntervalSeconds`, reload `/` — `Second Post` appears with no restart.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit any fixes found during verification**

```bash
git add -A && git commit -m "fix: address issues found in end-to-end verification"
```

(Skip if nothing changed.)

---

## Task 14: Multi-arch CI build (`.github/workflows/build.yml`)

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: build-image

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-qemu-action@v3

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=sha

      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate workflow YAML syntax**

Run: `npx --yes js-yaml .github/workflows/build.yml >/dev/null && echo OK`
Expected: prints `OK` (valid YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: multi-arch (amd64+arm64) image build and push to GHCR"
```

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

````markdown
# Blog Engine

A stateless, containerized Astro SSR blog engine with a RobCo/Pip-Boy terminal aesthetic.
Content lives in a **separate git repo** organized as `YYYY/MM/DD/<slug>.md` (with a sibling
`assets/` dir per day). The engine periodically `git pull`s that repo and renders markdown
live — no rebuild, no restart.

## Content repo layout

```
2026/06/12/my-post.md
2026/06/12/assets/diagram.png   # referenced as ./assets/diagram.png
```

Frontmatter:

```yaml
---
title: "My Post Title"   # optional (falls back to slug)
description: "..."       # optional
draft: false             # optional; drafts hidden from the index, 404 on direct hit
---
```

The date and slug come from the path, not frontmatter.

## Configure

Copy `config.example.yaml` to `config.yaml` and edit it. For a private content repo, pass a
read-only token via the `CONTENT_REPO_TOKEN` environment variable (never put it in the YAML).

## Run with Docker

```bash
docker compose up --build
```

Or pull the published multi-arch image from GHCR and mount your config:

```bash
docker run -p 4321:4321 \
  -v "$PWD/config.yaml:/config/config.yaml:ro" \
  -e CONTENT_REPO_TOKEN=... \
  ghcr.io/<owner>/<repo>:main
```

## Develop

```bash
npm install
npm run dev      # local Astro dev server
npm test         # Vitest
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Notes for the implementer

- **`Fragment set:html`** is how Astro injects a raw HTML string; the `Typewriter` wraps it so the typewriter sees real DOM text nodes.
- **Routing priority:** the literal `assets` segment outranks `[slug]`, so `/Y/M/D/assets/x.png` hits the asset endpoint and `/Y/M/D/slug` hits the post page. Don't rename the `assets` folder.
- **Statelessness:** `CACHE_DIR` defaults to `/tmp/content-cache` in the image; on restart the store re-clones if `.git` is absent. No volume needed.
- **Token safety:** never `console.log` a URL produced by `applyToken`.
- If `@shikijs/rehype`'s default export import shape differs in the installed version, adjust the import in `src/lib/markdown.ts` accordingly (named vs default) — the test in Task 5 will catch it.
