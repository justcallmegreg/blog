export interface PostPathInfo {
  year: string;
  month: string;
  day: string;
  slug: string;
  date: string;
  url: string;
  urlPrefix: string;
}

const POST_PATH = /^(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\.md$/;

export function parsePostPath(relPath: string): PostPathInfo | null {
  const match = POST_PATH.exec(relPath);
  if (!match) return null;
  const [, year, month, day, slug] = match;
  const urlPrefix = `/${year}/${month}/${day}`;
  return {
    year,
    month,
    day,
    slug,
    date: `${year}-${month}-${day}`,
    url: `${urlPrefix}/${slug}`,
    urlPrefix,
  };
}
