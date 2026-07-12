// Resolve a post's published date: the git mainline merge date wins;
// a valid frontmatter `date` is the fallback for environments without git
// history (local dev, missing clone); otherwise empty (undated).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function pickPublishedDate(
  frontmatterDate: string | undefined,
  gitDate: string | null
): string {
  if (gitDate) return gitDate;
  if (frontmatterDate && YMD.test(frontmatterDate)) return frontmatterDate;
  return '';
}

/**
 * Human relative age of a `YYYY-MM-DD` published date: "today", "yesterday", or
 * "N days ago". Whole-day UTC arithmetic (avoids DST edges); future dates read
 * as "today"; empty or malformed input returns '' so the caller can omit it.
 */
export function relativeDay(dateYMD: string, now: Date): string {
  if (!YMD.test(dateYMD)) return '';
  const MS = 86_400_000;
  const [y, m, d] = dateYMD.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - then) / MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
