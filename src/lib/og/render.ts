// resvg wiring for OG cards: bundled-font rasterization, blobHash-keyed FIFO
// cache, and the default-banner fallback bytes. sharp is NOT used here — its
// librsvg text path needs fontconfig/system fonts (absent on Alpine); resvg
// takes the font as an in-memory buffer.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, existsSync } from 'node:fs';
import { buildCardSvg, type CardInput } from './card';

// public/ ships to dist/client at build; same lookup convention as vaultboy.gif.ts.
const FONT_SOURCES = ['./dist/client/fonts/VT323-Regular.ttf', './public/fonts/VT323-Regular.ttf'];
const DEFAULT_SOURCES = ['./dist/client/og-default.png', './public/og-default.png'];

function readFirst(paths: string[]): Buffer | null {
  for (const p of paths) {
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

let fontBuf: Buffer | null | undefined;
let defaultBuf: Buffer | null | undefined;

export function defaultBannerPng(): Buffer | null {
  if (defaultBuf === undefined) defaultBuf = readFirst(DEFAULT_SOURCES);
  return defaultBuf;
}

const cache = new Map<string, Buffer>();
const CACHE_MAX = 200;
const warned = new Set<string>();

/** Cached SVG→PNG render. Returns null on any failure (warned once per key). */
export function renderCardPng(key: string, input: CardInput): Buffer | null {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (fontBuf === undefined) fontBuf = readFirst(FONT_SOURCES);
    if (!fontBuf) throw new Error('VT323-Regular.ttf not found');
    const png = Buffer.from(
      new Resvg(buildCardSvg(input), {
        font: { fontBuffers: [fontBuf], defaultFontFamily: 'VT323', loadSystemFonts: false },
      })
        .render()
        .asPng()
    );
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, png);
    return png;
  } catch (err) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[og] render failed for ${key}: ${(err as Error).message}`);
    }
    return null;
  }
}

export function __resetOgCacheForTests(): void {
  cache.clear();
  warned.clear();
  fontBuf = undefined;
  defaultBuf = undefined;
}
