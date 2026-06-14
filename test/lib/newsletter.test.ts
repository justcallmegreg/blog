import { describe, it, expect } from 'vitest';
import { validateNewsletter, buildNewsletterPayload } from '../../src/lib/newsletter';

describe('validateNewsletter', () => {
  it('accepts a valid subscribe', () => {
    expect(validateNewsletter({ email: 'a@b.example', action: 'subscribe' }).ok).toBe(true);
  });
  it('accepts a valid unsubscribe', () => {
    expect(validateNewsletter({ email: 'a@b.example', action: 'unsubscribe' }).ok).toBe(true);
  });
  it('rejects a bad email', () => {
    const r = validateNewsletter({ email: 'nope', action: 'subscribe' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });
  it('rejects an invalid action', () => {
    const r = validateNewsletter({ email: 'a@b.example', action: 'delete' as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/action/i);
  });
});

describe('buildNewsletterPayload', () => {
  it('builds a trimmed payload with action/site/sentAt', () => {
    const p = buildNewsletterPayload(
      { email: '  a@b.example ', action: 'subscribe' },
      { site: 'GregCo', now: new Date('2026-06-14T00:00:00.000Z') }
    );
    expect(p).toEqual({ email: 'a@b.example', action: 'subscribe', site: 'GregCo', sentAt: '2026-06-14T00:00:00.000Z' });
  });
});
