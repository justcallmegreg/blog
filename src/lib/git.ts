import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const run = promisify(execFile);

export function applyToken(repo: string, token: string | undefined): string {
  if (!token) return repo;
  return repo.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

async function git(args: string[], cwd?: string, redact?: string): Promise<string> {
  // When operating inside an existing repo, mark it a safe.directory so git's
  // "dubious ownership" check can't abort us in containers where the cache dir
  // is owned by a different user (e.g. cloned as root, served as non-root).
  const full = cwd ? ['-c', `safe.directory=${cwd}`, ...args] : args;
  try {
    const { stdout } = await run('git', full, { cwd, maxBuffer: 1024 * 1024 * 64 });
    return stdout;
  } catch (err) {
    if (redact && err instanceof Error) {
      err.message = err.message.replaceAll(redact, '***');
      const cmdErr = err as Error & { cmd?: string };
      if (cmdErr.cmd) {
        cmdErr.cmd = cmdErr.cmd.replaceAll(redact, '***');
      }
    }
    throw err;
  }
}

export interface CloneOptions {
  repo: string;
  branch: string;
  dir: string;
  token?: string;
}

export async function cloneRepo(opts: CloneOptions): Promise<void> {
  const url = applyToken(opts.repo, opts.token);
  await git(
    ['clone', '--branch', opts.branch, '--single-branch', url, opts.dir],
    undefined,
    opts.token,
  );
}

export async function fetchReset(opts: {
  dir: string;
  branch: string;
  token?: string;
}): Promise<void> {
  await git(['fetch', 'origin', opts.branch], opts.dir, opts.token);
  await git(['reset', '--hard', `origin/${opts.branch}`], opts.dir, opts.token);
  await git(['clean', '-fd'], opts.dir, opts.token);
}

/** Map of repo-relative path -> git blob hash for all tracked files. */
export async function lsTreeBlobs(dir: string): Promise<Map<string, string>> {
  if (!existsSync(dir)) return new Map();
  const out = await git(['ls-tree', '-r', 'HEAD'], dir);
  const map = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (!line) continue;
    // format: "<mode> blob <hash>\t<path>"
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const path = line.slice(tab + 1);
    if (meta[1] === 'blob') map.set(path, meta[2]);
  }
  return map;
}

/**
 * Date (YYYY-MM-DD) the file first landed on the mainline, or null.
 * `--first-parent` walks only mainline commits and diffs merges against their
 * first parent, so the returned date is the PR's merge/squash commit date —
 * not the author's branch commit date.
 */
export async function firstAddedDate(dir: string, repoRelPath: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  try {
    const out = await git(
      ['log', '--first-parent', '--diff-filter=A', '--reverse', '--format=%cI', '--', repoRelPath],
      dir
    );
    const first = out.split('\n').find((l) => l.trim());
    return first ? first.slice(0, 10) : null;
  } catch {
    return null;
  }
}
