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
  date: string; // YYYY-MM-DD
  count: number;
  level: number; // 0..4
  future: boolean; // date is after `now` — no data possible yet
}

export interface Heatmap {
  dayLabels: string[]; // 7 labels, Monday-first
  weeks: number;
  grid: HeatCell[][]; // grid[dayRow 0..6][weekCol 0..weeks-1]; dayRow 0 = Monday
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

const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * GitHub-style daily heatmap for the last `weeks` weeks (≈ last month).
 * Rows are days of the week (Monday-first), columns are weeks (oldest → newest).
 * `grid[dayRow][weekCol]`. Dates after `now` are flagged `future`.
 */
export function buildHeatmap(
  prs: { createdAt: string }[],
  now: Date,
  weeks = 5
): Heatmap {
  const mondayOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

  const counts = new Map<string, number>();
  for (const pr of prs) {
    const key = ymd(new Date(pr.createdAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const todayKey = ymd(now);
  const monday = mondayOf(now);
  // first column = Monday of (weeks-1) weeks ago (DST-safe via the date constructor)
  const base = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (weeks - 1) * 7);

  const grid: HeatCell[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: HeatCell[] = [];
    for (let w = 0; w < weeks; w++) {
      const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + w * 7 + d);
      const key = ymd(date);
      const count = counts.get(key) ?? 0;
      row.push({ date: key, count, level: heatLevel(count), future: key > todayKey });
    }
    grid.push(row);
  }
  return { dayLabels: DAY_LABELS, weeks, grid };
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
