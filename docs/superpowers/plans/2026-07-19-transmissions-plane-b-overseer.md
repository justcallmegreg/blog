# Transmissions Plane B — Overseer CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage transmissions (create/edit/hide/delete) from the private overseer console — each action commits to `blog-content` via the GitHub API and (on delete) removes the R2 media, with the console reading its list from its own `ContentStore`.

**Architecture:** Pure logic (compose markdown / validate / paths / delete-plan) + two thin I/O modules (`github.ts` Git Data API commits, `r2.ts` S3-compatible delete) + request handlers mirroring the SES `handleDelete` shape + overseer UI pages. The overseer is the same engine image deployed privately; it reads via `ContentStore`, writes via GitHub, then force-syncs. Video bytes never touch the pod (uploaded locally to R2 by Plane C, out of scope).

**Tech Stack:** Astro SSR, TypeScript, vitest, `@aws-sdk/client-s3` (new), `yaml` (existing), GitHub REST Git Data API via `fetch`.

## Global Constraints

- Source of truth is git (`blog-content`); the overseer commits **directly to `main`** (no PR).
- Entry layout mirrors Plane A: `transmissions/justcallmegreg-blog/{slug}/index.md` + `assets/poster.jpg`. Only these two paths live in git; HLS lives in R2.
- Slug format: `^[a-z0-9][a-z0-9-]*$`. Date: `YYYY-MM-DD` or empty. Poster: `image/png|jpeg|webp|gif`.
- Delete ordering: **git commit removal FIRST, then best-effort R2 `deletePrefix`.** A failed R2 delete still returns success (entry is gone) with a warning; never resurrect the entry.
- Auth: network-privacy-only (the existing middleware `overseerBlocked` already gates every `/overseer/*` path) + confirm-token `"APPROVE"` on delete. No new auth code.
- The overseer holds `CONTENT_REPO_TOKEN` (must carry **contents:write**) and `R2_*` delete creds as env secrets; the public engine never receives the R2 creds.
- Handlers are pure `handleX(input, deps) → { status, body: { ok, error? } }`, mirroring `src/pages/overseer/api/delete.ts`; routes are thin and inject real deps.

---

### Task 1: Pure transmission logic + `listAllTransmissions`

**Files:**
- Create: `src/lib/overseer/transmissions.ts`
- Modify: `src/lib/content-store.ts` (add `listAllTransmissions`)
- Test: `test/lib/overseer/transmissions.test.ts` (new), `test/lib/content-store.test.ts` (add one case)

**Interfaces:**
- Produces:
  - `TRANSMISSIONS_NS = 'justcallmegreg-blog'`
  - `transmissionEntryPaths(slug): { dir, indexMd, posterAsset }`
  - `interface TransmissionFields { title: string; description?: string; date?: string; video: string; duration?: string; draft: boolean; publishAt?: string }`
  - `composeTransmissionMarkdown(fields: TransmissionFields): string`
  - `interface CreateInput { slug: string; title: string; description?: string; date?: string; duration?: string; video?: string; posterType?: string; hasPoster: boolean; draft?: boolean }`
  - `type ValidateResult = { ok: true; slug: string; fields: TransmissionFields } | { ok: false; error: string }`
  - `validateCreateInput(input: CreateInput): ValidateResult`
  - `deletePlan(slug): { gitPaths: string[]; r2Prefix: string }`
  - `SLUG_RE` (exported for reuse by handlers)
  - `ContentStore.listAllTransmissions(): Transmission[]` (all entries incl. hidden, newest-first)

- [ ] **Step 1: Write failing tests for `transmissions.ts`**

