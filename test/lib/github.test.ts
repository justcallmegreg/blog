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

  it('returns a 7-row (days) x N-week grid with day labels', () => {
    const h = buildHeatmap([], now, 5);
    expect(h.dayLabels).toHaveLength(7);
    expect(h.dayLabels[0]).toBe('MON');
    expect(h.weeks).toBe(5);
    expect(h.grid).toHaveLength(7);
    expect(h.grid.every((row) => row.length === 5)).toBe(true);
    // empty input -> all zero
    expect(h.grid.flat().every((c) => c.count === 0 && c.level === 0)).toBe(true);
  });

  it('labels columns with ISO week numbers, last 5 weeks ending this week', () => {
    const h = buildHeatmap([], now, 5);
    // 2026-06-12 is in ISO week 24; the five trailing columns are W20..W24
    expect(h.weekLabels).toEqual(['20', '21', '22', '23', '24']);
  });

  it('places a PR on its own day cell and scales the level', () => {
    const prs = [
      { createdAt: '2026-06-10T10:00:00' }, // Wed 06-10
      { createdAt: '2026-06-10T14:00:00' }, // Wed 06-10 -> 2 that day
    ];
    const h = buildHeatmap(prs, now, 5);
    const cell = h.grid.flat().find((c) => c.date === '2026-06-10')!;
    expect(cell.count).toBe(2);
    expect(cell.level).toBe(2); // 1<count<=3 -> level 2
  });

  it('flags dates after today as future', () => {
    const h = buildHeatmap([], now, 5);
    const future = h.grid.flat().filter((c) => c.date > '2026-06-12');
    expect(future.length).toBeGreaterThan(0); // the rest of the current week
    expect(future.every((c) => c.future)).toBe(true);
    expect(h.grid.flat().filter((c) => c.date <= '2026-06-12').every((c) => !c.future)).toBe(true);
  });
});
