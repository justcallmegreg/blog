export interface CvInput {
  name: string;
  email: string;
  company?: string;
  consent?: boolean;
  // Solved slide-puzzle token; validated by the endpoint, never forwarded.
  captchaToken?: string;
}

export interface CvPayload {
  name: string;
  email: string;
  company: string;
  consent: boolean;
  type: 'cv-request';
  site: string;
  sentAt: string;
}

export type CvValidation = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCvRequest(input: CvInput): CvValidation {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  const email = (input.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'a valid email is required' };
  if (input.consent !== true) return { ok: false, error: 'consent is required' };
  if (name.length > 200 || email.length > 320 || (input.company ?? '').length > 200) {
    return { ok: false, error: 'field too long' };
  }
  return { ok: true };
}

export function buildCvPayload(input: CvInput, opts: { site: string; now: Date }): CvPayload {
  return {
    name: input.name.trim(),
    email: input.email.trim(),
    company: (input.company ?? '').trim(),
    consent: true,
    type: 'cv-request',
    site: opts.site,
    sentAt: opts.now.toISOString(),
  };
}
