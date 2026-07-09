import type { Heatmap } from '../heatmap';

export type SubscriptionStatus = 'OPT_IN' | 'OPT_OUT';

export interface Subscriber {
  email: string;
  createdAt: string; // ISO 8601
  status: SubscriptionStatus;
}

export interface SubscriberRow {
  email: string;
  date: string; // YYYY.MM.DD — subscribed since
  days: number; // whole days a member (now - createdAt)
  status: SubscriptionStatus;
}

export type StatTrend = 'up' | 'down';

/** Opt-in vs opt-out counts for one timeframe, with a net trend. */
export interface SubscriberStatRow {
  key: 'today' | 'week' | 'month' | 'total';
  label: string;
  optIn: number;
  optOut: number;
  trend: StatTrend; // 'up' when optIn > optOut, else 'down'
}

export interface SubscribersStats {
  rows: SubscriberStatRow[];
}

export interface SubscribersView {
  heatmap: Heatmap;
  rows: SubscriberRow[];
  total: number;
  stats: SubscribersStats;
}
