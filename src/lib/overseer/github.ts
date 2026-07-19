import { Buffer } from 'node:buffer';
import { getConfig } from '../config';

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export function githubConfig(): GitHubConfig {
  const cfg = getConfig();
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(cfg.content.repo);
  if (!m) throw new Error(`Cannot parse owner/repo from content.repo: ${cfg.content.repo}`);
  return { owner: m[1], repo: m[2], branch: cfg.content.branch, token: process.env.CONTENT_REPO_TOKEN ?? '' };
}

export interface GitHubLike {
  request(method: string, path: string, body?: unknown): Promise<any>;
}

export function makeGitHub(cfg: GitHubConfig): GitHubLike {
  return {
    async request(method, path, body) {
      const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'blog-overseer',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${txt.slice(0, 200)}`);
      }
      return res.json();
    },
  };
}

export interface CommitFilesInput {
  message: string;
  put?: { path: string; bytes: Uint8Array }[];
  remove?: string[];
}

/**
 * One commit that adds `put` files and removes `remove` paths, via the Git Data
 * API: ref -> base commit+tree -> blobs -> new tree (base_tree + entries) ->
 * commit -> update ref. Removes are tree entries with sha:null.
 */
export async function commitFiles(
  cfg: GitHubConfig,
  input: CommitFilesInput,
  gh: GitHubLike = makeGitHub(cfg)
): Promise<{ commitSha: string }> {
  const base = `/repos/${cfg.owner}/${cfg.repo}`;
  const ref = await gh.request('GET', `${base}/git/ref/heads/${cfg.branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh.request('GET', `${base}/git/commits/${baseCommitSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  for (const f of input.put ?? []) {
    const blob = await gh.request('POST', `${base}/git/blobs`, {
      content: Buffer.from(f.bytes).toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const path of input.remove ?? []) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  const newTree = await gh.request('POST', `${base}/git/trees`, { base_tree: baseTreeSha, tree });
  const commit = await gh.request('POST', `${base}/git/commits`, {
    message: input.message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });
  await gh.request('PATCH', `${base}/git/refs/heads/${cfg.branch}`, { sha: commit.sha });
  return { commitSha: commit.sha };
}
