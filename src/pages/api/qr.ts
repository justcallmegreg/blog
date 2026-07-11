import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { buildQrSvg, parseQrParams } from '../../lib/qr/render';

export interface QrResult {
  status: number;
  contentType: string;
  body: string | Buffer;
}

/** Testable core: parse → build → (optionally rasterise). Stateless. */
export async function handleQr(url: URL): Promise<QrResult> {
  const parsed = parseQrParams(url);
  if ('error' in parsed) {
    return { status: 400, contentType: 'text/plain', body: parsed.error };
  }
  const svg = buildQrSvg(parsed.data, parsed.opts);
  if (parsed.format === 'png') {
    const png = await sharp(Buffer.from(svg))
      .resize(parsed.size, parsed.size, { fit: 'contain' })
      .png()
      .toBuffer();
    return { status: 200, contentType: 'image/png', body: png };
  }
  return { status: 200, contentType: 'image/svg+xml', body: svg };
}

export const GET: APIRoute = async ({ request }) => {
  const res = await handleQr(new URL(request.url));
  const headers: Record<string, string> = { 'content-type': res.contentType };
  if (res.status === 200) headers['cache-control'] = 'public, max-age=86400';
  return new Response(res.body, { status: res.status, headers });
};
