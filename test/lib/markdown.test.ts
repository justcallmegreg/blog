import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';

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
});
