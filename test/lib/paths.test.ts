import { describe, it, expect } from 'vitest';
import { parsePostPath } from '../../src/lib/paths';

describe('parsePostPath', () => {
  it('parses a valid dated post path', () => {
    expect(parsePostPath('2026/06/12/my-post.md')).toEqual({
      year: '2026',
      month: '06',
      day: '12',
      slug: 'my-post',
      date: '2026-06-12',
      url: '/2026/06/12/my-post',
      urlPrefix: '/2026/06/12',
    });
  });

  it('returns null for non-dated paths', () => {
    expect(parsePostPath('README.md')).toBeNull();
    expect(parsePostPath('2026/06/my-post.md')).toBeNull();
    expect(parsePostPath('2026/06/12/notes.txt')).toBeNull();
    expect(parsePostPath('2026/6/12/my-post.md')).toBeNull();
  });

  it('rejects nested slugs and assets', () => {
    expect(parsePostPath('2026/06/12/assets/diagram.png')).toBeNull();
    expect(parsePostPath('2026/06/12/sub/post.md')).toBeNull();
  });
});
