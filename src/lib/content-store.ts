import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { cloneRepo, fetchReset, lsTreeBlobs, firstAddedDate } from './git';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying on failure with exponential backoff (capped). Each attempt
 * and the eventual give-up are logged so the container logs show what happened.
 * Throws the last error only after all attempts are exhausted.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; baseMs: number; maxMs: number; label: string }
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message;
      if (i < opts.attempts) {
        const delay = Math.min(opts.maxMs, opts.baseMs * 2 ** (i - 1));
        console.warn(
          `[content] ${opts.label} failed (attempt ${i}/${opts.attempts}): ${msg} — retrying in ${delay}ms`
        );
        await sleep(delay);
      } else {
        console.error(
          `[content] ${opts.label} failed (attempt ${i}/${opts.attempts}): ${msg} — giving up this round`
        );
      }
    }
  }
  throw lastErr;
}
import { pickPublishedDate } from './post-date';
import { estimateReadingMinutes } from './reading-time';
import { listLocalFiles } from './local-files';
import { parsePostPath } from './paths';
import { parseFrontmatter } from './frontmatter';
import { renderMarkdown, extractExcerpt } from './markdown';

export interface Post {
  url: string;
  urlPrefix: string;
  date: string;
  slug: string;
  contentDir: string;
  title: string;
  description?: string;
  excerpt: string;
  draft: boolean;
  html: string;
  blobHash: string;
  readingMinutes: number;
}

export interface ContentStoreOptions {
  repo: string;
  branch: string;
  subdir: string;
  cacheDir: string;
  token?: string;
  /**
   * Local (dev) mode: treat `cacheDir` as a directory to read content from
   * directly — no git clone or fetch. Change detection uses file mtime+size
   * instead of git blob hashes, so uncommitted edits show up on the next sync.
   */
  local?: boolean;
}

export class ContentStore {
  private index = new Map<string, Post>();
  private started = false;
  // Counts from the most recent reindex, surfaced in the startup/sync logs so a
  // "no posts showing" problem can be diagnosed from the container logs alone.
  private lastScan = { scanned: 0, underSubdir: 0, matched: 0 };

  constructor(private opts: ContentStoreOptions) {}

  private contentRoot(): string {
    return this.opts.subdir
      ? join(this.opts.cacheDir, this.opts.subdir)
      : this.opts.cacheDir;
  }

  /** Repo-relative path -> content-root-relative path, or null if outside subdir. */
  private toContentRel(repoRel: string): string | null {
    if (!this.opts.subdir) return repoRel;
    const prefix = `${this.opts.subdir.replace(/\/$/, '')}/`;
    return repoRel.startsWith(prefix) ? repoRel.slice(prefix.length) : null;
  }

  /**
   * Ensure the content repo is cloned (git mode only). No-op if a clone already
   * exists. A previous failed attempt — or a pre-created mount point — can leave
   * a non-empty directory without a `.git`, which makes `git clone` abort with
   * "destination path already exists"; each attempt clears the target first.
   * Retries with backoff so a transient network/auth blip doesn't leave the
   * store permanently empty; the periodic sync keeps calling this until it works.
   */
  private async ensureCloned(): Promise<void> {
    if (this.opts.local) return;
    if (existsSync(join(this.opts.cacheDir, '.git'))) return; // already cloned
    const dir = resolve(this.opts.cacheDir);
    console.log(
      `[content] cloning ${this.opts.repo} (branch '${this.opts.branch}') into ${dir} …`
    );
    await withRetry(
      async () => {
        // Clear the dir's CONTENTS rather than the dir itself: in Kubernetes the
        // cache dir is a volume mount point, and removing a mount point fails
        // with EBUSY — which used to block the clone forever. `git clone` is
        // fine with an existing directory as long as it is empty.
        if (existsSync(this.opts.cacheDir)) {
          for (const entry of readdirSync(this.opts.cacheDir)) {
            rmSync(join(this.opts.cacheDir, entry), { recursive: true, force: true });
          }
        }
        await cloneRepo({
          repo: this.opts.repo,
          branch: this.opts.branch,
          dir: this.opts.cacheDir,
          token: this.opts.token,
        });
      },
      { attempts: 3, baseMs: 1500, maxMs: 6000, label: 'clone' }
    );
    console.log(`[content] clone complete → ${dir}`);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const dir = resolve(this.opts.cacheDir);
    if (this.opts.local) {
      console.log(`[content] local mode — reading from ${this.contentRoot()}`);
    } else if (existsSync(join(this.opts.cacheDir, '.git'))) {
      console.log(`[content] reusing existing clone at ${dir}`);
    } else {
      // Don't let a failed initial clone poison startup: log and serve empty —
      // the sync loop (installed by store-singleton) retries every cycle.
      try {
        await this.ensureCloned();
      } catch (err) {
        console.error(
          `[content] initial clone failed after retries: ${(err as Error).message} — ` +
            `serving empty for now; the background sync will keep retrying`
        );
      }
    }
    await this.reindex();
    const { scanned, underSubdir } = this.lastScan;
    console.log(
      `[content] indexed ${this.index.size} post(s) — scanned ${scanned} tracked file(s), ` +
        `${underSubdir} under subdir '${this.opts.subdir}' (content root ${this.contentRoot()})`
    );
    if (this.index.size === 0) {
      console.warn(
        `[content] NO POSTS FOUND. Expected each post at ` +
          `'${this.opts.subdir}/<namespace>/<slug>/index.md' inside the content repo. ` +
          (scanned === 0
            ? `The clone appears empty (0 tracked files at ${dir}).`
            : underSubdir === 0
              ? `${scanned} file(s) were found but none under subdir '${this.opts.subdir}' — check the 'content.subdir' config.`
              : `${underSubdir} file(s) are under '${this.opts.subdir}' but none match the '<namespace>/<slug>/index.md' layout.`)
      );
    }
  }

