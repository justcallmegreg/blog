import type { APIRoute } from 'astro';
import { handleUpdate, fieldsFromForm, realDeps } from './create';

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const f = await fieldsFromForm(form);
  const result = await handleUpdate(f, realDeps());
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
