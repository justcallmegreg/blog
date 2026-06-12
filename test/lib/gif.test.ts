import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setGifLoopCount } from '../../src/lib/gif';

function loopCount(bytes: Uint8Array): number | null {
  const s = Buffer.from(bytes).toString('latin1');
  const i = s.indexOf('NETSCAPE2.0');
  if (i < 0) return null;
  return bytes[i + 13] | (bytes[i + 14] << 8);
}

describe('setGifLoopCount', () => {
  const src = readFileSync('public/vaultboy-src.gif');

  it('patches the loop count in place when a Netscape extension exists', () => {
    const out = setGifLoopCount(src, 3);
    expect(loopCount(out)).toBe(3);
    expect(out.length).toBe(src.length); // patched in place, no size change
  });

  it('supports 0 (infinite loop)', () => {
    expect(loopCount(setGifLoopCount(src, 0))).toBe(0);
  });

  it('inserts a Netscape extension when none is present', () => {
    // minimal GIF89a: header + logical screen descriptor (no GCT) + trailer
    const mini = Uint8Array.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      1, 0, 1, 0, 0x00, 0, 0, // LSD (packed=0x00 → no global color table)
      0x3b, // trailer
    ]);
    const out = setGifLoopCount(mini, 5);
    expect(loopCount(out)).toBe(5);
    expect(out.length).toBe(mini.length + 19); // app-extension block length
  });
});
