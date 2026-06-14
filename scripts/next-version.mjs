import { pathToFileURL } from 'node:url';

const RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(s) {
  const m = RE.exec(String(s).trim());
  if (!m) throw new Error(`invalid version: ${JSON.stringify(s)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

// mode: 'patch' (set patch to patchCount on the current X.Y line — PR previews),
// 'patch-release' (increment patch: X.Y.Z -> X.Y.(Z+1)), 'minor' (X.(Y+1).0), or
// 'major' ((X+1).0.0).
export function nextVersion(current, mode, patchCount = 0) {
  const { major, minor, patch } = parseVersion(current);
  switch (mode) {
    case 'patch': {
      const n = Number(patchCount);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid patchCount: ${patchCount}`);
      return `${major}.${minor}.${n}`;
    }
    case 'patch-release':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`unknown mode: ${mode}`);
  }
}

// CLI: node scripts/next-version.mjs <current> <patch|patch-release|minor|major> [patchCount]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , current, mode, patchCount] = process.argv;
  process.stdout.write(nextVersion(current, mode, patchCount ?? 0) + '\n');
}
