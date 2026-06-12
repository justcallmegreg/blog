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
