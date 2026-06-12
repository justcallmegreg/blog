import { ContentStore, type ContentStoreOptions } from './content-store';
import { getConfig } from './config';

let store: ContentStore | undefined;
let startPromise: Promise<void> | undefined;
let timer: NodeJS.Timeout | undefined;

export function getStore(opts: ContentStoreOptions): ContentStore {
  if (!store) store = new ContentStore(opts);
  return store;
}

/** Idempotent: clones + first index once, then starts the periodic sync loop. */
export async function ensureStarted(): Promise<ContentStore> {
  const cfg = getConfig();
  // Dev mode: when CONTENT_LOCAL_DIR is set, read content directly from that
  // directory (a mounted volume) instead of cloning the git repo — no commit
  // needed, edits appear on the next sync. Otherwise use the git content repo.
  const localDir = process.env.CONTENT_LOCAL_DIR;
  const s = getStore(
    localDir
      ? {
          repo: cfg.content.repo,
          branch: cfg.content.branch,
          subdir: cfg.content.subdir,
          cacheDir: localDir,
          local: true,
        }
      : {
          repo: cfg.content.repo,
          branch: cfg.content.branch,
          subdir: cfg.content.subdir,
          cacheDir: process.env.CACHE_DIR ?? './cache',
          token: process.env.CONTENT_REPO_TOKEN,
        }
  );
  if (!startPromise) {
    startPromise = s.start().then(() => {
      timer = setInterval(() => {
        s.sync().catch((err) =>
          console.error(`Sync failed: ${(err as Error).message}`)
        );
      }, cfg.content.syncIntervalSeconds * 1000);
      timer.unref?.();
    });
  }
  await startPromise;
  return s;
}

export function __resetStoreForTests(): void {
  store = undefined;
  startPromise = undefined;
  if (timer) clearInterval(timer);
  timer = undefined;
}
