import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildPuzzle, PIECE_SIZE, CANVAS_W, CANVAS_H } from '../../src/lib/captcha-image';

async function solidImage(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#224422' } }).png().toBuffer();
}

describe('buildPuzzle', () => {
  it('returns a background and a piece with the expected geometry', async () => {
    const r = await buildPuzzle(await solidImage(), { rng: () => 0.5 });
    expect(r.width).toBe(CANVAS_W);
    expect(r.height).toBe(CANVAS_H);
    expect(r.pieceSize).toBe(PIECE_SIZE);

    const bg = await sharp(r.background).metadata();
    expect(bg.width).toBe(CANVAS_W);
    expect(bg.height).toBe(CANVAS_H);

    const piece = await sharp(r.piece).metadata();
    expect(piece.width).toBe(PIECE_SIZE);
    expect(piece.height).toBe(PIECE_SIZE);

    expect(r.gapX).toBeGreaterThanOrEqual(PIECE_SIZE + 8);
    expect(r.gapX).toBeLessThanOrEqual(CANVAS_W - PIECE_SIZE - 8);
    expect(r.gapY).toBeGreaterThanOrEqual(0);
    expect(r.gapY).toBeLessThanOrEqual(CANVAS_H - PIECE_SIZE);
  });

  it('varies gapX with the rng', async () => {
    const a = await buildPuzzle(await solidImage(), { rng: () => 0.1 });
    const b = await buildPuzzle(await solidImage(), { rng: () => 0.9 });
    expect(a.gapX).not.toBe(b.gapX);
  });
});
