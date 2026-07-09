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
import { parsePostPath, parseDeckPath } from './paths';
import { parseFrontmatter } from './frontmatter';
import { renderMarkdown, extractExcerpt } from './markdown';
import { parsePublishAt } from './publish-schedule';
import { parseDeckSource, renderDeckSlides, type DeckSlideHtml } from './deck';

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
  publishAt?: string;        // resolved UTC instant when validly scheduled
  scheduleInvalid?: boolean; // publishAt was present but unparseable → keep hidden
}

export interface Deck {
  url: string;
  urlPrefix: string;
  slug: string;
  contentDir: string;
  title: string;
  subtitle?: string;
  author?: string;
  date: string;
  theme: string;
  draft: boolean;
  slides: DeckSlideHtml[];
  blobHash: string;
  publishAt?: string;
  scheduleInvalid?: boolean;
}

export interface ContentStoreOptions {
  repo: string;
  branch: string;
  subdir: string;
  cacheDir: string;
  token?: string;
  /** IANA timezone for interpreting bare `publishAt` times. Defaults to Europe/Budapest. */
  timezone?: string;
  /** Content-repo subdirectory holding decks. Defaults to "decks". */
  decksSubdir?: string;
  /**
   * Local (dev) mode: treat `cacheDir` as a directory to read content from
   * directly — no git clone or fetch. Change detection uses file mtime+size
   * instead of git blob hashes, so uncommitted edits show up on the next sync.
   */
  local?: boolean;
}

export class ContentStore {
  private index = new Map<string, Post>();
  private decksIndex = new Map<string, Deck>();
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

  private decksRoot(): string {
    return join(this.opts.cacheDir, this.opts.decksSubdir ?? 'decks');
  }

  /** Repo-relative path -> decks-root-relative path, or null if outside decksSubdir. */
  private toDeckRel(repoRel: string): string | null {
    const prefix = `${(this.opts.decksSubdir ?? 'decks').replace(/\/$/, '')}/`;
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
      `[content] indexed ${this.index.size} post(s), ${this.decksIndex.size} deck(s) — scanned ${scanned} tracked file(s), ` +
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
    const seenDeckUrls = new Set<string>();
    const changed: string[] = [];
    let underSubdir = 0;
    let matched = 0;

    for (const [repoRel, hash] of blobs) {
      const deckRel = this.toDeckRel(repoRel);
      if (deckRel !== null) {
        await this.indexDeck(repoRel, deckRel, hash, seenDeckUrls, changed);
        continue;
      }
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
        const sched = parsePublishAt(data.publishAt, this.tz());
        if (sched.kind === 'invalid') {
          console.warn(
            `[content] ${contentRel}: invalid publishAt ${JSON.stringify(data.publishAt)} — keeping the post hidden`
          );
        }
        const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;
        this.index.set(info.url, {
          url: info.url,
          urlPrefix: info.urlPrefix,
          date: pickPublishedDate(data.date, publishAtDay ?? gitDate),
          slug: info.slug,
          contentDir: info.contentDir,
          title: data.title ?? info.slug,
          description: data.description,
          excerpt,
          draft: data.draft,
          html,
          blobHash: hash,
          readingMinutes,
          publishAt: sched.kind === 'scheduled' ? sched.instant : undefined,
          scheduleInvalid: sched.kind === 'invalid' ? true : undefined,
        });
        changed.push(contentRel);
      } catch (err) {
        console.warn(`Skipping ${contentRel}: ${(err as Error).message}`);
      }
    }

