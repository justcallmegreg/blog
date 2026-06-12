// One-time asset transform (dev tool, not used at runtime): make the Vault Boy
// GIF's black background truly transparent.
//
//   npm i -D gifwrap   # already a devDependency
//   node scripts/make-transparent-gif.mjs [path]
//
// The source GIF is encoded with disposal=leave and ~527 1x1 "padding" frames
// (timing hacks). This composites each frame to a full canvas, drops the padding
// frames (folding their delay into the previous real frame), keys near-black
// pixels to fully transparent, and re-encodes full frames with disposal=restore-
// to-background so there's no ghosting. Loop count stays infinite here; the
// /vaultboy.gif endpoint patches it to effects.vaultBoyLoops at runtime.
import { GifUtil, GifFrame, GifCodec } from 'gifwrap';
import { writeFileSync } from 'node:fs';

const SRC = process.argv[2] ?? 'public/vaultboy-src.gif';
const THRESHOLD = 48; // per-channel: pixels darker than this become transparent

const gif = await GifUtil.read(SRC);
const W = gif.width;
const H = gif.height;
const canvas = Buffer.alloc(W * H * 4, 0);

function blit(frame) {
  const { width: fw, height: fh, data } = frame.bitmap;
  const ox = frame.xOffset | 0;
  const oy = frame.yOffset | 0;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const si = (y * fw + x) * 4;
      const di = (dy * W + dx) * 4;
      // Source frames have no transparency and disposal=leave → straight copy.
      canvas[di] = data[si];
      canvas[di + 1] = data[si + 1];
      canvas[di + 2] = data[si + 2];
      canvas[di + 3] = data[si + 3];
    }
  }
}

const kept = [];
let last = null;
for (const frame of gif.frames) {
  blit(frame);
  const fw = frame.bitmap.width;
  const fh = frame.bitmap.height;
  const delay = frame.delayCentisecs | 0;
  const snap = Buffer.from(canvas);
  const isPadding = (fw === 1 && fh === 1) || (last && snap.equals(last));
  if (isPadding) {
    if (kept.length) kept[kept.length - 1].delay += delay;
    last = snap;
    continue;
  }
  last = snap;
  const out = Buffer.from(snap);
  for (let p = 0; p < out.length; p += 4) {
    if (out[p] < THRESHOLD && out[p + 1] < THRESHOLD && out[p + 2] < THRESHOLD) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
    }
  }
  kept.push({ data: out, delay });
}

const frames = kept.map((k) => {
  const f = new GifFrame(W, H, k.data, {
    delayCentisecs: k.delay,
    disposalMethod: 2,
  });
  GifUtil.quantizeDekker(f, 256);
  return f;
});

const encoded = await new GifCodec().encodeGif(frames, { loops: 0 });
writeFileSync(SRC, encoded.buffer);
console.log(
  `kept ${frames.length}/${gif.frames.length} frames, ${W}x${H}, ${encoded.buffer.length} bytes -> ${SRC}`
);
