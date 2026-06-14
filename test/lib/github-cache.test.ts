import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getContributionDataCached,
  __clearGithubCache,
  __contribRefreshSettled,
  type ContributionData,
} from '../../src/lib/github';

function sample(user: string, fetchedAt: number, extra: Partial<ContributionData> = {}): ContributionData {
  return {
    user,
    repos: [],
    prs: [],
    heatmap: { dayLabels: [], weekLabels: [], weeks: [], grid: [] } as unknown as ContributionData['heatmap'],
    fetchedAt,
    ...extra,
  };
}

let dir: string;
const NOW = 1_700_000_000_000;
const base = (fetchFn: any, over: Record<string, unknown> = {}) =>
  ({ enabled: true, ttlMs: 1000, cacheDir: dir, now: () => NOW, fetch: fetchFn, ...over });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'contrib-'));
  __clearGithubCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('getContributionDataCached — disk SWR', () => {
  it('cold cache: fetches once, writes the file, returns data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, 'u.json'))).toBe(true);
  });

  it('fresh cache: returns the file, does NOT fetch', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 500)));
    const fetchFn = vi.fn();
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 500);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stale cache: returns stale immediately + refreshes in the background', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW, { repos: [{ name: 'fresh' } as never] }));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 5000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await __contribRefreshSettled('u');
    const written = JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8'));
    expect(written.fetchedAt).toBe(NOW);
  });

  it('stale + refresh fails: keeps the old file', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));
    const d = await getContributionDataCached('u', undefined, base(fetchFn));
    expect(d.fetchedAt).toBe(NOW - 5000);
    await __contribRefreshSettled('u');
    const written = JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8'));
    expect(written.fetchedAt).toBe(NOW - 5000);
  });

  it('cold error: backs off — serves the cached error without refetching within errorTtlMs', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW, { error: 'boom' }));
    const d1 = await getContributionDataCached('u', undefined, base(fetchFn, { errorTtlMs: 60000 }));
    expect(d1.error).toBe('boom');
    const d2 = await getContributionDataCached('u', undefined, base(fetchFn, { errorTtlMs: 60000 }));
    expect(d2.error).toBe('boom');
    expect(fetchFn).toHaveBeenCalledTimes(1); // second call served the cached error, no refetch
    expect(existsSync(join(dir, 'u.json'))).toBe(false); // errors never written to disk
  });

  it('single-flight: two stale reads trigger only one refresh', async () => {
    writeFileSync(join(dir, 'u.json'), JSON.stringify(sample('u', NOW - 5000)));
    let resolve!: (v: ContributionData) => void;
    const pending = new Promise<ContributionData>((r) => (resolve = r));
    const fetchFn = vi.fn().mockReturnValue(pending);
    await getContributionDataCached('u', undefined, base(fetchFn));
    await getContributionDataCached('u', undefined, base(fetchFn));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    resolve(sample('u', NOW));
    await __contribRefreshSettled('u');
  });

  it('disabled: always fetches, writes no file', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sample('u', NOW));
    await getContributionDataCached('u', undefined, base(fetchFn, { enabled: false }));
    await getContributionDataCached('u', undefined, base(fetchFn, { enabled: false }));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dir, 'u.json'))).toBe(false);
  });
});
