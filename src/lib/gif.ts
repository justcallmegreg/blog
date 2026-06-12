const NETSCAPE = 'NETSCAPE2.0';

function indexOfMarker(bytes: Uint8Array, marker: string): number {
  for (let i = 0; i + marker.length <= bytes.length; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * Return a copy of a GIF with its animation loop count set to `count`
 * (0 = infinite). The Netscape Application Extension stores the loop count, so
 * the browser plays the animation exactly `count` times and then stops on the
 * last frame — no client-side timing needed. If the GIF already has the
 * extension the two loop bytes are patched in place; otherwise a fresh
 * extension is inserted after the logical screen descriptor / global color table.
 */
export function setGifLoopCount(buf: Uint8Array, count: number): Uint8Array {
  const bytes = Uint8Array.from(buf);
  const c = Math.max(0, Math.floor(count));
  const idx = indexOfMarker(bytes, NETSCAPE);

  if (idx >= 0) {
    // sub-block after the 11-byte app id: [0x03, 0x01, loopLo, loopHi, 0x00]
    bytes[idx + 13] = c & 0xff;
    bytes[idx + 14] = (c >> 8) & 0xff;
    return bytes;
  }

  // No Netscape extension: insert one after header(6) + LSD(7) + optional GCT.
  let pos = 13;
  const packed = bytes[10];
  if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));

  const ext = Uint8Array.from([
    0x21, 0xff, 0x0b, // extension introducer, app-extension label, block size 11
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
    0x03, 0x01, c & 0xff, (c >> 8) & 0xff, 0x00, // sub-block: loop count + terminator
  ]);

  const out = new Uint8Array(bytes.length + ext.length);
  out.set(bytes.subarray(0, pos), 0);
  out.set(ext, pos);
  out.set(bytes.subarray(pos), pos + ext.length);
  return out;
}
