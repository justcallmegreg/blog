import type { APIRoute } from 'astro';
import { SLUG_RE } from '../../../../lib/overseer/transmissions';
import { presignPut, r2ConfigFromEnv, type PresignFn } from '../../../../lib/overseer/r2';

export interface PresignInput {
  slug?: string;
  contentType?: string;
}
export type PresignResult = {
  status: number;
  body: { ok: boolean; url?: string; videoRef?: string; error?: string };
};

const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

export async function handlePresign(
  input: PresignInput,
  deps: { presign: PresignFn }
): Promise<PresignResult> {
  const slug = (input.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { status: 400, body: { ok: false, error: 'invalid slug' } };
  const ext = EXT[input.contentType ?? ''];
  if (!ext) return { status: 400, body: { ok: false, error: 'video must be mp4 or webm' } };
  const key = `transmissions/${slug}/video.${ext}`;
  try {
    const url = await deps.presign(key, input.contentType!, 900);
    return { status: 200, body: { ok: true, url, videoRef: `${slug}/video.${ext}` } };
  } catch (err) {
    console.error('[overseer] presign failed:', err);
    return { status: 502, body: { ok: false, error: 'presign failed' } };
  }
}

export const POST: APIRoute = async ({ request }) => {
  let input: PresignInput;
  try {
    input = (await request.json()) as PresignInput;
  } catch {
    input = {};
  }
  const r2 = r2ConfigFromEnv();
  const result = await handlePresign(input, { presign: (k, ct, e) => presignPut(r2, k, ct, e) });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
