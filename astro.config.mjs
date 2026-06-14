import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { execSync } from 'node:child_process';

// Build-time provenance, baked into the bundle via Vite `define` and exposed at
// /version. In CI/Docker (where .git is absent) the commit comes from the
// SOURCE_COMMIT build-arg; locally it falls back to `git rev-parse`.
function buildCommit() {
  if (process.env.SOURCE_COMMIT) return process.env.SOURCE_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true },
  vite: {
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit()),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  },
});
