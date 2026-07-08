import { describe, it, expect } from 'vitest';
import { buildSubscribersView } from '../../../src/lib/overseer/view';

const now = new Date('2026-07-08T12:00:00.000Z');

describe('buildSubscribersView', () => {
  it('counts each subscriber on its created day and sorts rows newest-first', () => {
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
    const jul7 = view.heatmap.grid.flat().find((c) => c.date === '2026-07-07');
    expect(jul7?.count).toBe(2);
  });

  it('renders an empty view without throwing', () => {
    const view = buildSubscribersView([], now);
    expect(view.total).toBe(0);
    expect(view.rows).toEqual([]);
  });
});
