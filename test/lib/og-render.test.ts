import { describe, it, expect, beforeEach } from 'vitest';
import { renderCardPng, defaultBannerPng, __resetOgCacheForTests } from '../../src/lib/og/render';

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

describe('defaultBannerPng', () => {
  it('returns the committed default banner bytes', () => {
    const png = defaultBannerPng();
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
