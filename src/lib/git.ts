import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const run = promisify(execFile);

export function applyToken(repo: string, token: string | undefined): string {
  if (!token) return repo;
  return repo.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

async function git(args: string[], cwd?: string, redact?: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 1024 * 1024 * 64 });
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
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      opts.branch,
      '--single-branch',
      url,
      opts.dir,
    ],
    undefined,
    opts.token,
  );
}

export async function fetchReset(opts: {
  dir: string;
  branch: string;
}): Promise<void> {
  await git(['fetch', '--depth', '1', 'origin', opts.branch], opts.dir);
  await git(['reset', '--hard', `origin/${opts.branch}`], opts.dir);
  await git(['clean', '-fd'], opts.dir);
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
