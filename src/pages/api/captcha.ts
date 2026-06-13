import type { APIRoute } from 'astro';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../../lib/config';
import { issue, verify } from '../../lib/captcha-store';
import { buildPuzzle } from '../../lib/captcha-image';

export const TOLERANCE = 8;
const PUZZLE_DIRS = ['./dist/client/puzzles', './public/puzzles'];
const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

function puzzleDir(): string | null {
  for (const d of PUZZLE_DIRS) if (existsSync(d)) return d;
  return null;
}

export function listPuzzles(): string[] {
  const dir = puzzleDir();
  if (!dir) return [];
  try {
    return readdirSync(dir).filter((f) => IMG_RE.test(f)).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function puzzlesAvailable(): boolean {
  return listPuzzles().length > 0;
}

export function captchaActive(): boolean {
  return (getConfig().contact as { captcha?: boolean }).captcha === true && puzzlesAvailable();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async () => {
  if (!captchaActive()) return json({ active: false });
  const files = listPuzzles();
  const file = files[Math.floor(Math.random() * files.length)];
  const puzzle = await buildPuzzle(readFileSync(file));
  const token = issue(puzzle.gapX);
  return json({
    active: true,
    token,
    background: `data:image/png;base64,${puzzle.background.toString('base64')}`,
    piece: `data:image/png;base64,${puzzle.piece.toString('base64')}`,
    pieceY: puzzle.gapY,
    pieceSize: puzzle.pieceSize,
    width: puzzle.width,
    height: puzzle.height,
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string; x?: number };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const ok =
    typeof body.token === 'string' &&
    typeof body.x === 'number' &&
    verify(body.token, body.x, { tolerance: TOLERANCE });
  return json({ ok });
};