  /** Refresh content (git fetch+reset unless local), then reindex. Returns content-root-relative paths that changed. */
  async sync(): Promise<string[]> {
    if (!this.opts.local) {
      try {
        // Self-heal: if the initial clone never succeeded, this clones now;
        // otherwise it's a cheap no-op and we just fetch the latest commits.
        await this.ensureCloned();
        await fetchReset({ dir: this.opts.cacheDir, branch: this.opts.branch, token: this.opts.token });
      } catch (err) {
        console.error(
          `[content] fetch failed: ${(err as Error).message} — keeping current index, retrying next cycle`
        );
      }
    }
    const changed = await this.reindex();
    if (!this.opts.local) {
      console.log(
        `[content] fetched origin/${this.opts.branch} — ` +
          `${changed.length} file(s) changed, ${this.index.size} post(s) total`
      );
    }
    return changed;
  }

  private async reindex(): Promise<string[]> {
    // In git mode, ls-tree throws if there's no repo yet (e.g. the clone hasn't
    // succeeded). Treat "not cloned" as an empty index rather than an error, so
    // startup never poisons on a missing clone — the sync loop fills it in later.
    const blobs = this.opts.local
      ? listLocalFiles(this.opts.cacheDir)
      : existsSync(join(this.opts.cacheDir, '.git'))
        ? await lsTreeBlobs(this.opts.cacheDir)
        : new Map<string, string>();
    const seenUrls = new Set<string>();
    const changed: string[] = [];
    let underSubdir = 0;
    let matched = 0;

    for (const [repoRel, hash] of blobs) {
      const contentRel = this.toContentRel(repoRel);
      if (contentRel === null) continue;
      underSubdir++;
      const info = parsePostPath(contentRel);
      if (!info) continue;
      matched++;
      seenUrls.add(info.url);
      const existing = this.index.get(info.url);
      if (existing && existing.blobHash === hash) continue;

      const raw = readFileSync(join(this.contentRoot(), contentRel), 'utf8');
      try {
        const { data, content } = parseFrontmatter(raw);
        const html = await renderMarkdown(content, info.urlPrefix);
        const excerpt = extractExcerpt(content) || data.description || '';
        const readingMinutes = estimateReadingMinutes(content);
        const gitDate = this.opts.local
          ? null
          : await firstAddedDate(this.opts.cacheDir, repoRel);
        this.index.set(info.url, {
          url: info.url,
          urlPrefix: info.urlPrefix,
          date: pickPublishedDate(data.date, gitDate),
          slug: info.slug,
          contentDir: info.contentDir,
          title: data.title ?? info.slug,
          description: data.description,
          excerpt,
          draft: data.draft,
          html,
          blobHash: hash,
          readingMinutes,
        });
        changed.push(contentRel);
      } catch (err) {
        console.warn(`Skipping ${contentRel}: ${(err as Error).message}`);
      }
    }

    for (const url of [...this.index.keys()]) {
      if (!seenUrls.has(url)) this.index.delete(url);
    }
    this.lastScan = { scanned: blobs.size, underSubdir, matched };
    return changed;
  }

  listPosts(): Post[] {
    return [...this.index.values()]
      .filter((p) => !p.draft)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getPost(url: string): Post | undefined {
    return this.index.get(url);
  }

  resolveAssetPath(slug: string, file: string): string | null {
    const post = this.index.get(`/${slug}`);
    if (!post) return null;
    // resolve() makes baseDir absolute so the traversal check holds even when
    // contentRoot/cacheDir is a relative path (e.g. the default './cache').
    const baseDir = resolve(this.contentRoot(), post.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
}
