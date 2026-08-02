import { describe, it, expect } from 'vitest';
import { wrapTitle, fitTitle, buildCardSvg, ADVANCE } from '../../src/lib/og/card';

describe('wrapTitle', () => {
  it('keeps a short title on one line', () => {
    expect(wrapTitle('Hello World', 20)).toEqual(['Hello World']);
  });
  it('wraps on word boundaries at exactly maxChars', () => {
    expect(wrapTitle('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
  });
  it('hard-breaks a single word longer than the line', () => {
    expect(wrapTitle('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('collapses runs of whitespace', () => {
    expect(wrapTitle('a   b\t c', 20)).toEqual(['a b c']);
  });
});

describe('fitTitle', () => {
  it('uses the largest size (96) for a short title', () => {
    expect(fitTitle('Short').fontSize).toBe(96);
  });
  it('steps down when the wrap exceeds 4 lines', () => {
    // At 96px: maxChars = floor(1008 / 48) = 21 → many lines; must step down.
    const long = 'word '.repeat(30).trim();
    const { fontSize, lines } = fitTitle(long);
    expect(fontSize).toBeLessThan(96);
    expect(lines.length).toBeLessThanOrEqual(4);
  });
  it('clamps to 4 lines at 60px and ellipsizes the last line', () => {
    const extreme = 'word '.repeat(80).trim();
    const { fontSize, lines } = fitTitle(extreme);
    expect(fontSize).toBe(60);
    expect(lines.length).toBe(4);
    expect(lines[3].endsWith('…')).toBe(true);
  });
  it('does not ellipsize when the title fits exactly', () => {
    const { lines } = fitTitle('Serving a Public Website From My Home Cluster');
    expect(lines.join(' ').includes('…')).toBe(false);
  });
});

describe('buildCardSvg', () => {
  const input = { header: 'GregCo // Personal log', title: 'A <Great> Post & More', meta: '2026-07-14 · 6 min read' };
  it('is a 1200x630 svg using VT323', () => {
    const svg = buildCardSvg(input);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('font-family="VT323"');
  });
  it('escapes XML in header/title/meta', () => {
    const svg = buildCardSvg(input);
    expect(svg).toContain('A &lt;Great&gt; Post &amp; More');
    expect(svg).not.toContain('<Great>');
  });
  it('contains header, divider rule, meta and block cursor', () => {
    const svg = buildCardSvg(input);
    expect(svg).toContain('GregCo // Personal log');
    expect(svg).toContain('2026-07-14 · 6 min read');
    // divider + cursor are rects filled with the theme green
    expect((svg.match(/<rect [^>]*fill="#33ff66"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('renders one <text> per wrapped title line', () => {
    const long = 'word '.repeat(30).trim();
    const { lines } = fitTitle(long);
    const svg = buildCardSvg({ header: 'h', title: long, meta: 'm' });
    // texts: 1 header + lines + 1 meta
    expect((svg.match(/<text /g) ?? []).length).toBe(lines.length + 2);
  });
});
