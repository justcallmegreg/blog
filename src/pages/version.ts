import type { APIRoute } from 'astro';
import { VERSION } from '../lib/version';

// GET /version -> {"version":"X.Y.Z"} — a small machine-readable version/health probe.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ version: VERSION }), {
    headers: { 'content-type': 'application/json' },
  });
