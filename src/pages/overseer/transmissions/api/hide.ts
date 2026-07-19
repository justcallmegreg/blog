import type { APIRoute } from 'astro';
import { handleUpdate, hideUpdateFromEntry, realDeps } from './create';
import { ensureStarted } from '../../../../lib/store-singleton';

export const POST: APIRoute = async ({ request }) => {
  let input: { slug?: string; draft?: boolean };
  try {
    input = (await request.json()) as { slug?: string; draft?: boolean };
  } catch {
    input = {};
  }
  const slug = (input.slug ?? '').trim();
  const store = await ensureStarted();
  const tx = store.getTransmission(`/transmissions/${slug}`);
  if (!tx) {
    return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  const result = await handleUpdate(hideUpdateFromEntry(tx, Boolean(input.draft)), realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
