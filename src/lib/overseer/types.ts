import type { Heatmap } from '../heatmap';

export type SubscriptionStatus = 'OPT_IN' | 'OPT_OUT';

export interface Subscriber {
  email: string;
  createdAt: string; // ISO 8601
  status: SubscriptionStatus;
}

export interface SubscriberRow {
  email: string;
  date: string; // YYYY.MM.DD
  status: SubscriptionStatus;
}

export interface SubscribersView {
  heatmap: Heatmap;
  rows: SubscriberRow[];
  total: number;
}
