import type { APIRoute } from 'astro';
import { sesConfigFromEnv, deleteSubscriber } from '../../../lib/overseer/ses';

export interface DeleteInput {
  email?: string;
  confirm?: string;
}
export interface DeleteResult {
  status: number;
  body: { ok: boolean; error?: string };
}
export interface DeleteDeps {
  deleteSubscriber: (email: string) => Promise<void>;
}

export async function handleDelete(input: DeleteInput, deps: DeleteDeps): Promise<DeleteResult> {
  if (input.confirm !== 'APPROVE') {
    return { status: 400, body: { ok: false, error: 'confirmation required' } };
  }
  const email = (input.email ?? '').trim();
  if (!email) {
    return { status: 400, body: { ok: false, error: 'email required' } };
  }
  try {
    await deps.deleteSubscriber(email);
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { ok: false, error: 'delete failed' } };
  }
}

export const POST: APIRoute = async ({ request }) => {
  let input: DeleteInput;
  try {
    input = (await request.json()) as DeleteInput;
  } catch {
    input = {};
  }
  const cfg = sesConfigFromEnv();
  const result = await handleDelete(input, { deleteSubscriber: (email) => deleteSubscriber(cfg, email) });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