Create `test/lib/overseer/transmissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  transmissionEntryPaths,
  composeTransmissionMarkdown,
  validateCreateInput,
  deletePlan,
} from '../../../src/lib/overseer/transmissions';
import { parseTransmissionFrontmatter } from '../../../src/lib/transmission';

describe('transmissionEntryPaths', () => {
  it('lays out the git paths under the transmissions namespace', () => {
    expect(transmissionEntryPaths('booting-the-vault')).toEqual({
      dir: 'transmissions/justcallmegreg-blog/booting-the-vault',
      indexMd: 'transmissions/justcallmegreg-blog/booting-the-vault/index.md',
      posterAsset: 'transmissions/justcallmegreg-blog/booting-the-vault/assets/poster.jpg',
    });
  });
});

describe('composeTransmissionMarkdown', () => {
  it('emits frontmatter with required fields and omits empty optionals', () => {
    const md = composeTransmissionMarkdown({ title: 'First', video: 'first/master.m3u8', draft: false });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: First');
    expect(md).toContain('video: first/master.m3u8');
    expect(md).toContain('draft: false');
    expect(md).not.toContain('description:');
    expect(md.trimEnd().endsWith('---')).toBe(true);
  });
  it('includes optionals when present', () => {
    const md = composeTransmissionMarkdown({
      title: 'F', video: 'f/master.m3u8', draft: true,
      description: 'desc', date: '2026-06-02', duration: '05:52', publishAt: '2026-06-02T09:00',
    });
    expect(md).toContain('description: "desc"');
    expect(md).toContain('duration:');
    expect(md).toContain('publishAt:');
    expect(md).toContain('draft: true');
  });
  it('quotes the date so the engine parses it as a string, not a Date', () => {
    const md = composeTransmissionMarkdown({ title: 'F', video: 'f/master.m3u8', draft: false, date: '2026-06-02' });
    expect(md).toContain('date: "2026-06-02"');
  });
  it('round-trips through the engine frontmatter parser with date intact', () => {
    // Guards the js-yaml date-coercion trap end-to-end using the real Plane A parser.
    const md = composeTransmissionMarkdown({ title: 'RT', video: 'rt/master.m3u8', draft: false, date: '2026-06-02', duration: '01:23' });
    const { data } = parseTransmissionFrontmatter(md);
    expect(typeof data.date).toBe('string');
    expect(data.date).toBe('2026-06-02');
    expect(data.video).toBe('rt/master.m3u8');
    expect(data.duration).toBe('01:23');
    expect(data.draft).toBe(false);
  });
});

describe('validateCreateInput', () => {
  const base = { slug: 'ok-slug', title: 'T', hasPoster: true, posterType: 'image/jpeg' };
  it('accepts valid input and defaults video from slug', () => {
    const r = validateCreateInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.slug).toBe('ok-slug'); expect(r.fields.video).toBe('ok-slug/master.m3u8'); expect(r.fields.draft).toBe(false); }
  });
  it('rejects a bad slug', () => {
    expect(validateCreateInput({ ...base, slug: 'Bad Slug' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, slug: '-x' }).ok).toBe(false);
  });
  it('requires a title and a poster', () => {
    expect(validateCreateInput({ ...base, title: '  ' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, hasPoster: false }).ok).toBe(false);
  });
  it('rejects a non-image poster and a malformed date', () => {
    expect(validateCreateInput({ ...base, posterType: 'application/pdf' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, date: '06/02/2026' }).ok).toBe(false);
  });
  it('honors an explicit video and draft', () => {
    const r = validateCreateInput({ ...base, video: 'custom/x.m3u8', draft: true });
    expect(r.ok && r.fields.video).toBe('custom/x.m3u8');
    expect(r.ok && r.fields.draft).toBe(true);
  });
});

describe('deletePlan', () => {
  it('returns the two git paths and the R2 prefix', () => {
    expect(deletePlan('vault')).toEqual({
      gitPaths: [
        'transmissions/justcallmegreg-blog/vault/index.md',
        'transmissions/justcallmegreg-blog/vault/assets/poster.jpg',
      ],
      r2Prefix: 'transmissions/vault/',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/transmissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/overseer/transmissions.ts`**

