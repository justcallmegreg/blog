import { describe, it, expect } from 'vitest';
import { countInWindow, easeInValue, padDigits } from '../../src/lib/counter';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('countInWindow', () => {
  const now = new Date(2026, 5, 15); // 2026-06-15 (local)
  const daysAgo = (n: number) => ymd(new Date(2026, 5, 15 - n));

  it('returns 0 for no dates', () => {
    expect(countInWindow([], now, 30)).toBe(0);
  });
  it('counts today and the last 29 days, excludes day 30', () => {
    expect(countInWindow([daysAgo(0), daysAgo(29), daysAgo(30)], now, 30)).toBe(2);
  });
  it('ignores future-dated entries', () => {
    expect(countInWindow([daysAgo(-1), daysAgo(0)], now, 30)).toBe(1);
  });
  it('ignores malformed dates', () => {
    expect(countInWindow(['nope', '2026-13-40', daysAgo(1)], now, 30)).toBe(1);
  });
});

describe('easeInValue', () => {
  it('is 0 at progress 0 and target at progress 1', () => {
    expect(easeInValue(42, 0)).toBe(0);
    expect(easeInValue(42, 1)).toBe(42);
  });
  it('accelerates (t^2 curve)', () => {
    expect(easeInValue(100, 0.5)).toBe(25); // 100 * 0.25
  });
  it('clamps out-of-range progress', () => {
    expect(easeInValue(42, -0.5)).toBe(0);
    expect(easeInValue(42, 1.5)).toBe(42);
  });
});

describe('padDigits', () => {
  it('zero-pads to the width', () => {
    expect(padDigits(42, 4)).toBe('0042');
    expect(padDigits(0, 2)).toBe('00');
  });
  it('returns the full number when wider than the field', () => {
    expect(padDigits(1234, 2)).toBe('1234');
  });
});
