import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { validateNewsletter, buildNewsletterPayload, type NewsletterInput } from '../../lib/newsletter';
import { captchaActive } from './captcha';
import { consume as consumeCaptcha } from '../../lib/captcha-store';

interface HandleResult { status: number; body: { ok: boolean; error?: string } }
interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  subscribeUrl?: string;
  unsubscribeUrl?: string;
  fetchImpl?: typeof fetch;
  captcha?: { active: boolean; consume: (token?: string) => boolean };
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  if (hits.size > 1000) {
    for (const [k, ts] of hits) if (ts.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export function __resetNewsletterRateLimit(): void {
  hits.clear();
}

export async function handleNewsletter(input: NewsletterInput, opts: HandleOpts): Promise<HandleResult> {
  if (rateLimited(opts.ip, opts.now.getTime())) {
    return { status: 429, body: { ok: false, error: 'rate limited' } };
  }
  const v = validateNewsletter(input);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };

  if (opts.captcha?.active) {
    const token = input.captchaToken;
    if (!token || !opts.captcha.consume(token)) {
      return { status: 400, body: { ok: false, error: 'captcha required' } };
    }
  }

  const url = input.action === 'subscribe' ? opts.subscribeUrl : opts.unsubscribeUrl;
  const payload = buildNewsletterPayload(input, { site: opts.site, now: opts.now });
  if (!url) {
    console.log(`[newsletter] stage mode (no webhook) ${input.action}:`, JSON.stringify(payload));
    return { status: 200, body: { ok: true } };
  }
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: 502, body: { ok: false, error: 'forwarding failed' } };
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { ok: false, error: 'forwarding failed' } };
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let input: NewsletterInput;
  try {
    input = (await request.json()) as NewsletterInput;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  let ip = 'unknown';
  try {
    ip = clientAddress || 'unknown';
  } catch {
    ip = 'unknown';
  }
  const result = await handleNewsletter(input, {
    site: getConfig().site.title,
    now: new Date(),
    ip,
    subscribeUrl: process.env.NEWSLETTER_SUBSCRIBE_WEBHOOK_URL,
    unsubscribeUrl: process.env.NEWSLETTER_UNSUBSCRIBE_WEBHOOK_URL,
    captcha: { active: captchaActive(), consume: (t?: string) => (t ? consumeCaptcha(t) : false) },
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
