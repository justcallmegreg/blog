import { describe, it, expect, vi } from 'vitest';
import { parseDeckSource, renderDeckSlides } from '../../src/lib/deck';

const DECK = `---
title: "DEMO"
subtitle: "SUB"
publishAt: "2030-01-01T09:00"
---

EYEBROW LINE

# BIG TITLE

SUBTITLE LINE

---

## LIST SLIDE

- ONE
- TWO

---

## DIAGRAM

\`\`\`mermaid
graph LR
  A --> B
\`\`\`

---

<!-- slide: stat -->

# 42%

LABEL

---

<!-- slide: two-col -->

## SPLIT

LEFT SIDE

<!-- col -->

RIGHT SIDE

---

<!-- slide: standby -->

# BYE
`;

describe('parseDeckSource', () => {
  it('parses frontmatter with defaults', () => {
    const d = parseDeckSource(DECK);
    expect(d.meta.title).toBe('DEMO');
    expect(d.meta.subtitle).toBe('SUB');
    expect(d.meta.theme).toBe('pipboy');
    expect(d.meta.draft).toBe(false);
    expect(d.meta.publishAt).toBe('2030-01-01T09:00');
  });

  it('splits slides on --- and applies layout rules', () => {
    const d = parseDeckSource(DECK);
    expect(d.slides.map((s) => s.layout)).toEqual([
      'title', 'default', 'default', 'stat', 'two-col', 'standby',
    ]);
  });

  it('does not split on --- inside fenced code', () => {
    const d = parseDeckSource('# A\n\n```text\n---\n```\n\n---\n\n# B\n');
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0].parts[0]).toContain('---');
  });

  it('falls back to default on an unknown layout and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = parseDeckSource('<!-- slide: hologram -->\n# X\n');
    // A directive WAS present (just unknown), so the slide-1 auto-`title` rule
    // does not apply — the fallback is `default`.
    expect(d.slides[0].layout).toBe('default');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hologram'));
    warn.mockRestore();
  });

  it('derives a missing title from the first slide H1', () => {
    const d = parseDeckSource('# DERIVED\n\nbody\n');
    expect(d.meta.title).toBe('DERIVED');
  });

  it('splits two-col parts and extracts the leading heading', () => {
    const d = parseDeckSource(DECK);
    const tc = d.slides[4];
    expect(tc.head).toBe('## SPLIT');
    expect(tc.parts).toEqual(['LEFT SIDE', 'RIGHT SIDE']);
  });

  it('throws a clear error on wrong frontmatter types', () => {
    expect(() => parseDeckSource('---\ntitle: 5\n---\nbody')).toThrow(/title/);
  });
});

describe('renderDeckSlides', () => {
  const fake = async (md: string) => `[${md}]`;

  it('renders one part per normal slide', async () => {
    const d = parseDeckSource('# A\n\n---\n\n## B\n');
    const out = await renderDeckSlides(d, fake);
    expect(out).toEqual([
      { layout: 'title', html: '[# A]' },
      { layout: 'default', html: '[## B]' },
    ]);
  });

  it('assembles two-col with head + cols wrapper', async () => {
    const d = parseDeckSource('<!-- slide: two-col -->\n## H\n\nL\n\n<!-- col -->\n\nR\n');
    const out = await renderDeckSlides(d, fake);
    expect(out[0].html).toBe(
      '[## H]<div class="cols"><div class="col">[L]</div><div class="col">[R]</div></div>'
    );
  });
});
