import { buildHeatmap } from '../heatmap';
import type {
  Subscriber,
  SubscriberStatRow,
  SubscribersStats,
  SubscribersView,
} from './types';

const DAY_MS = 86_400_000;

/** Opt-in vs opt-out counts per timeframe (by creation date), with a net trend. */
export function buildSubscribersStats(subs: Subscriber[], now: Date): SubscribersStats {
  // UTC day boundary, to stay consistent with the UTC-anchored SINCE date and
  // member-days (avoids a latent split if the pod's local TZ ever changes).
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const cutoffs: Record<SubscriberStatRow['key'], number> = {
    today: startOfToday.getTime(),
    week: now.getTime() - 7 * DAY_MS,
    month: now.getTime() - 30 * DAY_MS,
    total: -Infinity,
  };
  const labels: Record<SubscriberStatRow['key'], string> = {
    today: 'TODAY',
    week: '7 DAYS',
    month: '30 DAYS',
    total: 'TOTAL',
  };
  const keys: SubscriberStatRow['key'][] = ['today', 'week', 'month', 'total'];

  const rows = keys.map((key): SubscriberStatRow => {
    let optIn = 0;
    let optOut = 0;
    for (const s of subs) {
      if (new Date(s.createdAt).getTime() >= cutoffs[key]) {
        if (s.status === 'OPT_OUT') optOut += 1;
        else optIn += 1;
      }
    }
    return { key, label: labels[key], optIn, optOut, trend: optIn > optOut ? 'up' : 'down' };
  });

  return { rows };
}

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
      days: Math.max(0, Math.floor((now.getTime() - new Date(s.createdAt).getTime()) / DAY_MS)),
      status: s.status,
    }));
  return { heatmap, rows, total: subs.length, stats: buildSubscribersStats(subs, now) };
}
