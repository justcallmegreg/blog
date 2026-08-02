// Pure SVG card template for social-embed (Open Graph) banners.
// Log-entry style: header + divider + wrapped title + meta with block cursor.
// VT323 is fixed-width, so fitting is exact arithmetic — no text measuring.
// See docs/superpowers/specs/2026-08-02-per-post-og-banners-design.md.

export interface CardInput {
  header: string;
  title: string;
  meta: string;
}

const W = 1200;
const H = 630;
const MARGIN = 96;
const MAX_TEXT_WIDTH = W - 2 * MARGIN; // 1008
/**
 * VT323 advance-width ratio (advance / font-size). Measured from the bundled
 * font: unitsPerEm=1000, advanceWidth=400 for all rendered glyphs → 0.4 em.
 * See test/lib/og-card.test.ts for a guard that parses the font and asserts this.
 */
export const ADVANCE = 0.4;
const TITLE_SIZES = [96, 84, 72, 60];
const MAX_LINES = 4;
/** Vertical space available for the title block, between the divider and the meta line. */
const BLOCK_HEIGHT = 380;
const lineHeightFor = (fontSize: number) => Math.round(fontSize * 1.05);

/** Word-wrap at maxChars; hard-break words longer than a whole line. */
export function wrapTitle(title: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const word of title.split(/\s+/).filter(Boolean)) {
    let w = word;
    if (cur && (cur + ' ' + w).length <= maxChars) {
      cur += ' ' + w;
      continue;
    }
    push();
    while (w.length > maxChars) {
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    cur = w;
  }
  push();
  return lines;
}

/** Step the font size down until the wrapped title fits; clamp + ellipsize at minimum. */
export function fitTitle(title: string): { fontSize: number; lines: string[] } {
  for (const fontSize of TITLE_SIZES) {
    const maxChars = Math.floor(MAX_TEXT_WIDTH / (fontSize * ADVANCE));
    const lines = wrapTitle(title, maxChars);
    // Line count alone isn't enough: at the larger sizes, 4 short lines can still
    // out-run the vertical block budget and crowd the meta line below. Require both.
    if (lines.length <= MAX_LINES && lines.length * lineHeightFor(fontSize) <= BLOCK_HEIGHT) {
      return { fontSize, lines };
    }
  }
  const fontSize = TITLE_SIZES[TITLE_SIZES.length - 1];
  const maxChars = Math.floor(MAX_TEXT_WIDTH / (fontSize * ADVANCE));
  const all = wrapTitle(title, maxChars);
  const lines = all.slice(0, MAX_LINES);
  const last = lines[MAX_LINES - 1];
  lines[MAX_LINES - 1] = (last.length + 1 > maxChars ? last.slice(0, maxChars - 1) : last) + '…';
  return { fontSize, lines };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildCardSvg(input: CardInput): string {
  const { fontSize, lines } = fitTitle(input.title);
  const lineH = lineHeightFor(fontSize);
  // Title block vertically centered between divider (y≈130) and meta (y≈540).
  const blockTop = 150 + Math.max(0, Math.round((BLOCK_HEIGHT - lines.length * lineH) / 2));
  const titleTexts = lines
    .map(
      (l, i) =>
        `<text x="${MARGIN}" y="${blockTop + Math.round((i + 0.8) * lineH)}" font-size="${fontSize}" fill="#33ff66">${esc(l)}</text>`
    )
    .join('\n  ');
  const metaSize = 34;
  const cursorX = MARGIN + Math.round(input.meta.length * metaSize * ADVANCE) + 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="VT323">
  <rect width="${W}" height="${H}" fill="#0b0f0b"/>
  <defs>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect y="2" width="4" height="1" fill="#000000" opacity="0.28"/>
    </pattern>
    <radialGradient id="vig" cx="30%" cy="20%" r="90%">
      <stop offset="0%" stop-color="#33ff66" stop-opacity="0.10"/>
      <stop offset="60%" stop-color="#33ff66" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <text x="${MARGIN}" y="96" font-size="30" fill="#33ff66" opacity="0.85">${esc(input.header)}</text>
  <rect x="${MARGIN}" y="118" width="${MAX_TEXT_WIDTH}" height="2" fill="#33ff66" opacity="0.6"/>
  ${titleTexts}
  <text x="${MARGIN}" y="556" font-size="${metaSize}" fill="#33ff66" opacity="0.9">${esc(input.meta)}</text>
  <rect x="${cursorX}" y="528" width="18" height="34" fill="#33ff66"/>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
</svg>`;
}
