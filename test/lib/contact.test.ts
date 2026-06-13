import { describe, it, expect } from 'vitest';
import { validateContact, buildForwardPayload } from '../../src/lib/contact';

const good = {
  name: 'Vault Dweller',
  email: 'dweller@vault111.example',
  subject: 'Reactor status',
  message: 'All systems nominal.',
  company: '',
};

describe('validateContact', () => {
  it('accepts a well-formed submission', () => {
    const r = validateContact(good);
    expect(r.ok).toBe(true);
  });

  it('flags the honeypot as spam (ok:false, spam:true)', () => {
    const r = validateContact({ ...good, company: 'bot inc' });
    expect(r.ok).toBe(false);
    expect(r.spam).toBe(true);
  });

  it('rejects blank required fields', () => {
    for (const f of ['name', 'email', 'subject', 'message'] as const) {
      const r = validateContact({ ...good, [f]: '   ' });
      expect(r.ok).toBe(false);
      expect(r.spam).toBeFalsy();
      expect(r.error).toMatch(new RegExp(f, 'i'));
    }
  });

  it('rejects a malformed email', () => {
    const r = validateContact({ ...good, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/email/i);
  });

  it('rejects over-length fields', () => {
    const r = validateContact({ ...good, message: 'x'.repeat(5001) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/message/i);
  });
});

describe('buildForwardPayload', () => {
  it('builds a trimmed payload with sentAt + site, excluding the honeypot', () => {
    const p = buildForwardPayload(
      { ...good, name: '  Vault Dweller  ' },
      { site: 'GregCo', now: new Date('2026-06-13T00:00:00.000Z') }
    );
    expect(p).toEqual({
      name: 'Vault Dweller',
      email: 'dweller@vault111.example',
      subject: 'Reactor status',
      message: 'All systems nominal.',
      site: 'GregCo',
      sentAt: '2026-06-13T00:00:00.000Z',
    });
    expect('company' in p).toBe(false);
  });
});
