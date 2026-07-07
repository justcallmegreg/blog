import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A privacy blocker (e.g. Brave Shields) blocks any request whose URL contains
// "matomo" — including our first-party, bundled matomo chunk. If the consent
// gate or analytics scripts STATICALLY import that chunk, the whole module fails
// to load in such a browser: the ACCEPT handler is never attached and the opaque
// consent overlay can never be dismissed, so the page appears blocked. Matomo
// must therefore only ever be pulled in via a guarded, catchable dynamic import.
const STATIC_MATOMO = /import\s*\{[^}]*\}\s*from\s*['"][^'"]*matomo['"]/;

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('consent gate is resilient to matomo-blocking browsers', () => {
  it('ConsentBanner does not statically import the matomo chunk', () => {
    expect(STATIC_MATOMO.test(src('src/components/ConsentBanner.astro'))).toBe(false);
  });

  it('Analytics does not statically import the matomo chunk', () => {
    expect(STATIC_MATOMO.test(src('src/components/Analytics.astro'))).toBe(false);
  });
});
