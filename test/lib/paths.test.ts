import { describe, it, expect } from 'vitest';
import { parsePostPath } from '../../src/lib/paths';

describe('parsePostPath', () => {
  it('parses {ns}/{slug}/index.md into a slug URL + content dir', () => {
    expect(parsePostPath('justcallmegreg-blog/my-post/index.md')).toEqual({
      slug: 'my-post',
      url: '/my-post',
      urlPrefix: '/my-post',
      contentDir: 'justcallmegreg-blog/my-post',
    });
  });
  it('ignores asset files (no index.md match)', () => {
    expect(parsePostPath('justcallmegreg-blog/my-post/assets/x.png')).toBeNull();
  });
  it('ignores non-post paths', () => {
    expect(parsePostPath('README.md')).toBeNull();
    expect(parsePostPath('my-post/index.md')).toBeNull();  // too shallow ({slug}/index.md, no namespace)
    expect(parsePostPath('a/b/c/index.md')).toBeNull();    // too deep
  });
});
