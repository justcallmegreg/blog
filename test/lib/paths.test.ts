import { describe, it, expect } from 'vitest';
import { parsePostPath, parseDeckPath, parseTransmissionPath } from '../../src/lib/paths';

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

describe('parseDeckPath', () => {
  it('maps {ns}/{slug}/index.md to /decks/{slug}', () => {
    const info = parseDeckPath('justcallmegreg-blog/demo-deck/index.md');
    expect(info).toEqual({
      slug: 'demo-deck',
      url: '/decks/demo-deck',
      urlPrefix: '/decks/demo-deck',
      contentDir: 'justcallmegreg-blog/demo-deck',
    });
  });
  it('returns null for non-matching paths', () => {
    expect(parseDeckPath('demo-deck/index.md')).toBeNull();
    expect(parseDeckPath('ns/demo-deck/other.md')).toBeNull();
  });
});

describe('parseTransmissionPath', () => {
  it('maps {ns}/{slug}/index.md to the /transmissions/{slug} url', () => {
    expect(parseTransmissionPath('justcallmegreg-blog/first-tx/index.md')).toEqual({
      slug: 'first-tx',
      url: '/transmissions/first-tx',
      urlPrefix: '/transmissions/first-tx',
      contentDir: 'justcallmegreg-blog/first-tx',
    });
  });
  it('returns null for a non-matching path', () => {
    expect(parseTransmissionPath('justcallmegreg-blog/first-tx/assets/poster.jpg')).toBeNull();
  });
});
