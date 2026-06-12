import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Walk a directory recursively and return a map of POSIX-relative path -> change
 * key (`<mtimeMs>:<size>`). This is the local-mode analogue of git's blob-hash
 * listing: the content store compares keys to detect which files changed, so a
 * modified file (even uncommitted) is re-rendered on the next reindex. The `.git`
 * directory is skipped. A missing directory yields an empty map.
 */
export function listLocalFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();

  function walk(abs: string): void {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const st = statSync(full);
        const rel = relative(dir, full).split(sep).join('/');
        out.set(rel, `${Math.round(st.mtimeMs)}:${st.size}`);
      }
    }
  }

  walk(dir);
  return out;
}
