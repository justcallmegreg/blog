import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
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
function commitDeck(slug: string, body: string) {
  const full = join(originDir, 'decks', NS, slug, 'index.md');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git(originDir, 'add', '-A');
  execFileSync('git', ['commit', '-m', `deck ${slug}`], { cwd: originDir, stdio: 'pipe' });
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

  it('clones into a pre-existing non-empty cacheDir without removing the dir itself', async () => {
    // Regression: in Kubernetes the cache dir is a volume mount point, which
    // cannot be rmdir'd (EBUSY). The pre-clone cleanup must clear the dir's
    // CONTENTS, never delete the directory — the inode has to survive.
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'stale-junk.txt'), 'left over from a failed attempt');
    mkdirSync(join(cacheDir, 'stale-dir'), { recursive: true });
    const inodeBefore = statSync(cacheDir).ino;

    const store = makeStore();
    await store.start();

    expect(statSync(cacheDir).ino).toBe(inodeBefore); // dir itself never recreated
    expect(existsSync(join(cacheDir, 'stale-junk.txt'))).toBe(false); // contents cleared
    expect(store.listPosts().map((p) => p.slug)).toEqual(['first', 'older']);
  });

  it('hides a post scheduled in the future from the list and its URL', async () => {
    commitPost('future', '---\ntitle: Future\npublishAt: "2030-01-01T00:00:00Z"\n---\nsoon');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('future');
    expect(store.getLivePost('/future', now)).toBeUndefined();
    // still retrievable raw (internal callers / preview)
    expect(store.getPost('/future')?.title).toBe('Future');
    expect(store.getPost('/future')?.publishAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('shows a post once its publishAt has passed', async () => {
    commitPost('past', '---\ntitle: Past\npublishAt: "2020-01-01T00:00:00Z"\n---\nlive');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.listPosts(now).map((p) => p.slug)).toContain('past');
    expect(store.getLivePost('/past', now)?.title).toBe('Past');
  });

  it('flips a scheduled post live exactly at its publishAt (request-time gate)', async () => {
    commitPost('drop', '---\ntitle: Drop\npublishAt: "2026-08-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.getLivePost('/drop', new Date('2026-07-31T23:59:59Z'))).toBeUndefined();
    expect(store.getLivePost('/drop', new Date('2026-08-01T00:00:01Z'))?.title).toBe('Drop');
  });

  it('keeps a post with an invalid publishAt hidden and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    commitPost('broken', '---\ntitle: Broken\npublishAt: "not-a-date"\n---\nx');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLivePost('/broken', now)).toBeUndefined();
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('broken');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('publishAt'));
    warn.mockRestore();
  });

  it('dates a scheduled post by its publishAt day when no explicit date is set', async () => {
    commitPost('dbs', '---\ntitle: DBS\npublishAt: "2020-03-04T09:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    // 09:00Z on Mar 4 is 10:00 in Budapest (CET) → day 2020-03-04
    expect(store.getPost('/dbs')?.date).toBe('2020-03-04');
  });

  it('lets an explicit date override the publishAt day', async () => {
    commitPost('exp', '---\ntitle: E\ndate: "2019-12-31"\npublishAt: "2020-03-04T09:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.getPost('/exp')?.date).toBe('2019-12-31');
  });

  it('keeps a draft hidden even after its publishAt has passed', async () => {
    commitPost('ds', '---\ntitle: DS\ndraft: true\npublishAt: "2020-01-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLivePost('/ds', now)).toBeUndefined();
    expect(store.listPosts(now).map((p) => p.slug)).not.toContain('ds');
  });

  it('does not serve assets for a not-yet-published post', async () => {
    commitPost('fa', '---\ntitle: FA\npublishAt: "2030-01-01T00:00:00Z"\n---\nx');
    const store = makeStore();
    await store.start();
    expect(store.resolveAssetPath('fa', 'x.png', new Date('2025-01-01T00:00:00Z'))).toBeNull();
    expect(store.resolveAssetPath('fa', 'x.png', new Date('2031-01-01T00:00:00Z'))).toBe(
      resolve(cacheDir, NS, 'fa/assets/x.png')
    );
  });

  it('indexes a deck: meta, layouts, mermaid + shiki rendering', async () => {
    commitDeck('demo', `---
title: "DEMO DECK"
subtitle: "SUB"
---

# DEMO DECK

HELLO

---

## FLOW

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

---

<!-- slide: two-col -->

## SPLIT

- LEFT

<!-- col -->

\`\`\`js
const x = 1;
\`\`\`
`);
    const store = makeStore();
    await store.start();
    const deck = store.getDeck('/decks/demo');
    expect(deck?.title).toBe('DEMO DECK');
    expect(deck?.subtitle).toBe('SUB');
    expect(deck?.theme).toBe('pipboy');
    expect(deck?.slides.map((s) => s.layout)).toEqual(['title', 'default', 'two-col']);
    expect(deck?.slides[1].html).toContain('<pre class="mermaid">');
    expect(deck?.slides[2].html).toContain('class="cols"');
    expect(deck?.slides[2].html).toContain('shiki');
  });

  it('keeps posts working when decks are present (no cross-contamination)', async () => {
    commitDeck('demo', '# D\n');
    const store = makeStore();
    await store.start();
    expect(store.listPosts(new Date()).map((p) => p.slug)).toEqual(['first', 'older']);
    expect(store.getPost('/decks/demo')).toBeUndefined();
    expect(store.getDeck('/first')).toBeUndefined();
  });

  it('gates a draft deck and a future-scheduled deck', async () => {
    commitDeck('draftdeck', '---\ndraft: true\n---\n# D\n');
    commitDeck('futuredeck', '---\npublishAt: "2030-01-01T00:00:00Z"\n---\n# F\n');
    const store = makeStore();
    await store.start();
    const now = new Date('2025-01-01T00:00:00Z');
    expect(store.getLiveDeck('/decks/draftdeck', now)).toBeUndefined();
    expect(store.getLiveDeck('/decks/futuredeck', now)).toBeUndefined();
    expect(store.getLiveDeck('/decks/futuredeck', new Date('2031-01-01T00:00:00Z'))).toBeDefined();
    expect(store.getDeck('/decks/draftdeck')).toBeDefined(); // raw lookup still works
    expect(store.listDecks(now)).toEqual([]);
  });

  it('resolves deck asset paths with the traversal guard', async () => {
    commitDeck('withassets', '# A\n');
    const store = makeStore();
    await store.start();
    expect(store.resolveDeckAssetPath('withassets', 'd.png')).toBe(
      resolve(cacheDir, 'decks', NS, 'withassets/assets/d.png')
    );
    expect(store.resolveDeckAssetPath('withassets', '../../../etc/passwd')).toBeNull();
    expect(store.resolveDeckAssetPath('nope', 'd.png')).toBeNull();
  });

  it('drops a deck whose file was removed', async () => {
    commitDeck('gone', '# G\n');
    const store = makeStore();
    await store.start();
    expect(store.getDeck('/decks/gone')).toBeDefined();
    git(originDir, 'rm', `decks/${NS}/gone/index.md`);
    git(originDir, 'commit', '-m', 'remove deck');
    await store.sync();
    expect(store.getDeck('/decks/gone')).toBeUndefined();
  });

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

  it('reads about.yaml from the repo root even when posts use a subdir', async () => {
    // With subdir:'blogs', contentRoot() = <cacheDir>/blogs, but about.yaml lives
    // at the repo ROOT. A regression that read it from contentRoot() would look in
    // <cacheDir>/blogs/about.yaml, miss the file, and return null — this pins that.
    mkdirSync(join(originDir, 'blogs', NS, 'reactor'), { recursive: true });
    writeFileSync(
      join(originDir, 'blogs', NS, 'reactor', 'index.md'),
      '---\ntitle: Reactor\ndate: "2026-06-12"\n---\nBody'
    );
    writeFileSync(join(originDir, 'about.yaml'), 'headline: "Root-level"\n');
    git(originDir, 'add', '-A');
    git(originDir, 'commit', '-m', 'subdir post + root about');

    const store = new ContentStore({
      repo: originDir,
      branch: 'main',
      subdir: 'blogs',
      cacheDir,
    });
    await store.start();

    // The post is indexed under the subdir…
    expect(store.listPosts().map((p) => p.slug)).toEqual(['reactor']);
    // …and about.yaml is still found at the ROOT (would be null if read from contentRoot()).
    expect(store.getAbout()?.headline).toBe('Root-level');
  });
});
