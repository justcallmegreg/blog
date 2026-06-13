// Generic GitHub-style daily activity heatmap (reused by Contributions + Blogs).

export interface HeatCell {
  date: string; // YYYY-MM-DD
  count: number;
  level: number; // 0..4
  future: boolean; // date is after `now` — no data possible yet
}

export interface Heatmap {
  dayLabels: string[]; // 7 labels, Monday-first
  weekLabels: string[]; // ISO week number per column (oldest → newest)
  weeks: number;
  grid: HeatCell[][]; // grid[dayRow 0..6][weekCol 0..weeks-1]; dayRow 0 = Monday
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/**
 * GitHub-style daily heatmap for the last `weeks` weeks (≈ last month).
 * Rows are days of the week (Monday-first), columns are weeks (oldest → newest).
 * `grid[dayRow][weekCol]`. Dates after `now` are flagged `future`. Each input
 * item contributes 1 to its day; dates outside the window are ignored.
 */
export function buildHeatmap(
  items: { createdAt: string }[],
  now: Date,
  weeks = 5
): Heatmap {
  const mondayOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

  const counts = new Map<string, number>();
  for (const it of items) {
    const key = ymd(new Date(it.createdAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const todayKey = ymd(now);
  const monday = mondayOf(now);
  const base = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (weeks - 1) * 7);

  const grid: HeatCell[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: HeatCell[] = [];
    for (let w = 0; w < weeks; w++) {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + w * 7 + d);
      const key = ymd(date);
      const count = counts.get(key) ?? 0;
      row.push({ date: key, count, level: heatLevel(count), future: key > todayKey });
    }
    grid.push(row);
  }

  const weekLabels: string[] = [];
  for (let w = 0; w < weeks; w++) {
    const colMonday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + w * 7);
    weekLabels.push(String(isoWeek(colMonday)));
  }

  return { dayLabels: DAY_LABELS, weekLabels, weeks, grid };
}
