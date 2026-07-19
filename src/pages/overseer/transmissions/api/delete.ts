import type { APIRoute } from 'astro';
import { handleDelete, realDeps } from './create';

export const POST: APIRoute = async ({ request }) => {
  let input: { slug?: string; confirm?: string };
  try {
    input = (await request.json()) as { slug?: string; confirm?: string };
  } catch {
    input = {};
  }
  const result = await handleDelete(input, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
