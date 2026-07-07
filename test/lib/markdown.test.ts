import { describe, it, expect } from 'vitest';
import { renderMarkdown, extractExcerpt } from '../../src/lib/markdown';

describe('extractExcerpt', () => {
  it('takes the first prose paragraph, skipping a leading heading', () => {
    const md = '# My Title\n\nThis is the **first** paragraph.\n\nSecond paragraph.';
    expect(extractExcerpt(md)).toBe('This is the first paragraph.');
  });

  it('collapses whitespace and strips inline markdown to plain text', () => {
    expect(extractExcerpt('A [link](http://x) and `code`\nwrapped line.')).toBe(
      'A link and code wrapped line.'
    );
  });

  it('caps at maxWords and appends an ellipsis', () => {
    const body = Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ');
    expect(extractExcerpt(body, 3)).toBe('w0 w1 w2…');
  });

  it('returns empty string when there is no paragraph', () => {
    expect(extractExcerpt('# Only a heading')).toBe('');
  });
});

describe('renderMarkdown', () => {
  it('renders markdown to HTML', async () => {
    const html = await renderMarkdown('# Title\n\nHello **world**', '/2026/06/12');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<strong>world</strong>');
  });

  it('rewrites relative ./assets and assets/ image URLs to absolute', async () => {
    const html = await renderMarkdown(
      '![d](./assets/diagram.png)\n\n![e](assets/photo.jpg)',
      '/2026/06/12'
    );
    expect(html).toContain('src="/2026/06/12/assets/diagram.png"');
    expect(html).toContain('src="/2026/06/12/assets/photo.jpg"');
  });

  it('leaves absolute and external URLs untouched', async () => {
    const html = await renderMarkdown(
      '![a](/already/abs.png)\n\n![b](https://x.com/i.png)',
      '/2026/06/12'
    );
    expect(html).toContain('src="/already/abs.png"');
    expect(html).toContain('src="https://x.com/i.png"');
  });

  it('highlights fenced code blocks', async () => {
    const html = await renderMarkdown('```js\nconst x = 1;\n```', '/2026/06/12');
    expect(html).toContain('<pre');
    expect(html).toContain('shiki');
  });

  it('opens external links in a new tab with a safe rel', async () => {
    const html = await renderMarkdown('[ext](https://example.com/page)', '/2026/06/12');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/);
    expect(html).toMatch(/rel="[^"]*\bnoreferrer\b[^"]*"/);
  });

  it('opens http (non-TLS) external links in a new tab too', async () => {
    const html = await renderMarkdown('[ext](http://example.com)', '/2026/06/12');
    expect(html).toContain('target="_blank"');
  });

  it('leaves internal links in the same tab', async () => {
    const html = await renderMarkdown(
      '[post](/some-slug)\n\n[anchor](#section)\n\n[asset](assets/x.pdf)',
      '/2026/06/12'
    );
    expect(html).not.toContain('target="_blank"');
  });

  it('does not add target to mailto links', async () => {
    const html = await renderMarkdown('[mail](mailto:me@example.com)', '/2026/06/12');
    expect(html).not.toContain('target="_blank"');
  });
});
