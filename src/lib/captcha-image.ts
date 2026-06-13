import sharp from 'sharp';

export const CANVAS_W = 320;
export const CANVAS_H = 180;
export const PIECE_SIZE = 56;
const MARGIN = 8;

export interface Puzzle {
  background: Buffer;
  piece: Buffer;
  gapX: number;
  gapY: number;
  pieceSize: number;
  width: number;
  height: number;
}

/** SVG path for the puzzle-piece shape (rounded square + a small top tab). */
function shapePath(size: number): string {
  const s = size;
  const tab = s * 0.22;
  const c = s / 2;
  return (
    `M8 8 H${c - tab} ` +
    `C${c - tab} ${-tab / 2}, ${c + tab} ${-tab / 2}, ${c + tab} 8 ` +
    `H${s - 8} Q${s} 0 ${s} 8 V${s - 8} Q${s} ${s} ${s - 8} ${s} ` +
    `H8 Q0 ${s} 0 ${s - 8} V8 Q0 0 8 8 Z`
  );
}

function maskSvg(size: number, fill: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<path d="${shapePath(size)}" fill="${fill}"/></svg>`
  );
}

export async function buildPuzzle(
  input: Buffer,
  opts: { rng?: () => number } = {}
): Promise<Puzzle> {
  const rng = opts.rng ?? Math.random;
  const base = await sharp(input)
    .resize(CANVAS_W, CANVAS_H, { fit: 'cover' })
    .toFormat('png')
    .toBuffer();

  const gapX = Math.round(
    PIECE_SIZE + MARGIN + rng() * (CANVAS_W - 2 * (PIECE_SIZE + MARGIN))
  );
  const gapY = Math.round(rng() * (CANVAS_H - PIECE_SIZE));

  const region = await sharp(base)
    .extract({ left: gapX, top: gapY, width: PIECE_SIZE, height: PIECE_SIZE })
    .toBuffer();
  const piece = await sharp(region)
    .composite([{ input: maskSvg(PIECE_SIZE, '#fff'), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const hole = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}">` +
      `<g transform="translate(${gapX},${gapY})">` +
      `<path d="${shapePath(PIECE_SIZE)}" fill="#000" fill-opacity="0.55" ` +
      `stroke="#33ff66" stroke-opacity="0.6" stroke-width="2"/></g></svg>`
  );
  const background = await sharp(base)
    .composite([{ input: hole, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    background,
    piece,
    gapX,
    gapY,
    pieceSize: PIECE_SIZE,
    width: CANVAS_W,
    height: CANVAS_H,
  };
}
