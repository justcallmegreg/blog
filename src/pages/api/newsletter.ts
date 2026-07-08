import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { validateNewsletter, buildNewsletterPayload, type NewsletterInput } from '../../lib/newsletter';
import {
  newsletterContact,
  newsletterOwnerEmail,
  newsletterWelcomeEmail,
  sendAll,
} from '../../lib/mailer';
import { captchaActive } from './captcha';
import { consume as consumeCaptcha } from '../../lib/captcha-store';

interface HandleResult { status: number; body: { ok: boolean; error?: string } }
interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  owner?: string;
  mailerUrl?: string;
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

  const payload = buildNewsletterPayload(input, { site: opts.site, now: opts.now });
  const mopts = { mailerUrl: opts.mailerUrl, fetchImpl: opts.fetchImpl };

  // Update the SES contact list, then notify the owner and (on subscribe) the
  // new subscriber.
  const listOk = await newsletterContact(input.action, payload.email, mopts);
  const emails = [];
  const ownerEmail = newsletterOwnerEmail(payload, opts.owner ?? '');
  if (ownerEmail) emails.push(ownerEmail);
  if (input.action === 'subscribe') emails.push(newsletterWelcomeEmail(payload.email, opts.site));
  const mailOk = await sendAll(emails, mopts);

  if (!listOk || !mailOk) return { status: 502, body: { ok: false, error: 'delivery failed' } };
  return { status: 200, body: { ok: true } };
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
    owner: process.env.OWNER_EMAIL || getConfig().privacy.email,
    mailerUrl: process.env.MAILER_URL,
    captcha: { active: captchaActive(), consume: (t?: string) => (t ? consumeCaptcha(t) : false) },
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
