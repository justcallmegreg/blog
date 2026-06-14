export type NewsletterAction = 'subscribe' | 'unsubscribe';

export interface NewsletterInput {
  email: string;
  action: NewsletterAction;
  captchaToken?: string;
}

export interface NewsletterPayload {
  email: string;
  action: NewsletterAction;
  site: string;
  sentAt: string;
}

export type NewsletterValidation = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewsletter(input: NewsletterInput): NewsletterValidation {
  const email = (input.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'a valid email is required' };
  if (email.length > 320) return { ok: false, error: 'email too long' };
  if (input.action !== 'subscribe' && input.action !== 'unsubscribe') {
    return { ok: false, error: 'invalid action' };
  }
  return { ok: true };
}

export function buildNewsletterPayload(
  input: NewsletterInput,
  opts: { site: string; now: Date }
): NewsletterPayload {
  return {
    email: input.email.trim(),
    action: input.action,
    site: opts.site,
    sentAt: opts.now.toISOString(),
  };
}
