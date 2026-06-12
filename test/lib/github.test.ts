import { describe, it, expect } from 'vitest';
import { parseRepoFullName, prStatus, buildHeatmap } from '../../src/lib/github';

describe('parseRepoFullName', () => {
  it('extracts owner/name from a repository_url', () => {
    expect(parseRepoFullName('https://api.github.com/repos/octocat/Hello-World')).toBe(
      'octocat/Hello-World'
    );
  });
  it('returns the input unchanged when it does not match', () => {
    expect(parseRepoFullName('not-a-url')).toBe('not-a-url');
  });
});

describe('prStatus', () => {
  it('is MERGED when merged_at is set', () => {
    expect(prStatus({ state: 'closed', pull_request: { merged_at: '2024-01-01T00:00:00Z' } })).toBe('MERGED');
  });
  it('is OPEN for open PRs', () => {
    expect(prStatus({ state: 'open', pull_request: { merged_at: null } })).toBe('OPEN');
  });
  it('is CLOSED for closed-but-not-merged PRs', () => {
    expect(prStatus({ state: 'closed', pull_request: { merged_at: null } })).toBe('CLOSED');
  });
});

describe('buildHeatmap', () => {
  const now = new Date(2026, 5, 12); // Fri 2026-06-12

  it('produces the requested number of weekly cells, oldest first', () => {
    const cells = buildHeatmap([], now, 26);
    expect(cells).toHaveLength(26);
    // last cell is the current (Monday) week
    expect(cells[cells.length - 1].weekStart).toBe('2026-06-08');
    expect(cells.every((c) => c.count === 0 && c.level === 0)).toBe(true);
  });

  it('buckets PRs into their Monday-based week and scales the level', () => {
    const prs = [
      { createdAt: '2026-06-10T10:00:00Z' }, // week of 06-08
      { createdAt: '2026-06-11T10:00:00Z' }, // week of 06-08
      { createdAt: '2026-06-09T10:00:00Z' }, // week of 06-08  -> 3 in that week
    ];
    const cells = buildHeatmap(prs, now, 26);
    const thisWeek = cells.find((c) => c.weekStart === '2026-06-08')!;
    expect(thisWeek.count).toBe(3);
    expect(thisWeek.level).toBe(2); // 1<=,<=3 -> level 2
  });
});