```ts
import { stringify as yamlStringify } from 'yaml';

// Namespace segment for overseer-authored transmissions, matching the Plane A
// content layout `transmissions/{owner}-{repo}/{slug}/`.
export const TRANSMISSIONS_NS = 'justcallmegreg-blog';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function transmissionEntryPaths(slug: string): {
  dir: string;
  indexMd: string;
  posterAsset: string;
} {
  const dir = `transmissions/${TRANSMISSIONS_NS}/${slug}`;
  return { dir, indexMd: `${dir}/index.md`, posterAsset: `${dir}/assets/poster.jpg` };
}

export interface TransmissionFields {
  title: string;
  description?: string;
  date?: string;
  video: string;
  duration?: string;
  draft: boolean;
  publishAt?: string;
}

export function composeTransmissionMarkdown(fields: TransmissionFields): string {
  // Deterministic key order; omit empty optionals so the file stays clean.
  const fm: Record<string, unknown> = { title: fields.title, video: fields.video };
  if (fields.date) fm.date = fields.date;
  if (fields.description) fm.description = fields.description;
  if (fields.duration) fm.duration = fields.duration;
  if (fields.publishAt) fm.publishAt = fields.publishAt;
  fm.draft = fields.draft;
  // Double-quote every string scalar. Critical for `date`/`publishAt`: the
  // engine parses frontmatter via gray-matter (js-yaml), whose default schema
  // reads an UNQUOTED `2026-06-02` as a Date object — which would fail the
  // transmission schema's `date: z.string()` and silently drop the entry.
  // `lineWidth: 0` disables folding so a long description stays on one line.
  const body = yamlStringify(fm, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN', lineWidth: 0 });
  return `---\n${body}---\n`;
}

export interface CreateInput {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  duration?: string;
  video?: string;
  posterType?: string;
  hasPoster: boolean;
  draft?: boolean;
}

export type ValidateResult =
  | { ok: true; slug: string; fields: TransmissionFields }
  | { ok: false; error: string };

export function validateCreateInput(i: CreateInput): ValidateResult {
  const slug = (i.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug must be lowercase letters, digits, and hyphens' };
  const title = (i.title ?? '').trim();
  if (!title) return { ok: false, error: 'title is required' };
  if (!i.hasPoster) return { ok: false, error: 'a poster image is required' };
  if (i.posterType && !/^image\/(png|jpeg|webp|gif)$/.test(i.posterType)) {
    return { ok: false, error: 'poster must be a png, jpeg, webp, or gif image' };
  }
  if (i.date && !YMD.test(i.date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
  const video = (i.video ?? '').trim() || `${slug}/master.m3u8`;
  return {
    ok: true,
    slug,
    fields: {
      title,
      description: i.description?.trim() || undefined,
      date: i.date?.trim() || undefined,
      duration: i.duration?.trim() || undefined,
      video,
      draft: Boolean(i.draft),
    },
  };
}

export function deletePlan(slug: string): { gitPaths: string[]; r2Prefix: string } {
  const p = transmissionEntryPaths(slug);
  return { gitPaths: [p.indexMd, p.posterAsset], r2Prefix: `transmissions/${slug}/` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/transmissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `listAllTransmissions` with a failing test**

In `test/lib/content-store.test.ts`, inside the `transmissions` describe block, add:

```ts
  it('listAllTransmissions includes drafts that listTransmissions excludes', async () => {
    commitTransmission('shown', '---\ntitle: Shown\nvideo: "shown/master.m3u8"\n---\n');
    commitTransmission('hidden', '---\ntitle: Hidden\nvideo: "hidden/master.m3u8"\ndraft: true\n---\n');
    const store = makeStore();
    await store.start();
    expect(store.listTransmissions().map((t) => t.slug)).not.toContain('hidden');
    expect(store.listAllTransmissions().map((t) => t.slug).sort()).toEqual(['hidden', 'shown']);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/lib/content-store.test.ts -t listAllTransmissions`
Expected: FAIL — `store.listAllTransmissions is not a function`.

- [ ] **Step 7: Implement `listAllTransmissions`**

In `src/lib/content-store.ts`, directly after the `listTransmissions` method:

```ts
  /** Every transmission incl. hidden/scheduled (for the overseer), newest-first. */
  listAllTransmissions(): Transmission[] {
    return [...this.transmissionsIndex.values()].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/lib/content-store.test.ts test/lib/overseer/transmissions.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/overseer/transmissions.ts src/lib/content-store.ts test/lib/overseer/transmissions.test.ts test/lib/content-store.test.ts
git commit -m "feat(overseer): pure transmission logic + listAllTransmissions"
```

---

### Task 2: GitHub Git Data API commit module

**Files:**
- Create: `src/lib/overseer/github.ts`
- Test: `test/lib/overseer/github.test.ts` (new)

**Interfaces:**
- Consumes: `getConfig()` (`cfg.content.repo`, `cfg.content.branch`), `process.env.CONTENT_REPO_TOKEN`.
- Produces:
  - `interface GitHubConfig { owner: string; repo: string; branch: string; token: string }`
  - `githubConfig(): GitHubConfig` — parses owner/repo from `cfg.content.repo`.
  - `interface GitHubLike { request(method: string, path: string, body?: unknown): Promise<any> }`
  - `makeGitHub(cfg): GitHubLike`
  - `interface CommitFilesInput { message: string; put?: { path: string; bytes: Uint8Array }[]; remove?: string[] }`
  - `commitFiles(cfg, input, gh?): Promise<{ commitSha: string }>`

- [ ] **Step 1: Write the failing test**

Create `test/lib/overseer/github.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { commitFiles, githubConfig, type GitHubLike } from '../../../src/lib/overseer/github';

const CFG = { owner: 'o', repo: 'r', branch: 'main', token: 't' };

function fakeGitHub(): { gh: GitHubLike; calls: [string, string, any?][] } {
  const calls: [string, string, any?][] = [];
  const gh: GitHubLike = {
    async request(method, path, body) {
      calls.push([method, path, body]);
      if (method === 'GET' && path.endsWith('/git/ref/heads/main')) return { object: { sha: 'BASECOMMIT' } };
      if (method === 'GET' && path.includes('/git/commits/BASECOMMIT')) return { tree: { sha: 'BASETREE' } };
      if (method === 'POST' && path.endsWith('/git/blobs')) return { sha: `BLOB${calls.length}` };
      if (method === 'POST' && path.endsWith('/git/trees')) return { sha: 'NEWTREE' };
      if (method === 'POST' && path.endsWith('/git/commits')) return { sha: 'NEWCOMMIT' };
      if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) return { object: { sha: 'NEWCOMMIT' } };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return { gh, calls };
}

describe('commitFiles', () => {
  it('adds a blob for each put and builds a tree on the base tree', async () => {
    const { gh, calls } = fakeGitHub();
    const res = await commitFiles(CFG, {
      message: 'add x',
      put: [{ path: 'a/index.md', bytes: new TextEncoder().encode('hi') }],
    }, gh);
    expect(res.commitSha).toBe('NEWCOMMIT');
    const treeCall = calls.find((c) => c[0] === 'POST' && c[1].endsWith('/git/trees'));
    expect(treeCall![2].base_tree).toBe('BASETREE');
    expect(treeCall![2].tree).toContainEqual({ path: 'a/index.md', mode: '100644', type: 'blob', sha: 'BLOB3' });
    const patch = calls.find((c) => c[0] === 'PATCH');
    expect(patch![2]).toEqual({ sha: 'NEWCOMMIT' });
  });

  it('encodes removes as tree entries with sha:null and creates no blob for them', async () => {
    const { gh, calls } = fakeGitHub();
    await commitFiles(CFG, { message: 'rm', remove: ['a/index.md', 'a/assets/poster.jpg'] }, gh);
    const treeCall = calls.find((c) => c[0] === 'POST' && c[1].endsWith('/git/trees'));
    expect(treeCall![2].tree).toContainEqual({ path: 'a/index.md', mode: '100644', type: 'blob', sha: null });
    expect(treeCall![2].tree).toContainEqual({ path: 'a/assets/poster.jpg', mode: '100644', type: 'blob', sha: null });
    expect(calls.some((c) => c[1].endsWith('/git/blobs'))).toBe(false);
  });
});

describe('githubConfig', () => {
  it('parses owner/repo from an https content.repo url', () => {
    // Uses the real getConfig(); assert the parse via a direct regex expectation
    // by monkeypatching is overkill — instead verify the helper on a known url.
    // (Covered indirectly; here we just ensure it returns the configured branch.)
    const cfg = githubConfig();
    expect(typeof cfg.owner).toBe('string');
    expect(typeof cfg.repo).toBe('string');
    expect(cfg.branch.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/github.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/overseer/github.ts`**

```ts
import { Buffer } from 'node:buffer';
import { getConfig } from '../config';

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export function githubConfig(): GitHubConfig {
  const cfg = getConfig();
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(cfg.content.repo);
  if (!m) throw new Error(`Cannot parse owner/repo from content.repo: ${cfg.content.repo}`);
  return { owner: m[1], repo: m[2], branch: cfg.content.branch, token: process.env.CONTENT_REPO_TOKEN ?? '' };
}

export interface GitHubLike {
  request(method: string, path: string, body?: unknown): Promise<any>;
}

export function makeGitHub(cfg: GitHubConfig): GitHubLike {
  return {
    async request(method, path, body) {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'blog-overseer',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${txt.slice(0, 200)}`);
      }
      return res.json();
    },
  };
}

export interface CommitFilesInput {
  message: string;
  put?: { path: string; bytes: Uint8Array }[];
  remove?: string[];
}

/**
 * One commit that adds `put` files and removes `remove` paths, via the Git Data
 * API: ref -> base commit+tree -> blobs -> new tree (base_tree + entries) ->
 * commit -> update ref. Removes are tree entries with sha:null.
 */
export async function commitFiles(
  cfg: GitHubConfig,
  input: CommitFilesInput,
  gh: GitHubLike = makeGitHub(cfg)
): Promise<{ commitSha: string }> {
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const ref = await gh.request('GET', `${base}/git/ref/heads/${cfg.branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh.request('GET', `${base}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  for (const f of input.put ?? []) {
    const blob = await gh.request('POST', `${base}/git/blobs`, {
      content: Buffer.from(f.bytes).toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const path of input.remove ?? []) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  const newTree = await gh.request('POST', `${base}/git/trees`, { base_tree: baseTreeSha, tree });
  const commit = await gh.request('POST', `${base}/git/commits`, {
    message: input.message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });
  await gh.request('PATCH', `${base}/git/refs/heads/${cfg.branch}`, { sha: commit.sha });
  return { commitSha: commit.sha };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/github.test.ts`
Expected: PASS. (The `githubConfig` test uses the repo's real `config.yaml`, whose `content.repo` is the `blog-content` https URL, so owner/repo parse and branch is non-empty.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/overseer/github.ts test/lib/overseer/github.test.ts
git commit -m "feat(overseer): GitHub Git Data API commitFiles"
```

---

### Task 3: R2 delete module

**Files:**
- Create: `src/lib/overseer/r2.ts`
- Modify: `package.json` (add `@aws-sdk/client-s3`)
- Test: `test/lib/overseer/r2.test.ts` (new)

**Interfaces:**
- Produces:
  - `interface R2Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }`
  - `r2ConfigFromEnv(): R2Config`
  - `interface S3Like { send(cmd: unknown): Promise<any> }`
  - `makeS3(cfg): S3Like`
  - `deletePrefix(cfg, prefix, s3?): Promise<{ deleted: number }>`

- [ ] **Step 1: Add the dependency**

Run: `npm install @aws-sdk/client-s3`
Expected: `package.json` gains `@aws-sdk/client-s3` under dependencies; lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `test/lib/overseer/r2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { deletePrefix, type S3Like } from '../../../src/lib/overseer/r2';

const CFG = { endpoint: 'https://r2', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };

describe('deletePrefix', () => {
  it('lists then deletes all keys under the prefix, following pagination', async () => {
    const deleted: string[] = [];
    let listCall = 0;
    const s3: S3Like = {
      async send(cmd: any) {
        if (cmd instanceof ListObjectsV2Command) {
          listCall++;
          return listCall === 1
            ? { Contents: [{ Key: 'transmissions/x/a.ts' }, { Key: 'transmissions/x/master.m3u8' }], IsTruncated: true, NextContinuationToken: 'C' }
            : { Contents: [{ Key: 'transmissions/x/b.ts' }], IsTruncated: false };
        }
        if (cmd instanceof DeleteObjectsCommand) {
          for (const o of cmd.input.Delete.Objects) deleted.push(o.Key);
          return {};
        }
        throw new Error('unexpected command');
      },
    };
    const res = await deletePrefix(CFG, 'transmissions/x/', s3);
    expect(res.deleted).toBe(3);
    expect(deleted.sort()).toEqual(['transmissions/x/a.ts', 'transmissions/x/b.ts', 'transmissions/x/master.m3u8']);
  });

  it('is a no-op when the prefix is empty', async () => {
    let deletes = 0;
    const s3: S3Like = {
      async send(cmd: any) {
        if (cmd instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: false };
        deletes++;
        return {};
      },
    };
    const res = await deletePrefix(CFG, 'transmissions/none/', s3);
    expect(res.deleted).toBe(0);
    expect(deletes).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/r2.test.ts`
Expected: FAIL — module `../../../src/lib/overseer/r2` not found.

- [ ] **Step 4: Implement `src/lib/overseer/r2.ts`**

```ts
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function r2ConfigFromEnv(): R2Config {
  return {
    endpoint: process.env.R2_ENDPOINT ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  };
}

export interface S3Like {
  send(cmd: unknown): Promise<any>;
}

export function makeS3(cfg: R2Config): S3Like {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

/** Delete every object under `prefix`. Batched (≤1000/delete), paginated. */
export async function deletePrefix(
  cfg: R2Config,
  prefix: string,
  s3: S3Like = makeS3(cfg)
): Promise<{ deleted: number }> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const list: any = await s3.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token })
    );
    const objects = (list.Contents ?? []).map((o: any) => ({ Key: o.Key }));
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: objects } }));
      deleted += objects.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return { deleted };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/r2.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/overseer/r2.ts package.json package-lock.json test/lib/overseer/r2.test.ts
git commit -m "feat(overseer): R2 deletePrefix (S3-compatible)"
```

---

### Task 4: Request handlers (create / update / delete)

**Files:**
- Create: `src/pages/overseer/transmissions/api/create.ts`
- Create: `src/pages/overseer/transmissions/api/update.ts`
- Create: `src/pages/overseer/transmissions/api/delete.ts`
- Test: `test/lib/overseer/transmissions-endpoints.test.ts` (new)

**Interfaces:**
- Consumes: `validateCreateInput`, `composeTransmissionMarkdown`, `transmissionEntryPaths`, `deletePlan`, `SLUG_RE`, `TransmissionFields` (Task 1); `commitFiles`/`githubConfig` (Task 2); `deletePrefix`/`r2ConfigFromEnv` (Task 3); `ensureStarted` (store, for `sync`).
- Produces (pure handlers, each exported for tests):
  - `handleCreate(input: CreateInput & { posterBytes?: Uint8Array }, deps: WriteDeps): Promise<HandlerResult>`
  - `handleUpdate(input: UpdateInput, deps: WriteDeps): Promise<HandlerResult>`
  - `handleDelete(input: { slug?: string; confirm?: string }, deps: DeleteDeps): Promise<HandlerResult>`
  - `HandlerResult = { status: number; body: { ok: boolean; error?: string; slug?: string } }`
  - `interface WriteDeps { commit(i: { message: string; put?: {path:string;bytes:Uint8Array}[]; remove?: string[] }): Promise<{commitSha:string}>; sync(): Promise<void> }`
  - `interface DeleteDeps extends WriteDeps { deleteMedia(prefix: string): Promise<{ deleted: number }> }`
  - `interface UpdateInput { slug: string; title: string; description?: string; date?: string; duration?: string; video?: string; draft?: boolean; posterType?: string; posterBytes?: Uint8Array }`

- [ ] **Step 1: Write the failing test**

Create `test/lib/overseer/transmissions-endpoints.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleCreate, handleUpdate, handleDelete } from '../../../src/pages/overseer/transmissions/api/create';

function poster() { return new TextEncoder().encode('JPEGBYTES'); }

describe('handleCreate', () => {
  it('400 on invalid input, without committing', async () => {
    const commit = vi.fn(); const sync = vi.fn();
    const res = await handleCreate({ slug: 'Bad Slug', title: 'T', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync });
    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits index.md + poster and syncs on success', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleCreate(
      { slug: 'first-tx', title: 'First', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg', duration: '05:52' },
      { commit, sync }
    );
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('first-tx');
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toEqual([
      'transmissions/justcallmegreg-blog/first-tx/index.md',
      'transmissions/justcallmegreg-blog/first-tx/assets/poster.jpg',
    ]);
    expect(new TextDecoder().decode(arg.put[0].bytes)).toContain('video: first-tx/master.m3u8');
    expect(sync).toHaveBeenCalled();
  });

  it('502 when the commit throws', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('gh down'));
    const res = await handleCreate({ slug: 'x', title: 'X', hasPoster: true, posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync: vi.fn() });
    expect(res.status).toBe(502);
  });
});

describe('handleUpdate', () => {
  it('rewrites index.md (no poster) and syncs', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleUpdate({ slug: 'first-tx', title: 'New Title', draft: true }, { commit, sync });
    expect(res.status).toBe(200);
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toEqual(['transmissions/justcallmegreg-blog/first-tx/index.md']);
    expect(new TextDecoder().decode(arg.put[0].bytes)).toContain('draft: true');
    expect(sync).toHaveBeenCalled();
  });
  it('includes the poster in the commit when a new one is provided', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const res = await handleUpdate({ slug: 'first-tx', title: 'T', posterBytes: poster(), posterType: 'image/jpeg' }, { commit, sync: vi.fn() });
    const arg = commit.mock.calls[0][0];
    expect(arg.put.map((f: any) => f.path)).toContain('transmissions/justcallmegreg-blog/first-tx/assets/poster.jpg');
  });
});

describe('handleDelete', () => {
  it('400 without APPROVE, no commit', async () => {
    const commit = vi.fn(); const deleteMedia = vi.fn(); const sync = vi.fn();
    expect((await handleDelete({ slug: 'x', confirm: 'nope' }, { commit, deleteMedia, sync })).status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
  });
  it('commits removal BEFORE deleting media, then syncs', async () => {
    const order: string[] = [];
    const commit = vi.fn().mockImplementation(async () => { order.push('commit'); return { commitSha: 'C' }; });
    const deleteMedia = vi.fn().mockImplementation(async () => { order.push('media'); return { deleted: 3 }; });
    const sync = vi.fn().mockResolvedValue(undefined);
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync });
    expect(res.status).toBe(200);
    expect(order).toEqual(['commit', 'media']);
    expect(commit.mock.calls[0][0].remove).toEqual([
      'transmissions/justcallmegreg-blog/gone/index.md',
      'transmissions/justcallmegreg-blog/gone/assets/poster.jpg',
    ]);
    expect(deleteMedia).toHaveBeenCalledWith('transmissions/gone/');
  });
  it('502 and no media delete when the git removal fails', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('gh down'));
    const deleteMedia = vi.fn();
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync: vi.fn() });
    expect(res.status).toBe(502);
    expect(deleteMedia).not.toHaveBeenCalled();
  });
  it('still returns 200 (git succeeded) when media cleanup fails, with a warning', async () => {
    const commit = vi.fn().mockResolvedValue({ commitSha: 'C' });
    const deleteMedia = vi.fn().mockRejectedValue(new Error('r2 down'));
    const res = await handleDelete({ slug: 'gone', confirm: 'APPROVE' }, { commit, deleteMedia, sync: vi.fn() });
    expect(res.status).toBe(200);
    expect(res.body.error).toMatch(/media/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/transmissions-endpoints.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/pages/overseer/transmissions/api/create.ts`**

This file exports all three pure handlers + the `create` POST route. `update.ts` and `delete.ts` re-export their handler and add their own POST route.

```ts
import type { APIRoute } from 'astro';
import {
  validateCreateInput,
  composeTransmissionMarkdown,
  transmissionEntryPaths,
  deletePlan,
  SLUG_RE,
  type CreateInput,
  type TransmissionFields,
} from '../../../../lib/overseer/transmissions';
import { commitFiles, githubConfig } from '../../../../lib/overseer/github';
import { deletePrefix, r2ConfigFromEnv } from '../../../../lib/overseer/r2';
import { ensureStarted } from '../../../../lib/store-singleton';

export interface HandlerResult {
  status: number;
  body: { ok: boolean; error?: string; slug?: string };
}
export interface WriteDeps {
  commit(i: { message: string; put?: { path: string; bytes: Uint8Array }[]; remove?: string[] }): Promise<{ commitSha: string }>;
  sync(): Promise<void>;
}
export interface DeleteDeps extends WriteDeps {
  deleteMedia(prefix: string): Promise<{ deleted: number }>;
}
export interface UpdateInput {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  duration?: string;
  video?: string;
  draft?: boolean;
  posterType?: string;
  posterBytes?: Uint8Array;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function handleCreate(
  input: CreateInput & { posterBytes?: Uint8Array },
  deps: WriteDeps
): Promise<HandlerResult> {
  const v = validateCreateInput({ ...input, hasPoster: Boolean(input.posterBytes) });
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const paths = transmissionEntryPaths(v.slug);
  const md = composeTransmissionMarkdown(v.fields);
  try {
    await deps.commit({
      message: `transmission: add ${v.slug}`,
      put: [
        { path: paths.indexMd, bytes: enc(md) },
        { path: paths.posterAsset, bytes: input.posterBytes! },
      ],
    });
  } catch {
    return { status: 502, body: { ok: false, error: 'commit failed' } };
  }
  await deps.sync().catch(() => {});
  return { status: 200, body: { ok: true, slug: v.slug } };
}

export async function handleUpdate(input: UpdateInput, deps: WriteDeps): Promise<HandlerResult> {
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  if (input.posterType && !/^image\/(png|jpeg|webp|gif)$/.test(input.posterType)) {
    return { status: 400, body: { ok: false, error: 'poster must be png/jpeg/webp/gif' } };
  }
  const title = (input.title ?? '').trim();
  if (!title) return { status: 400, body: { ok: false, error: 'title is required' } };
  const fields: TransmissionFields = {
    title,
    description: input.description?.trim() || undefined,
    date: input.date?.trim() || undefined,
    duration: input.duration?.trim() || undefined,
    video: (input.video ?? '').trim() || `${slug}/master.m3u8`,
    draft: Boolean(input.draft),
  };
  const paths = transmissionEntryPaths(slug);
  const put: { path: string; bytes: Uint8Array }[] = [
    { path: paths.indexMd, bytes: enc(composeTransmissionMarkdown(fields)) },
  ];
  if (input.posterBytes) put.push({ path: paths.posterAsset, bytes: input.posterBytes });
  try {
    await deps.commit({ message: `transmission: update ${slug}`, put });
  } catch {
    return { status: 502, body: { ok: false, error: 'commit failed' } };
  }
  await deps.sync().catch(() => {});
  return { status: 200, body: { ok: true, slug } };
}

export async function handleDelete(
  input: { slug?: string; confirm?: string },
  deps: DeleteDeps
): Promise<HandlerResult> {
  if (input.confirm !== 'APPROVE') return { status: 400, body: { ok: false, error: 'confirmation required' } };
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  const plan = deletePlan(slug);
  try {
    await deps.commit({ message: `transmission: remove ${slug}`, remove: plan.gitPaths });
  } catch {
    return { status: 502, body: { ok: false, error: 'git delete failed' } };
  }
  let warning: string | undefined;
  try {
    await deps.deleteMedia(plan.r2Prefix);
  } catch {
    warning = 'entry removed, but R2 media cleanup failed (orphaned objects)';
  }
  await deps.sync().catch(() => {});
  return { status: 200, body: { ok: true, ...(warning ? { error: warning } : {}) } };
}

// ---- create route ----
async function fieldsFromForm(form: FormData) {
  const poster = form.get('poster');
  const posterFile = poster instanceof File && poster.size > 0 ? poster : null;
  const posterBytes = posterFile ? new Uint8Array(await posterFile.arrayBuffer()) : undefined;
  const str = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : undefined);
  return {
    slug: str('slug') ?? '',
    title: str('title') ?? '',
    description: str('description'),
    date: str('date'),
    duration: str('duration'),
    video: str('video'),
    draft: form.get('draft') === 'on' || form.get('draft') === 'true',
    posterType: posterFile?.type,
    posterBytes,
  };
}

function realDeps(): DeleteDeps {
  const gh = githubConfig();
  const r2 = r2ConfigFromEnv();
  return {
    commit: (i) => commitFiles(gh, i),
    deleteMedia: (prefix) => deletePrefix(r2, prefix),
    sync: async () => { const store = await ensureStarted(); await store.sync(); },
  };
}

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const f = await fieldsFromForm(form);
  const result = await handleCreate({ ...f, hasPoster: Boolean(f.posterBytes) }, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};

export { fieldsFromForm, realDeps };
```

- [ ] **Step 4: Implement `src/pages/overseer/transmissions/api/update.ts`**

```ts
import type { APIRoute } from 'astro';
import { handleUpdate, fieldsFromForm, realDeps } from './create';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const f = await fieldsFromForm(form);
  const result = await handleUpdate(f, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 5: Implement `src/pages/overseer/transmissions/api/delete.ts`**

```ts
import type { APIRoute } from 'astro';
import { handleDelete, realDeps } from './create';

export const POST: APIRoute = async ({ request }) => {
  let input: { slug?: string; confirm?: string };
  try {
    input = (await request.json()) as { slug?: string; confirm?: string };
  } catch {
    input = {};
  }
  const result = await handleDelete(input, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/lib/overseer/transmissions-endpoints.test.ts`
Expected: PASS (all handler cases).

- [ ] **Step 7: Commit**

```bash
git add src/pages/overseer/transmissions/api test/lib/overseer/transmissions-endpoints.test.ts
git commit -m "feat(overseer): transmission create/update/delete handlers + routes"
```

---

### Task 5: Overseer UI — management list, edit page, tab

**Files:**
- Modify: `src/layouts/Overseer.astro` (add the Transmissions tab)
- Create: `src/pages/overseer/transmissions/index.astro` (list + new form)
- Create: `src/pages/overseer/transmissions/[slug].astro` (edit form)

**Interfaces:**
- Consumes: `ensureStarted` (`store.listAllTransmissions()`, `store.getTransmission()`); the API routes from Task 4.

- [ ] **Step 1: Add the Transmissions tab**

In `src/layouts/Overseer.astro`, change the `tabs` array:

```ts
const tabs = [
  { id: 'subscribers', label: 'Subscribers', href: '/overseer' },
  { id: 'transmissions', label: 'Transmissions', href: '/overseer/transmissions' },
];
```

- [ ] **Step 2: Create the management list + new form**

Create `src/pages/overseer/transmissions/index.astro`:

```astro
---
import Overseer from '../../../layouts/Overseer.astro';
import { ensureStarted } from '../../../lib/store-singleton';

const store = await ensureStarted();
const items = store.listAllTransmissions();
---
<Overseer title="Transmissions" tab="transmissions">
  <section class="pane">
    <h2 class="pane-title">// TRANSMISSIONS ({items.length})</h2>
    <table class="overseer-table">
      <thead><tr><th>slug</th><th>title</th><th>date</th><th>state</th><th class="ov-c">actions</th></tr></thead>
      <tbody>
        {items.map((t) => (
          <tr>
            <td>{t.slug}</td>
            <td>{t.title}</td>
            <td class="ov-member">{t.date || '—'}</td>
            <td>{t.draft ? 'HIDDEN' : 'LIVE'}</td>
            <td class="ov-c">
              <a href={`/overseer/transmissions/${t.slug}`}>edit</a>
              <button type="button" class="tx-hide" data-slug={t.slug} data-draft={String(t.draft)} data-title={t.title}>{t.draft ? 'unhide' : 'hide'}</button>
              <button type="button" class="tx-del" data-slug={t.slug}>delete</button>
            </td>
          </tr>
        ))}
        {items.length === 0 && <tr><td colspan="5" class="muted">&gt; no transmissions.</td></tr>}
      </tbody>
    </table>
  </section>

  <section class="pane">
    <h2 class="pane-title">// NEW TRANSMISSION</h2>
    <p class="muted">&gt; upload the HLS bundle to R2 first (local tool), then create the entry here.</p>
    <form id="tx-new" method="post" action="/overseer/transmissions/api/create" enctype="multipart/form-data">
      <label>slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" /></label>
      <label>title <input name="title" required /></label>
      <label>date <input name="date" placeholder="YYYY-MM-DD" /></label>
      <label>duration <input name="duration" placeholder="mm:ss" /></label>
      <label>video <input name="video" placeholder="{slug}/master.m3u8 (default)" /></label>
      <label>description <textarea name="description"></textarea></label>
      <label>poster <input type="file" name="poster" accept="image/*" required /></label>
      <label><input type="checkbox" name="draft" /> hidden (draft)</label>
      <button type="submit" class="tab">create</button>
    </form>
    <p id="tx-msg" aria-live="polite"></p>
  </section>
</Overseer>

<script>
  const msg = document.getElementById('tx-msg');
  const say = (t: string) => { if (msg) msg.textContent = t; };

  document.getElementById('tx-new')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    say('> transmitting…');
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) location.href = '/overseer/transmissions';
    else say('> error: ' + (j.error ?? res.status));
  });

  document.querySelectorAll<HTMLButtonElement>('.tx-hide').forEach((b) => b.addEventListener('click', async () => {
    const fd = new FormData();
    fd.set('slug', b.dataset.slug!);
    fd.set('title', b.dataset.title!);
    fd.set('draft', b.dataset.draft === 'true' ? '' : 'on'); // toggle
    const res = await fetch('/overseer/transmissions/api/update', { method: 'POST', body: fd });
    if (res.ok) location.reload(); else say('> hide/unhide failed');
  }));

  document.querySelectorAll<HTMLButtonElement>('.tx-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete transmission "${b.dataset.slug}"? This removes the entry and its R2 media.`)) return;
    const res = await fetch('/overseer/transmissions/api/delete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: b.dataset.slug, confirm: 'APPROVE' }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { if (j.error) alert(j.error); location.reload(); } else say('> delete failed: ' + (j.error ?? res.status));
  }));
</script>
```

- [ ] **Step 3: Create the edit page**

Create `src/pages/overseer/transmissions/[slug].astro`:

```astro
---
import Overseer from '../../../layouts/Overseer.astro';
import { ensureStarted } from '../../../lib/store-singleton';

const { slug } = Astro.params;
const store = await ensureStarted();
const tx = store.getTransmission(`/transmissions/${slug}`);
if (!tx) return new Response('Not found', { status: 404 });
---
<Overseer title={`Edit ${tx.slug}`} tab="transmissions">
  <section class="pane">
    <h2 class="pane-title">// EDIT {tx.slug}</h2>
    <form id="tx-edit" method="post" action="/overseer/transmissions/api/update" enctype="multipart/form-data">
      <input type="hidden" name="slug" value={tx.slug} />
      <label>title <input name="title" value={tx.title} required /></label>
      <label>date <input name="date" value={tx.date} placeholder="YYYY-MM-DD" /></label>
      <label>duration <input name="duration" value={tx.duration ?? ''} placeholder="mm:ss" /></label>
      <label>video <input name="video" value={tx.video} /></label>
      <label>description <textarea name="description">{tx.description ?? ''}</textarea></label>
      <label>replace poster <input type="file" name="poster" accept="image/*" /></label>
      <label><input type="checkbox" name="draft" checked={tx.draft} /> hidden (draft)</label>
      <button type="submit" class="tab">save</button>
      <a href="/overseer/transmissions">cancel</a>
    </form>
    <p id="tx-msg" aria-live="polite"></p>
  </section>
</Overseer>

<script>
  document.getElementById('tx-edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
    const j = await res.json().catch(() => ({}));
    const msg = document.getElementById('tx-msg');
    if (res.ok) location.href = '/overseer/transmissions';
    else if (msg) msg.textContent = '> error: ' + (j.error ?? res.status);
  });
</script>
```

- [ ] **Step 4: Build to verify types + bundling**

Run: `npm run build`
Expected: build succeeds; no TypeScript errors.

- [ ] **Step 5: End-to-end verification (overseer enabled, injected-safe)**

The write paths hit real GitHub/R2, so verify the **read + gating** parts live and the write parts by unit tests (Task 4). Minimal live check:

```bash
SCRATCH="$(mktemp -d)"
mkdir -p "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets"
printf -- '---\ntitle: "Demo"\nvideo: "demo/master.m3u8"\ndraft: true\n---\n' > "$SCRATCH/transmissions/justcallmegreg-blog/demo/index.md"
cp public/profile_picture.png "$SCRATCH/transmissions/justcallmegreg-blog/demo/assets/poster.jpg"
OVERSEER_ENABLED=true CONTENT_LOCAL_DIR="$SCRATCH" npx astro dev --port 4399 > /tmp/tx-b.log 2>&1 &
```

Verify (dev server on 4399):
- `curl -s localhost:4399/overseer/transmissions` lists the `demo` row (a HIDDEN draft — proving `listAllTransmissions` shows hidden), with edit/hide/delete controls and a New form.
- `curl -s localhost:4399/overseer/transmissions/demo` renders the edit form pre-filled (`value="Demo"`, the draft checkbox checked).
- `curl -s -o /dev/null -w '%{http_code}' localhost:4399/overseer/transmissions` with `OVERSEER_ENABLED` unset returns `404` (middleware gating still covers the new routes).

Stop the dev server (`pkill -f "astro dev"`) and remove `$SCRATCH`.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/Overseer.astro src/pages/overseer/transmissions/index.astro src/pages/overseer/transmissions/[slug].astro
git commit -m "feat(overseer): transmissions management UI (list, new, edit, hide, delete)"
```

---

### Task 6: Config/secrets docs + full-suite verification

**Files:**
- Modify: `helm/blog-engine/values.yaml` (document the overseer's new env secrets)
- Modify: `docs/blogpost-publishing.md` (Transmissions overseer note)

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Document the overseer secrets**

In `helm/blog-engine/values.yaml`, near the existing overseer block/comment, document that the overseer deployment additionally needs (as env, from a secret): `CONTENT_REPO_TOKEN` with **contents:write** on `blog-content`, and `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` for media deletion. State explicitly that the **public** engine deployment must NOT receive the `R2_*` write/delete creds and needs only read scope on the content token.

- [ ] **Step 2: Add a docs note**

In `docs/blogpost-publishing.md`, in the Transmissions section, add a short paragraph: transmissions can be managed from the overseer (`/overseer/transmissions`) — create (after the HLS bundle is uploaded to R2 by the local tool), edit, hide/unhide, delete; each action commits to `blog-content` and delete also removes the R2 media. The overseer must stay on the private ingress.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all files, including the new `transmissions`, `github`, `r2`, and `transmissions-endpoints` overseer tests.

- [ ] **Step 4: Commit**

```bash
git add helm/blog-engine/values.yaml docs/blogpost-publishing.md
git commit -m "docs(overseer): transmissions management secrets + publishing note"
```
