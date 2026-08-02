import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleOgCard, postCard, transmissionCard } from '../../src/pages/og/[collection]/[slug].png';
import { __resetOgCacheForTests } from '../../src/lib/og/render';

const post = { title: 'A Test Post', date: '2026-07-14', readingMinutes: 6, blobHash: 'abc123' };
const deps = {
  lookup: (c: string, s: string) =>
    c === 'blog' && s === 'a-test-post' ? postCard('GregCo', post) : undefined,
};
const defaultBytes = () => readFileSync('./public/og-default.png');

describe('handleOgCard', () => {
  beforeEach(() => __resetOgCacheForTests());

  it('200 image/png for a live post', () => {
    const r = handleOgCard('blog', 'a-test-post', deps);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    expect((r.body as Buffer).subarray(0, 4).toString('hex')).toBe('89504e47');
    // a rendered card, not the fallback
    expect((r.body as Buffer).equals(defaultBytes())).toBe(false);
  });

  it('unknown slug → 200 default banner, not 500 (also covers hidden/draft: lookup returns undefined)', () => {
    const r = handleOgCard('blog', 'nope', deps);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).equals(defaultBytes())).toBe(true);
  });

  it('invalid collection → 200 default banner without calling lookup', () => {
    let called = false;
    const r = handleOgCard('evil', 'x', { lookup: () => ((called = true), undefined) });
    expect(r.status).toBe(200);
    expect(called).toBe(false);
    expect((r.body as Buffer).equals(defaultBytes())).toBe(true);
  });
});

describe('card builders', () => {
  it('postCard: header, meta with reading time, blobHash key', () => {
    const { key, card } = postCard('GregCo', post);
    expect(key).toBe('post:abc123');
    expect(card.header).toBe('GregCo // Personal log');
    expect(card.meta).toBe('2026-07-14 · 6 min read');
    expect(card.title).toBe('A Test Post');
  });
  it('postCard omits the date separator for undated posts', () => {
    expect(postCard('G', { ...post, date: '' }).card.meta).toBe('6 min read');
  });
  it('transmissionCard: Transmission log header and meta', () => {
    const { key, card } = transmissionCard('GregCo', { title: 'T', date: '2026-07-19', blobHash: 'z9' });
    expect(key).toBe('tx:z9');
    expect(card.header).toBe('GregCo // Transmission log');
    expect(card.meta).toBe('2026-07-19 · Transmission');
  });
});
