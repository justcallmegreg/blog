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
