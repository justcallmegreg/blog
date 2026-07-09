import { describe, it, expect } from 'vitest';
import { buildSubscribersView, buildSubscribersStats } from '../../../src/lib/overseer/view';

const now = new Date('2026-07-08T12:00:00.000Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

describe('buildSubscribersView', () => {
  it('counts each subscriber on its created day, sorts newest-first, and derives member days', () => {
    const subs = [
      { email: 'a@x.co', createdAt: '2026-07-01T09:00:00.000Z', status: 'OPT_IN' as const },
      { email: 'b@x.co', createdAt: '2026-07-07T09:00:00.000Z', status: 'OPT_OUT' as const },
      { email: 'c@x.co', createdAt: '2026-07-07T18:00:00.000Z', status: 'OPT_IN' as const },
    ];
    const view = buildSubscribersView(subs, now);
    expect(view.total).toBe(3);
    expect(view.rows.map((r) => r.email)).toEqual(['c@x.co', 'b@x.co', 'a@x.co']);
    expect(view.rows[1].status).toBe('OPT_OUT');
    expect(view.rows[0].date).toBe('2026.07.07');
    // whole days a member (now - createdAt): c=0, b=1, a=7
    expect(view.rows.map((r) => r.days)).toEqual([0, 1, 7]);
    const jul7 = view.heatmap.grid.flat().find((c) => c.date === '2026-07-07');
    expect(jul7?.count).toBe(2);
  });

  it('renders an empty view (with zeroed stats) without throwing', () => {
    const view = buildSubscribersView([], now);
    expect(view.total).toBe(0);
    expect(view.rows).toEqual([]);
    expect(view.stats.rows.every((r) => r.optIn === 0 && r.optOut === 0 && r.trend === 'down')).toBe(true);
  });
});

describe('buildSubscribersStats', () => {
  it('buckets by created date × status per timeframe with a net trend', () => {
    const subs = [
      { email: 'a@x.co', createdAt: now.toISOString(), status: 'OPT_OUT' as const }, // today
      { email: 'b@x.co', createdAt: now.toISOString(), status: 'OPT_OUT' as const }, // today
      { email: 'c@x.co', createdAt: daysAgo(3), status: 'OPT_IN' as const }, // week
      { email: 'd@x.co', createdAt: daysAgo(20), status: 'OPT_IN' as const }, // month
      { email: 'e@x.co', createdAt: daysAgo(60), status: 'OPT_IN' as const }, // total only
    ];
    const stats = buildSubscribersStats(subs, now);
    const by = Object.fromEntries(stats.rows.map((r) => [r.key, r]));

    expect(by.today).toMatchObject({ optIn: 0, optOut: 2, trend: 'down' });
    expect(by.week).toMatchObject({ optIn: 1, optOut: 2, trend: 'down' });
    expect(by.month).toMatchObject({ optIn: 2, optOut: 2, trend: 'down' }); // tie → down
    expect(by.total).toMatchObject({ optIn: 3, optOut: 2, trend: 'up' }); // more in than out
  });
});
