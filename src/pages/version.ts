import type { APIRoute } from 'astro';
import { VERSION, COMMIT, BUILT_AT } from '../lib/version';

// GET /version -> {"version":"X.Y.Z","commit":"<sha>","builtAt":"<iso>"}
// A small machine-readable version/health/provenance probe.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ version: VERSION, commit: COMMIT, builtAt: BUILT_AT }), {
    headers: { 'content-type': 'application/json' },
  });
