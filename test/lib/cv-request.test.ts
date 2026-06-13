import { describe, it, expect } from 'vitest';
import { validateCvRequest, buildCvPayload } from '../../src/lib/cv-request';

const good = { name: 'Recruiter', email: 'r@acme.example', company: 'Acme', consent: true };

describe('validateCvRequest', () => {
  it('accepts a valid consented request', () => {
    expect(validateCvRequest(good).ok).toBe(true);
  });
  it('requires consent === true', () => {
    const r = validateCvRequest({ ...good, consent: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/consent/i);
  });
  it('requires a name', () => {
    const r = validateCvRequest({ ...good, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });
  it('requires a valid email', () => {
    const r = validateCvRequest({ ...good, email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });
  it('allows an empty company (optional)', () => {
    expect(validateCvRequest({ ...good, company: '' }).ok).toBe(true);
  });
});

describe('buildCvPayload', () => {
  it('builds a trimmed cv-request payload with type/site/sentAt', () => {
    const p = buildCvPayload(
      { name: '  Recruiter ', email: ' r@acme.example ', company: '  Acme ', consent: true },
      { site: 'GregCo', now: new Date('2026-06-13T00:00:00.000Z') }
    );
    expect(p).toEqual({
      name: 'Recruiter',
      email: 'r@acme.example',
      company: 'Acme',
      consent: true,
      type: 'cv-request',
      site: 'GregCo',
      sentAt: '2026-06-13T00:00:00.000Z',
    });
  });
});
