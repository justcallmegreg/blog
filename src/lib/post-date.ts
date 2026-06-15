// Resolve a post's published date: an explicit, valid frontmatter `date` wins;
// otherwise the git first-add (merge) date; otherwise empty (undated).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function pickPublishedDate(
  frontmatterDate: string | undefined,
  gitDate: string | null
): string {
  if (frontmatterDate && YMD.test(frontmatterDate)) return frontmatterDate;
  if (gitDate) return gitDate;
  return '';
}
