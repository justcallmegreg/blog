import { describe, it, expect } from 'vitest';
import { buildRss } from '../../src/lib/rss';

const xml = buildRss({
  title: 'My & Blog',
  description: 'Desc <here>',
  siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/rss.xml',
  items: [
    {
      title: 'Post <1>',
      url: '/2026/06/12/p1',
      date: '2026-06-12',
      description: 'Teaser & more',
    },
  ],
});

describe('buildRss', () => {
  it('is RSS 2.0 with channel metadata', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<link>https://example.com</link>');
  });

  it('escapes XML in titles and descriptions', () => {
    expect(xml).toContain('<title>My &amp; Blog</title>');
    expect(xml).toContain('<title>Post &lt;1&gt;</title>');
    expect(xml).toContain('Teaser &amp; more');
  });

  it('emits absolute item links, a guid, and an RFC-822 pubDate', () => {
    expect(xml).toContain('<link>https://example.com/2026/06/12/p1</link>');
    expect(xml).toContain('<guid isPermaLink="true">https://example.com/2026/06/12/p1</guid>');
    expect(xml).toContain('<pubDate>Fri, 12 Jun 2026 00:00:00 GMT</pubDate>');
  });

  it('includes a self-referential atom:link', () => {
    expect(xml).toContain('rel="self"');
    expect(xml).toContain('href="https://example.com/rss.xml"');
  });
});