    for (const url of [...this.index.keys()]) {
      if (!seenUrls.has(url)) this.index.delete(url);
    }
    for (const url of [...this.decksIndex.keys()]) {
      if (!seenDeckUrls.has(url)) this.decksIndex.delete(url);
    }
    this.lastScan = { scanned: blobs.size, underSubdir, matched };
    return changed;
  }

  private async indexDeck(
    repoRel: string,
    deckRel: string,
    hash: string,
    seenUrls: Set<string>,
    changed: string[]
  ): Promise<void> {
    const info = parseDeckPath(deckRel);
    if (!info) return;
    seenUrls.add(info.url);
    const existing = this.decksIndex.get(info.url);
    if (existing && existing.blobHash === hash) return;

    const raw = readFileSync(join(this.decksRoot(), deckRel), 'utf8');
    // Parse failure keeps the last-good render serving (entry stays indexed &
    // un-pruned) — deliberate: a typo'd edit degrades to stale, never to a 500.
    try {
      const parsed = parseDeckSource(raw);
      const slides = await renderDeckSlides(parsed, (md) =>
        renderMarkdown(md, info.urlPrefix)
      );
      const sched = parsePublishAt(parsed.meta.publishAt, this.tz());
      if (sched.kind === 'invalid') {
        console.warn(
          `[content] ${repoRel}: invalid publishAt ${JSON.stringify(parsed.meta.publishAt)} — keeping the deck hidden`
        );
      }
      const publishAtDay = sched.kind === 'scheduled' ? sched.day : null;
      const gitDate = this.opts.local
        ? null
        : await firstAddedDate(this.opts.cacheDir, repoRel);
      this.decksIndex.set(info.url, {
        url: info.url,
        urlPrefix: info.urlPrefix,
        slug: info.slug,
        contentDir: info.contentDir,
        title: parsed.meta.title ?? info.slug,
        subtitle: parsed.meta.subtitle,
        author: parsed.meta.author,
        date: pickPublishedDate(parsed.meta.date, publishAtDay ?? gitDate),
        theme: parsed.meta.theme,
        draft: parsed.meta.draft,
        slides,
        blobHash: hash,
        publishAt: sched.kind === 'scheduled' ? sched.instant : undefined,
        scheduleInvalid: sched.kind === 'invalid' ? true : undefined,
      });
      changed.push(repoRel);
    } catch (err) {
      console.warn(`Skipping ${repoRel}: ${(err as Error).message}`);
    }
  }

  private tz(): string {
    return this.opts.timezone ?? 'Europe/Budapest';
  }

  /** Visible to readers now? Drafts and not-yet-published entries are not. */
  private isLive(
    entry: { draft: boolean; scheduleInvalid?: boolean; publishAt?: string },
    now: Date
  ): boolean {
    if (entry.draft) return false;
    if (entry.scheduleInvalid) return false;
    if (entry.publishAt && Date.parse(entry.publishAt) > now.getTime()) return false;
    return true;
  }

  listPosts(now: Date = new Date()): Post[] {
    return [...this.index.values()]
      .filter((p) => this.isLive(p, now))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getPost(url: string): Post | undefined {
    return this.index.get(url);
  }

  /** Like getPost, but returns undefined unless the post is live at `now`. */
  getLivePost(url: string, now: Date = new Date()): Post | undefined {
    const post = this.index.get(url);
    return post && this.isLive(post, now) ? post : undefined;
  }

  resolveAssetPath(slug: string, file: string, now: Date = new Date()): string | null {
    const post = this.index.get(`/${slug}`);
    if (!post || !this.isLive(post, now)) return null;
    // resolve() makes baseDir absolute so the traversal check holds even when
    // contentRoot/cacheDir is a relative path (e.g. the default './cache').
    const baseDir = resolve(this.contentRoot(), post.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }

  listDecks(now: Date = new Date()): Deck[] {
    return [...this.decksIndex.values()]
      .filter((d) => this.isLive(d, now))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  getDeck(url: string): Deck | undefined {
    return this.decksIndex.get(url);
  }

  /** Like getDeck, but undefined unless the deck is live at `now`. */
  getLiveDeck(url: string, now: Date = new Date()): Deck | undefined {
    const deck = this.decksIndex.get(url);
    return deck && this.isLive(deck, now) ? deck : undefined;
  }

  resolveDeckAssetPath(slug: string, file: string, now: Date = new Date()): string | null {
    const deck = this.decksIndex.get(`/decks/${slug}`);
    if (!deck || !this.isLive(deck, now)) return null;
    const baseDir = resolve(this.decksRoot(), deck.contentDir, 'assets');
    const full = resolve(baseDir, file);
    if (full !== baseDir && !full.startsWith(baseDir + sep)) return null;
    return full;
  }
}
