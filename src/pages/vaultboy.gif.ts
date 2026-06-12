import type { APIRoute } from 'astro';
import { readFileSync, existsSync } from 'node:fs';
import { getConfig } from '../lib/config';
import { setGifLoopCount } from '../lib/gif';

// Source ships in public/ (so it lands in dist/client at build time). We serve
// a loop-count-adjusted copy here at /vaultboy.gif and cache it per count.
const SOURCES = ['./dist/client/vaultboy-src.gif', './public/vaultboy-src.gif'];
let cache: { count: number; bytes: Uint8Array } | null = null;

function readSource(): Uint8Array | null {
  for (const p of SOURCES) {
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

export const GET: APIRoute = () => {
  const count = getConfig().effects.vaultBoyLoops;
  if (!cache || cache.count !== count) {
    const src = readSource();
    if (!src) return new Response('Not found', { status: 404 });
    cache = { count, bytes: setGifLoopCount(src, count) };
  }
  return new Response(cache.bytes, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'public, max-age=300',
    },
  });
};
