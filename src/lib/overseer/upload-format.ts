export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function formatBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  return b < 1e6 ? (b / 1e3).toFixed(0) + ' KB' : (b / 1e6).toFixed(1) + ' MB';
}

/** Instantaneous speed (bytes/s) and ETA (s) from a progress delta. */
export function uploadStats(
  loaded: number,
  total: number,
  prevLoaded: number,
  dtSeconds: number
): { speed: number; etaSeconds: number } {
  const speed = dtSeconds > 0 ? (loaded - prevLoaded) / dtSeconds : 0;
  const etaSeconds = speed > 0 ? (total - loaded) / speed : Infinity;
  return { speed, etaSeconds };
}
