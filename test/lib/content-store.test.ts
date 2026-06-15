import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ContentStore } from '../../src/lib/content-store';

const NS = 'justcallmegreg-blog'; // source namespace dir: blogs/{owner}-{repo}/{slug}/index.md

let originDir: string;
let cacheDir: string;

function git(dir: string, ...args: string[]) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}
function commitPost(slug: string, body: string, dateISO?: string) {
  const full = join(originDir, NS, slug, 'index.md');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(originDir, 'add', '-A');
  const env = dateISO
    ? { ...process.env, GIT_AUTHOR_DATE: dateISO, GIT_COMMITTER_DATE: dateISO }
    : process.env;
  execFileSync('git', ['commit', '-m', slug], { cwd: originDir, stdio: 'pipe', env });
}

beforeEach(() => {
  originDir = mkdtempSync(join(tmpdir(), 'origin-'));
  cacheDir = mkdtempSync(join(tmpdir(), 'cache-'));
  rmSync(cacheDir, { recursive: true, force: true }); // store will clone into it
  git(originDir, 'init', '-b', 'main');
  git(originDir, 'config', 'user.email', 't@t.t');
  git(originDir, 'config', 'user.name', 'T');
  // Dates pinned via frontmatter so ordering is deterministic regardless of commit time.
  commitPost('first', '---\ntitle: First\ndate: "2026-06-12"\n---\nHello');
  commitPost('older', '---\ntitle: Older\ndate: "2026-06-10"\n---\nOld');
  commitPost('draft', '---\ntitle: Draft\ndate: "2026-06-11"\ndraft: true\n---\nWIP');
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
    expect(posts[0].url).toBe('/first');
    expect(store.getPost('/first')?.html).toContain('Hello');
    expect(store.getPost('/first')?.excerpt).toBe('Hello');
  });

  it('keeps drafts retrievable by URL but flagged', async () => {
    const store = makeStore();
    await store.start();
    const draft = store.getPost('/draft');
    expect(draft?.draft).toBe(true);
  });

  it('derives the published date from git when frontmatter has none', async () => {
    // A post with no frontmatter date, committed on a fixed date.
    commitPost('gitdated', '---\ntitle: Git Dated\n---\nbody', '2020-02-03T10:00:00Z');
    const store = makeStore();
    await store.start();
    expect(store.getPost('/gitdated')?.date).toBe('2020-02-03');
  });

  it('reindexes only changed files after a sync', async () => {
    const store = makeStore();
    await store.start();
    const olderHashBefore = store.getPost('/older')!.blobHash;

    commitPost('first', '---\ntitle: First v2\ndate: "2026-06-12"\n---\nHello again');
    commitPost('new', '---\ntitle: New\ndate: "2026-06-13"\n---\nFresh');

    const changed = await store.sync();
    // only the changed and the new file are reprocessed — not the untouched one
    expect(changed.sort()).toEqual([
      `${NS}/first/index.md`,
      `${NS}/new/index.md`,
    ]);
    expect(store.getPost('/first')!.title).toBe('First v2');
    expect(store.getPost('/new')!.title).toBe('New');
    // untouched post kept its identity (same blob hash, never re-rendered)
    expect(store.getPost('/older')!.blobHash).toBe(olderHashBefore);
  });

  it('drops posts whose files were removed', async () => {
    const store = makeStore();
    await store.start();
    git(originDir, 'rm', `${NS}/older/index.md`);
    git(originDir, 'commit', '-m', 'remove older');
    await store.sync();
    expect(store.getPost('/older')).toBeUndefined();
  });

  it('resolves asset file paths by slug under the post folder, with traversal guard', async () => {
    const store = makeStore();
    await store.start();
    expect(store.resolveAssetPath('first', 'd.png')).toBe(
      resolve(cacheDir, NS, 'first/assets/d.png')
    );
    expect(store.resolveAssetPath('first', '../../../etc/passwd')).toBeNull();
    expect(store.resolveAssetPath('no-such-post', 'd.png')).toBeNull();
  });

  it('local mode reads a plain directory directly and picks up edits without git', async () => {
    const localDir = mkdtempSync(join(tmpdir(), 'local-content-'));
    mkdirSync(join(localDir, NS, 'hi'), { recursive: true });
    writeFileSync(join(localDir, NS, 'hi/index.md'), '---\ntitle: Hi\ndate: "2099-01-01"\n---\nbody');
    const store = new ContentStore({
      repo: 'unused-in-local-mode',
      branch: 'main',
      subdir: '',
      cacheDir: localDir,
      local: true,
    });
    await store.start(); // must NOT attempt a git clone
    expect(store.getPost('/hi')?.title).toBe('Hi');

    // edit the file in place (no commit) and re-sync
    writeFileSync(join(localDir, NS, 'hi/index.md'), '---\ntitle: Hi v2\ndate: "2099-01-01"\n---\nchanged');
    const changed = await store.sync();
    expect(changed).toContain(`${NS}/hi/index.md`);
    expect(store.getPost('/hi')?.title).toBe('Hi v2');

    rmSync(localDir, { recursive: true, force: true });
  });

  it('resolves asset paths to an absolute path even when cacheDir is relative', async () => {
    // Regression: a relative cacheDir (e.g. the default './cache') must still
    // resolve and pass the traversal guard rather than always returning null.
    const relRoot = './rel-cache-test';
    mkdirSync(join(relRoot, NS, 'reactor'), { recursive: true });
    writeFileSync(
      join(relRoot, NS, 'reactor/index.md'),
      '---\ntitle: Reactor\ndate: "2287-11-05"\n---\nx'
    );
    const store = new ContentStore({
      repo: 'unused-in-local-mode',
      branch: 'main',
      subdir: '',
      cacheDir: relRoot,
      local: true,
    });
    await store.start();
    expect(store.resolveAssetPath('reactor', 'reactor.svg')).toBe(
      resolve(relRoot, NS, 'reactor/assets/reactor.svg')
    );
    expect(store.resolveAssetPath('reactor', '../../../etc/passwd')).toBeNull();
    rmSync(relRoot, { recursive: true, force: true });
  });
});
