// Dev tool: generate terminal-green sample puzzle images.
//   node scripts/make-puzzle-samples.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/puzzles', { recursive: true });

const W = 320, H = 180;
const variants = [
  { name: 'grid', bg: '#0b0f0b', fg: '#1f9a3f' },
  { name: 'scan', bg: '#0b1410', fg: '#33ff66' },
  { name: 'noise', bg: '#0c100c', fg: '#2bd455' },
];

function svg({ bg, fg }, i) {
  const lines = [];
  for (let x = 0; x <= W; x += 20) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${fg}" stroke-opacity="0.25"/>`);
  for (let y = 0; y <= H; y += 20) lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${fg}" stroke-opacity="0.25"/>`);
  const blocks = [];
  for (let b = 0; b < 14; b++) {
    const bx = (b * 53 + i * 31) % (W - 24);
    const by = (b * 37 + i * 17) % (H - 16);
    blocks.push(`<rect x="${bx}" y="${by}" width="18" height="10" fill="${fg}" fill-opacity="${0.3 + ((b + i) % 5) * 0.12}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    ${lines.join('')}
    ${blocks.join('')}
    <text x="10" y="${H - 12}" font-family="monospace" font-size="14" fill="${fg}" fill-opacity="0.7">ROBCO-${i}</text>
  </svg>`;
}

let n = 0;
for (const v of variants) {
  await sharp(Buffer.from(svg(v, n))).png().toFile(`public/puzzles/sample-${v.name}.png`);
  console.log(`wrote public/puzzles/sample-${v.name}.png`);
  n++;
}
