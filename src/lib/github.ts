import { buildHeatmap, ymd, type Heatmap } from './heatmap';
// Re-exported for existing consumers/tests that import these from this module.
export { buildHeatmap } from './heatmap';
export type { Heatmap, HeatCell } from './heatmap';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfig } from './config';

const API = 'https://api.github.com';

export interface Repo {
  name: string;
  description: string;
  url: string;
  language: string | null;
  stars: number;
  fork: boolean;
  pushedAt: string; // ISO; last push, used to order newest-first
}

export type PrStatus = 'OPEN' | 'MERGED' | 'CLOSED';

export interface PullRequest {
  title: string;
  repo: string; // owner/name
  url: string;
  status: PrStatus;
  createdAt: string; // ISO
}

export interface ContributionData {
  user: string;
  repos: Repo[];
  prs: PullRequest[];
  heatmap: Heatmap;
  fetchedAt: number;
  error?: string;
}

// ---- pure helpers (unit-tested) -------------------------------------------

/** `https://api.github.com/repos/owner/name` -> `owner/name`. */
export function parseRepoFullName(repositoryUrl: string): string {
  const m = /\/repos\/([^/]+\/[^/]+)\/?$/.exec(repositoryUrl);
  return m ? m[1] : repositoryUrl;
}

/** Determine OPEN / MERGED / CLOSED from a GitHub search issue item. */
export function prStatus(item: {
  state: string;
  pull_request?: { merged_at?: string | null } | null;
}): PrStatus {
  if (item.pull_request?.merged_at) return 'MERGED';
  return item.state === 'open' ? 'OPEN' : 'CLOSED';
}

// ---- fetching --------------------------------------------------------------

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'gregco-blog-engine',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghGet(path: string, token?: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchOwnedRepos(user: string, token?: string): Promise<Repo[]> {
  const data = await ghGet(
    `/users/${encodeURIComponent(user)}/repos?type=owner&sort=updated&per_page=100`,
    token
  );
  return (data as any[])
    .filter((r) => !r.fork && !r.private) // only original (non-fork) public repos
    .map((r) => ({
      name: r.name,
      description: r.description ?? '',
      url: r.html_url,
      language: r.language,
      stars: r.stargazers_count ?? 0,
      fork: false,
      pushedAt: r.pushed_at ?? r.updated_at ?? r.created_at ?? '',
    }))
    // Newest activity first; tie-break by name for stable ordering.
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt) || a.name.localeCompare(b.name));
}

/**
 * Extract one `{createdAt}` per pushed commit from a GitHub public-events page.
 * Counts commits on branches (PushEvent) regardless of any PR — `distinct_size`
 * is the number of commits in that push.
 */
export function commitsFromEvents(events: unknown[]): { createdAt: string }[] {
  const out: { createdAt: string }[] = [];
  for (const ev of events as any[]) {
    if (ev?.type !== 'PushEvent' || typeof ev.created_at !== 'string') continue;
    const n =
      ev.payload?.distinct_size ?? ev.payload?.size ?? ev.payload?.commits?.length ?? 1;
    for (let i = 0; i < Math.max(1, n); i++) out.push({ createdAt: ev.created_at });
  }
  return out;
}

/** Commit-day list from the user's recent public push events (up to 3 pages). */
async function fetchRecentCommits(
  user: string,
  token?: string
): Promise<{ createdAt: string }[]> {
  const out: { createdAt: string }[] = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const events = await ghGet(
        `/users/${encodeURIComponent(user)}/events/public?per_page=100&page=${page}`,
        token
      );
      if (!Array.isArray(events) || events.length === 0) break;
      out.push(...commitsFromEvents(events));
      if (events.length < 100) break;
    }
  } catch {
    // events unreachable/rate-limited → heatmap falls back to PRs only
  }
  return out;
}

