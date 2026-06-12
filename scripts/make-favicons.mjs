// One-time asset tool: generate small favicons from the profile picture.
//   node scripts/make-favicons.mjs [src]
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'public/profile_picture.png';
const targets = [
  ['public/favicon-32.png', 32],
  ['public/favicon-180.png', 180],
];
for (const [out, size] of targets) {
  await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
