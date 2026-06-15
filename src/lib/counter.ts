// Pure helpers for the odometer counter widget (unit-tested; the component's
// client script and the Blogs index import from here).

/**
 * Count `YYYY-MM-DD` dates falling within the last `days` calendar days ending
 * today (inclusive of today, exclusive of day `days`). UTC day arithmetic avoids
 * DST edge cases. Future-dated and unparseable entries are ignored.
 */
export function countInWindow(dates: string[], now: Date, days: number): number {
  const MS = 86_400_000;
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let n = 0;
  for (const s of dates) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) continue;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const d = Date.UTC(Number(m[1]), month - 1, day);
    const daysAgo = Math.round((end - d) / MS);
    if (daysAgo >= 0 && daysAgo < days) n++;
  }
  return n;
}

/** Accelerating (ease-in, t^2) value from 0 to `target` for `progress` in [0,1]. */
export function easeInValue(target: number, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return target;
  return Math.round(target * progress * progress);
}

/** Zero-pad `n` to `width` digits; if `n` is wider, return it in full. */
export function padDigits(n: number, width: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}
