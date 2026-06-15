import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyToken, cloneRepo, fetchReset, firstAddedDate, lsTreeBlobs } from '../../src/lib/git';

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

  it('scrubs the token from clone error messages', async () => {
    const token = 'SECRETTOKEN123';
    let msg = '';
    try {
      await cloneRepo({
        repo: 'https://nonexistent.invalid/repo/xyz.git',
        branch: 'main',
        dir: join(workDir, 'fail'),
        token,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain(token);
  });

  it('scrubs the token from fetch error messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fetchfail-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://x-access-token:SECRETTOKEN999@nonexistent.invalid/r.git'], { cwd: dir, stdio: 'pipe' });
    let msg = '';
    try {
      await fetchReset({ dir, branch: 'main', token: 'SECRETTOKEN999' });
    } catch (e) { msg = (e as Error).message; }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain('SECRETTOKEN999');
  });
});

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
