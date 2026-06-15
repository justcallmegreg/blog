import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { cloneRepo, fetchReset, lsTreeBlobs, firstAddedDate } from './git';
import { pickPublishedDate } from './post-date';
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

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.opts.local && !existsSync(join(this.opts.cacheDir, '.git'))) {
      await cloneRepo({
        repo: this.opts.repo,
        branch: this.opts.branch,
        dir: this.opts.cacheDir,
        token: this.opts.token,
      });
    }
    await this.reindex();
  }

  /** Refresh content (git fetch+reset unless local), then reindex. Returns content-root-relative paths that changed. */
  async sync(): Promise<string[]> {
    if (!this.opts.local) {
      await fetchReset({ dir: this.opts.cacheDir, branch: this.opts.branch, token: this.opts.token });
    }
    return this.reindex();
  }

  private async reindex(): Promise<string[]> {
    const blobs = this.opts.local
      ? listLocalFiles(this.opts.cacheDir)
      : await lsTreeBlobs(this.opts.cacheDir);
    const seenUrls = new Set<string>();
    const changed: string[] = [];

    for (const [repoRel, hash] of blobs) {
      const contentRel = this.toContentRel(repoRel);
      if (contentRel === null) continue;
      const info = parsePostPath(contentRel);
      if (!info) continue;
      seenUrls.add(info.url);
      const existing = this.index.get(info.url);
      if (existing && existing.blobHash === hash) continue;

      const raw = readFileSync(join(this.contentRoot(), contentRel), 'utf8');
      try {
        const { data, content } = parseFrontmatter(raw);
        const html = await renderMarkdown(content, info.urlPrefix);
        const excerpt = extractExcerpt(content) || data.description || '';
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
        });
        changed.push(contentRel);
      } catch (err) {
        console.warn(`Skipping ${contentRel}: ${(err as Error).message}`);
      }
    }

    for (const url of [...this.index.keys()]) {
      if (!seenUrls.has(url)) this.index.delete(url);
    }
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
