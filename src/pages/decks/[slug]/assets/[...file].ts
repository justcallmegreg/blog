import type { APIRoute } from 'astro';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { ensureStarted } from '../../../../lib/store-singleton';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export const GET: APIRoute = async ({ params }) => {
  const { slug, file } = params;
  if (!slug || !file) return new Response('Not found', { status: 404 });

  const store = await ensureStarted();
  const path = store.resolveDeckAssetPath(slug, file, new Date());
  if (!path) return new Response('Not found', { status: 404 });

  try {
    await stat(path);
    const data = await readFile(path);
    return new Response(data, {
      headers: {
        'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
