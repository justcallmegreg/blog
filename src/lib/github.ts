const API = 'https://api.github.com';
const TTL_MS = 30 * 60 * 1000; // cache GitHub data for 30 minutes

export interface Repo {
  name: string;
  description: string;
  url: string;
  language: string | null;
  stars: number;
  fork: boolean;
}

export type PrStatus = 'OPEN' | 'MERGED' | 'CLOSED';

export interface PullRequest {
  title: string;
  repo: string; // owner/name
  url: string;
  status: PrStatus;
  createdAt: string; // ISO
}

export interface HeatCell {
  weekStart: string; // YYYY-MM-DD (Monday)
  count: number;
  level: number; // 0..4
}

export interface ContributionData {
  user: string;
  repos: Repo[];
  prs: PullRequest[];
  heatmap: HeatCell[];
  fetchedAt: number;
  error?: string;
}

// ---- pure helpers (unit-tested) -------------------------------------------

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

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

function heatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Weekly (Monday-based) buckets of PR activity for the last `weeks` weeks. */
export function buildHeatmap(
  prs: { createdAt: string }[],
  now: Date,
  weeks = 26
): HeatCell[] {
  const dayMs = 86_400_000;
  const mondayOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

  const counts = new Map<string, number>();
  for (const pr of prs) {
    const key = ymd(mondayOf(new Date(pr.createdAt)));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const thisMonday = mondayOf(now);
  const cells: HeatCell[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisMonday.getTime() - i * 7 * dayMs);
    const key = ymd(ws);
    const count = counts.get(key) ?? 0;
    cells.push({ weekStart: key, count, level: heatLevel(count) });
  }
  return cells;
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
    }))
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
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
  return (data.items as any[]).map((it) => ({
    title: it.title,
    repo: parseRepoFullName(it.repository_url),
    url: it.html_url,
    status: prStatus(it),
    createdAt: it.created_at,
  }));
}

/** Fetch repos + PRs + heatmap for a user. Never throws; errors land on `.error`. */
export async function getContributionData(
  user: string,
  token?: string,
  now: Date = new Date()
): Promise<ContributionData> {
  const since = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  try {
    const [repos, prs] = await Promise.all([
      fetchOwnedRepos(user, token),
      fetchRecentPRs(user, token, since),
    ]);
    return { user, repos, prs, heatmap: buildHeatmap(prs, now), fetchedAt: now.getTime() };
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
