import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listLocalFiles } from '../../src/lib/local-files';

const dirs: string[] = [];
function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'local-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('listLocalFiles', () => {
  it('lists files as posix-relative paths with a change key', () => {
    const dir = makeDir();
    mkdirSync(join(dir, '2026/06/12/assets'), { recursive: true });
    writeFileSync(join(dir, '2026/06/12/a.md'), 'hello');
    writeFileSync(join(dir, '2026/06/12/assets/x.png'), 'png');
    const map = listLocalFiles(dir);
    expect([...map.keys()].sort()).toEqual([
      '2026/06/12/a.md',
      '2026/06/12/assets/x.png',
    ]);
    expect(typeof map.get('2026/06/12/a.md')).toBe('string');
  });

  it('changes the key when a file is modified', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'a.md'), 'one');
    const before = listLocalFiles(dir).get('a.md');
    writeFileSync(join(dir, 'a.md'), 'one plus more bytes');
    const after = listLocalFiles(dir).get('a.md');
    expect(after).not.toBe(before);
  });

  it('skips the .git directory', () => {
    const dir = makeDir();
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git/config'), 'x');
    writeFileSync(join(dir, 'a.md'), 'hi');
    expect([...listLocalFiles(dir).keys()]).toEqual(['a.md']);
  });

  it('returns an empty map for a missing directory', () => {
    expect(listLocalFiles('/no/such/dir/xyz').size).toBe(0);
  });
});
