export interface RssItem {
  title: string;
  url: string; // site-root-relative, e.g. /2026/06/12/slug
  date: string; // YYYY-MM-DD
  description?: string;
}

export interface RssOptions {
  title: string;
  description: string;
  siteUrl: string; // origin, no trailing slash
  feedUrl: string; // absolute URL of this feed
  items: RssItem[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** YYYY-MM-DD -> RFC 822 date string (UTC midnight); '' if unparseable. */
function rfc822(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toUTCString();
}

/** Build an RSS 2.0 feed document from site metadata and a list of items. */
export function buildRss(opts: RssOptions): string {
  const items = opts.items
    .map((it) => {
      const link = `${opts.siteUrl}${it.url}`;
      return `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${rfc822(it.date)}</pubDate>
      <description>${esc(it.description ?? '')}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(opts.title)}</title>
    <link>${esc(opts.siteUrl)}</link>
    <description>${esc(opts.description)}</description>
    <atom:link href="${esc(opts.feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}