async function fetchRecentPRs(
  user: string,
  token: string | undefined,
  since: Date
): Promise<PullRequest[]> {
  const q = `type:pr author:${user} created:>=${ymd(since)}`;
  const data = await ghGet(
    `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=100`,
    token
  );
  return (data.items as any[])
    .map((it) => ({
      title: it.title,
      repo: parseRepoFullName(it.repository_url),
      url: it.html_url,
      status: prStatus(it),
      createdAt: it.created_at,
    }))
    // Newest first (the search already sorts created desc; make it explicit).
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Fetch repos + PRs + heatmap for a user. Never throws; errors land on `.error`. */
export async function getContributionData(
  user: string,
  token?: string,
  now: Date = new Date()
): Promise<ContributionData> {
  const since = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  try {
    const [repos, prs, commits] = await Promise.all([
      fetchOwnedRepos(user, token),
      fetchRecentPRs(user, token, since),
      fetchRecentCommits(user, token),
    ]);
    // Heatmap = total recent activity: PR-days + commit-days (commits on branches).
    const activity = [...prs.map((p) => ({ createdAt: p.createdAt })), ...commits];
    return { user, repos, prs, heatmap: buildHeatmap(activity, now), fetchedAt: now.getTime() };
  } catch (e) {
    return {
      user,
      repos: [],
      prs: [],
      heatmap: buildHeatmap([], now),
      fetchedAt: now.getTime(),
      error: (e as Error).message,
    };
  }
}

// ---- disk-backed stale-while-revalidate cache --------------------------------

export interface ContributionCacheOpts {
  enabled: boolean;
  ttlMs: number;
  cacheDir: string;
  now: () => number;
  fetch: (user: string, token?: string) => Promise<ContributionData>;
}

function defaultCacheOpts(): ContributionCacheOpts {
  const c = getConfig().github.cache;
  return {
    enabled: c.enabled,
    ttlMs: c.ttlSeconds * 1000,
    cacheDir: join(process.env.CACHE_DIR ?? './cache', 'contributions'),
    now: () => Date.now(),
    fetch: getContributionData,
  };
}

function cachePath(dir: string, user: string): string {
  return join(dir, `${user.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function readDiskCache(file: string): ContributionData | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ContributionData;
  } catch {
    return null;
  }
}

function writeDiskCache(file: string, data: ContributionData): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file); // atomic replace
  } catch {
    // best-effort: a failed write just means the next read is a miss
  }
}

function isFresh(data: ContributionData, o: ContributionCacheOpts): boolean {
  return !data.error && o.now() - data.fetchedAt < o.ttlMs;
}

const memMirror = new Map<string, ContributionData>();
const refreshing = new Map<string, Promise<void>>();

function backgroundRefresh(
  user: string,
  token: string | undefined,
  o: ContributionCacheOpts,
  file: string
): void {
  if (refreshing.has(user)) return; // single-flight
  const p = (async () => {
    try {
      const data = await o.fetch(user, token);
      if (!data.error) {
        writeDiskCache(file, data);
        memMirror.set(user, data);
      }
    } catch {
      // keep the existing file/mirror on failure
    } finally {
      refreshing.delete(user);
    }
  })();
  refreshing.set(user, p);
}

/**
 * Disk stale-while-revalidate cache: serves the cached file instantly (even when
 * stale) and refreshes in the background; only a cold (no-file) cache blocks to
 * fetch. Per instance (file under CACHE_DIR). `opts` is an injectable test seam.
 */
export async function getContributionDataCached(
  user: string,
  token?: string,
  opts?: Partial<ContributionCacheOpts>
): Promise<ContributionData> {
  const o = { ...defaultCacheOpts(), ...opts };
  if (!o.enabled) return o.fetch(user, token);

  const mem = memMirror.get(user);
  if (mem && isFresh(mem, o)) return mem;

  const file = cachePath(o.cacheDir, user);
  const disk = readDiskCache(file);
  if (disk) {
    memMirror.set(user, disk);
    if (isFresh(disk, o)) return disk;
    backgroundRefresh(user, token, o, file); // serve stale now, refresh for next time
    return disk;
  }

  // Cold cache: block once. Don't persist errors (so the next open retries).
  const data = await o.fetch(user, token);
  memMirror.set(user, data);
  if (!data.error) writeDiskCache(file, data);
  return data;
}

export function __clearGithubCache(): void {
  memMirror.clear();
  refreshing.clear();
}

/** Test helper: resolves once any in-flight background refresh for `user` settles. */
export async function __contribRefreshSettled(user: string): Promise<void> {
  await refreshing.get(user);
}
