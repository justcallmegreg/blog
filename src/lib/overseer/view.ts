import { buildHeatmap } from '../heatmap';
import type { Subscriber, SubscribersView } from './types';

/** Build the Subscribers-tab view model from raw SES subscribers. Pure. */
export function buildSubscribersView(subs: Subscriber[], now: Date): SubscribersView {
  const heatmap = buildHeatmap(
    subs.map((s) => ({ createdAt: s.createdAt })),
    now
  );
  const rows = [...subs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({
      email: s.email,
      date: s.createdAt.slice(0, 10).replace(/-/g, '.'),
      status: s.status,
    }));
  return { heatmap, rows, total: subs.length };
}
