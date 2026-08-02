import type { APIRoute } from 'astro';
import { ensureStarted } from '../../../lib/store-singleton';
import { getConfig } from '../../../lib/config';
import { renderCardPng, defaultBannerPng } from '../../../lib/og/render';
import type { CardInput } from '../../../lib/og/card';
import type { Post, Transmission } from '../../../lib/content-store';

export interface OgLookup {
  key: string;
  card: CardInput;
}
export interface OgDeps {
  lookup(collection: string, slug: string): OgLookup | undefined;
}

export function postCard(
  siteTitle: string,
  post: Pick<Post, 'title' | 'date' | 'readingMinutes' | 'blobHash'>
): OgLookup {
  return {
    key: `post:${post.blobHash}`,
    card: {
      header: `${siteTitle} // Personal log`,
      title: post.title,
      meta: `${post.date ? post.date + ' · ' : ''}${post.readingMinutes} min read`,
    },
  };
}

export function transmissionCard(
  siteTitle: string,
  tx: Pick<Transmission, 'title' | 'date' | 'blobHash'>
): OgLookup {
  return {
    key: `tx:${tx.blobHash}`,
    card: {
      header: `${siteTitle} // Transmission log`,
      title: tx.title,
      meta: `${tx.date ? tx.date + ' · ' : ''}Transmission`,
    },
  };
}

/** Testable core. Never 500s: any miss or render failure serves the default banner. */
export function handleOgCard(
  collection: string,
  slug: string,
  deps: OgDeps
): { status: number; contentType: string; body: Buffer | string } {
  const valid = collection === 'blog' || collection === 'transmissions';
  const found = valid ? deps.lookup(collection, slug) : undefined;
  const png = found ? renderCardPng(found.key, found.card) : null;
  const body = png ?? defaultBannerPng();
  // Default missing = broken build; mirror vaultboy.gif.ts's 404.
  if (!body) return { status: 404, contentType: 'text/plain', body: 'Not found' };
  return { status: 200, contentType: 'image/png', body };
}

export const GET: APIRoute = async ({ params }) => {
  const cfg = getConfig();
  const store = await ensureStarted();
  const now = new Date();
  const res = handleOgCard(String(params.collection), String(params.slug), {
    lookup: (collection, slug) => {
      if (collection === 'blog') {
        const p = store.getLivePost(`/${slug}`, now);
        return p ? postCard(cfg.site.title, p) : undefined;
      }
      // getLiveTransmission already excludes drafts/hidden/scheduled entries;
      // when transmissions are disabled the card falls back to the default.
      if (!cfg.transmissions.enabled) return undefined;
      const t = store.getLiveTransmission(`/transmissions/${slug}`, now);
      return t ? transmissionCard(cfg.site.title, t) : undefined;
    },
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.contentType,
      ...(res.status === 200 ? { 'cache-control': 'public, max-age=3600' } : {}),
    },
  });
};
