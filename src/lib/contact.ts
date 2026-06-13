export interface ContactInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  company?: string; // honeypot — must be empty for real humans
}

export interface ForwardPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  site: string;
  sentAt: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; spam?: boolean; error?: string };

const LIMITS = { name: 200, email: 320, subject: 200, message: 5000 } as const;
// Pragmatic email shape check (not full RFC): something@something.tld
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(input: ContactInput): ValidationResult {
  if ((input.company ?? '').trim() !== '') return { ok: false, spam: true };

  const fields = ['name', 'email', 'subject', 'message'] as const;
  for (const f of fields) {
    const v = (input[f] ?? '').trim();
    if (v === '') return { ok: false, error: `${f} is required` };
    if (v.length > LIMITS[f]) return { ok: false, error: `${f} is too long` };
  }
  if (!EMAIL_RE.test(input.email.trim())) {
    return { ok: false, error: 'email is invalid' };
  }
  return { ok: true };
}

export function buildForwardPayload(
  input: ContactInput,
  opts: { site: string; now: Date }
): ForwardPayload {
  return {
    name: input.name.trim(),
    email: input.email.trim(),
    subject: input.subject.trim(),
    message: input.message.trim(),
    site: opts.site,
    sentAt: opts.now.toISOString(),
  };
}
