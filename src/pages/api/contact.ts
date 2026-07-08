import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { validateContact, buildForwardPayload, type ContactInput } from '../../lib/contact';
import { contactEmails, sendAll } from '../../lib/mailer';
import { captchaActive } from './captcha';
import { consume as consumeCaptcha } from '../../lib/captcha-store';

interface HandleResult { status: number; body: { ok: boolean; error?: string } }

interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  owner?: string;       // owner notification recipient
  mailerUrl?: string;   // internal mailer base URL (unset → stage-log)
  fetchImpl?: typeof fetch;
  captcha?: { active: boolean; consume: (token?: string) => boolean };
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  // Bound the map: drop IPs whose window has fully expired.
  if (hits.size > 1000) {
    for (const [k, ts] of hits) {
      if (ts.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export function __resetRateLimit(): void {
  hits.clear();
}

/** Pure-ish handler: rate-limit → validate → honeypot → forward/stage. */
export async function handleContact(
  input: ContactInput,
  opts: HandleOpts
): Promise<HandleResult> {
  if (rateLimited(opts.ip, opts.now.getTime())) {
    return { status: 429, body: { ok: false, error: 'rate limited' } };
  }

  const result = validateContact(input);
  if (!result.ok) {
    // Honeypot: pretend success, drop silently.
    if (result.spam) return { status: 200, body: { ok: true } };
    return { status: 400, body: { ok: false, error: result.error } };
  }

  if (opts.captcha?.active) {
    const token = (input as ContactInput & { captchaToken?: string }).captchaToken;
    if (!token || !opts.captcha.consume(token)) {
      return { status: 400, body: { ok: false, error: 'captcha required' } };
    }
  }

  const payload = buildForwardPayload(input, { site: opts.site, now: opts.now });
  const emails = contactEmails(payload, opts.owner ?? '');
  const ok = await sendAll(emails, { mailerUrl: opts.mailerUrl, fetchImpl: opts.fetchImpl });
  if (!ok) return { status: 502, body: { ok: false, error: 'delivery failed' } };
  return { status: 200, body: { ok: true } };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let input: ContactInput;
  try {
    input = (await request.json()) as ContactInput;
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

  const result = await handleContact(input, {
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
