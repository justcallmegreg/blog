// Client for the internal mailer service (see /mailer) plus the email content
// builders for each flow. The blog builds {to, subject, body, replyTo} and POSTs
// to the mailer's generic /send; newsletter sub/unsub hit /subscribe|/unsubscribe.
// With no MAILER_URL configured everything is stage-logged (local dev / no-op).
import type { ForwardPayload } from './contact';
import type { CvPayload } from './cv-request';
import type { NewsletterPayload } from './newsletter';

export interface Email {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

export interface MailerOpts {
  mailerUrl?: string;
  fetchImpl?: typeof fetch;
}

const TIMEOUT_MS = 8000;

/** POST one email to the mailer's /send. Stage-logs when unconfigured. */
export async function sendEmail(email: Email, opts: MailerOpts): Promise<boolean> {
  if (!email.to) return true; // e.g. owner address not configured — skip cleanly
  if (!opts.mailerUrl) {
    console.log('[mailer] stage mode (no MAILER_URL):', JSON.stringify(email));
    return true;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${opts.mailerUrl}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send several emails; returns false if any failed. */
export async function sendAll(emails: Email[], opts: MailerOpts): Promise<boolean> {
  let ok = true;
  for (const email of emails) {
    if (!(await sendEmail(email, opts))) ok = false;
  }
  return ok;
}

/** Add/remove a newsletter contact via the mailer. Stage-logs when unconfigured. */
export async function newsletterContact(
  action: 'subscribe' | 'unsubscribe',
  email: string,
  opts: MailerOpts
): Promise<boolean> {
  if (!opts.mailerUrl) {
    console.log(`[mailer] stage mode ${action}:`, email);
    return true;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${opts.mailerUrl}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- content builders (pure) --------------------------------------------------

/**
 * Contact: notify the owner only. The submitter's address is reply-to metadata,
 * never a send target — we don't email confirmations back to the sender (SES
 * rejects unverified recipients, and delivery is owner-inbound by design).
 */
export function contactEmails(p: ForwardPayload, owner: string): Email[] {
  if (!owner) return [];
  return [
    {
      to: owner,
      replyTo: p.email,
      subject: `[${p.site}] Contact: ${p.subject}`,
      body: `From: ${p.name} <${p.email}>\nSubject: ${p.subject}\n\n${p.message}\n\n— received ${p.sentAt}`,
    },
  ];
}

/**
 * CV request: notify the owner only (reply-to requester). Like contactEmails,
 * the requester is never a send target — no confirmation back to them.
 */
export function cvEmails(p: CvPayload, owner: string): Email[] {
  if (!owner) return [];
  return [
    {
      to: owner,
      replyTo: p.email,
      subject: `[${p.site}] CV request from ${p.name}`,
      body:
        `Name: ${p.name}\nEmail: ${p.email}\nCompany: ${p.company || '—'}\n` +
        `Consent: ${p.consent ? 'yes' : 'no'}\n\n— received ${p.sentAt}`,
    },
  ];
}

/** Newsletter: notify the owner of a subscribe/unsubscribe event. */
export function newsletterOwnerEmail(p: NewsletterPayload, owner: string): Email | null {
  if (!owner) return null;
  return {
    to: owner,
    subject: `[${p.site}] Newsletter ${p.action}: ${p.email}`,
    body: `${p.email} ${p.action}d.\n\n— ${p.sentAt}`,
  };
}

/** Newsletter: a welcome to a new subscriber. */
export function newsletterWelcomeEmail(email: string, site: string): Email {
  return {
    to: email,
    subject: `You're subscribed`,
    body: `You're on the list — a weekly round-up of new posts from ${site} is on its way.\n\nUse the unsubscribe link in any issue to stop at any time.`,
  };
}
