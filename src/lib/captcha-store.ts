import { randomUUID } from 'node:crypto';

const TTL_MS = 10 * 60_000;

interface Entry {
  gapX: number;
  createdAt: number;
  solved: boolean;
  consumed: boolean;
}

const store = new Map<string, Entry>();

function expired(e: Entry, now: number): boolean {
  return now - e.createdAt > TTL_MS;
}

function sweep(now: number): void {
  if (store.size <= 1000) return;
  for (const [k, e] of store) if (expired(e, now)) store.delete(k);
}

export function issue(gapX: number, now: number = Date.now()): string {
  sweep(now);
  const token = randomUUID();
  store.set(token, { gapX, createdAt: now, solved: false, consumed: false });
  return token;
}

export function verify(
  token: string,
  x: number,
  opts: { tolerance: number; now?: number }
): boolean {
  const e = store.get(token);
  const now = opts.now ?? Date.now();
  if (!e || expired(e, now)) return false;
  if (Math.abs(x - e.gapX) > opts.tolerance) return false;
  e.solved = true;
  return true;
}

export function consume(token: string, now: number = Date.now()): boolean {
  const e = store.get(token);
  if (!e || expired(e, now) || !e.solved || e.consumed) return false;
  e.consumed = true;
  return true;
}

export function __resetCaptchaStore(): void {
  store.clear();
}
