import { describe, it, expect, beforeEach } from 'vitest';
import { renderCardPng, defaultBannerPng, __resetOgCacheForTests, CACHE_MAX } from '../../src/lib/og/render';

const input = { header: 'GregCo // Personal log', title: 'A Test Post', meta: '2026-07-14 · 6 min read' };

describe('renderCardPng', () => {
  beforeEach(() => __resetOgCacheForTests());

  it('renders a PNG (magic bytes, nonzero length)', () => {
    const png = renderCardPng('k1', input);
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47'); // \x89PNG
    expect(png!.length).toBeGreaterThan(1000);
  });

  it('returns the identical Buffer for the same key (cache hit)', () => {
    const a = renderCardPng('k1', input);
    const b = renderCardPng('k1', { ...input, title: 'Ignored — cache key wins' });
    expect(b).toBe(a);
  });

  it('renders distinct output for a different key/title', () => {
    const a = renderCardPng('k1', input);
    const b = renderCardPng('k2', { ...input, title: 'A Completely Different Title' });
    expect(b).not.toBeNull();
    expect(a!.equals(b!)).toBe(false);
  });
});

describe('cache eviction (FIFO cap)', () => {
  beforeEach(() => __resetOgCacheForTests());

  // Tiny cards (1-char header/title/meta) keep resvg render time down since
  // this fills the cache to CACHE_MAX + 1 entries (~201 renders).
  it('evicts the oldest entry once CACHE_MAX is exceeded, while recent entries stay cached', () => {
    const tiny = { header: 'h', title: 'T', meta: 'm' };
    const oldestKey = 'evict-0';
    const oldest = renderCardPng(oldestKey, tiny);
    for (let i = 1; i < CACHE_MAX; i++) {
      renderCardPng(`evict-${i}`, tiny);
    }
    // Cache now holds exactly CACHE_MAX entries: evict-0 .. evict-(CACHE_MAX-1).
    const recentKey = `evict-${CACHE_MAX - 1}`;
    const recentBefore = renderCardPng(recentKey, tiny); // cache hit, not a new render

    // One more insert overflows the cap and must evict the oldest (evict-0).
    renderCardPng('evict-overflow', tiny);

    const oldestAfter = renderCardPng(oldestKey, tiny);
    expect(oldestAfter).not.toBeNull();
    expect(oldestAfter).not.toBe(oldest); // evicted → freshly re-rendered, not the cached Buffer

    const recentAfter = renderCardPng(recentKey, tiny);
    expect(recentAfter).toBe(recentBefore); // still cached, identical Buffer
  }, 30000);
});

describe('defaultBannerPng', () => {
  it('returns the committed default banner bytes', () => {
    const png = defaultBannerPng();
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
