// One-off: regenerate public/og-default.png from the shared card template so
// the static default and the runtime cards look identical.
// Run: node --experimental-strip-types scripts/render-og-default.ts
//      (node < 22.6: npx tsx scripts/render-og-default.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { buildCardSvg } from '../src/lib/og/card.ts';

const font = readFileSync('./public/fonts/VT323-Regular.ttf');
const svg = buildCardSvg({
  header: 'justcallmegreg.io // Personal log',
  title: 'GregCo Industries Unified Operating System',
  meta: 'Personal log — Commonwealth relay node',
});
const png = new Resvg(svg, {
  font: { fontBuffers: [font], defaultFontFamily: 'VT323', loadSystemFonts: false },
})
  .render()
  .asPng();
writeFileSync('./public/og-default.png', png);
console.log(`wrote public/og-default.png (${png.length} bytes)`);
