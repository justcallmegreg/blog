import type { APIRoute } from 'astro';
import { ensureStarted } from '../lib/store-singleton';
import { getConfig } from '../lib/config';
import { buildRss } from '../lib/rss';

export const GET: APIRoute = async ({ url }) => {
  const cfg = getConfig();
  const store = await ensureStarted();
  // Prefer the configured baseUrl; otherwise derive the origin from the request.
  const siteUrl = (cfg.site.baseUrl ?? url.origin).replace(/\/$/, '');

  const xml = buildRss({
    title: cfg.site.title,
    description: cfg.site.description,
    siteUrl,
    feedUrl: `${siteUrl}/rss.xml`,
    items: store.listPosts(new Date()).map((p) => ({
      title: p.title,
      url: p.url,
      date: p.date,
      description: p.excerpt,
    })),
  });

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
