import { buildHeatmap, ymd, type Heatmap } from './heatmap';
// Re-exported for existing consumers/tests that import these from this module.
export { buildHeatmap } from './heatmap';
export type { Heatmap, HeatCell } from './heatmap';

const API = 'https://api.github.com';
const TTL_MS = 30 * 60 * 1000; // cache GitHub data for 30 minutes

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

const cache = new Map<string, ContributionData>();

/** Cached wrapper: serves data for up to TTL_MS; refetches successful data only. */
export async function getContributionDataCached(
  user: string,
  token?: string
): Promise<ContributionData> {
  const hit = cache.get(user);
  if (hit && !hit.error && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  const data = await getContributionData(user, token);
  // Cache errors briefly too (short TTL via fetchedAt) to avoid hammering on failure.
  cache.set(user, data);
  return data;
}

export function __clearGithubCache(): void {
  cache.clear();
}
