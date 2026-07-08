import { describe, it, expect, vi } from 'vitest';
import {
  contactEmails,
  cvEmails,
  newsletterOwnerEmail,
  newsletterWelcomeEmail,
  sendEmail,
  newsletterContact,
} from '../../src/lib/mailer';

const contact = {
  name: 'A',
  email: 'a@x.co',
  subject: 'Hi',
  message: 'msg',
  site: 'GregCo',
  sentAt: '2026-01-01T00:00:00.000Z',
};

describe('content builders', () => {
  it('contactEmails: owner-only (reply-to sender), no confirmation to the submitter', () => {
    const emails = contactEmails(contact, 'me@site');
    expect(emails).toHaveLength(1);
    const [owner] = emails;
    expect(owner).toMatchObject({ to: 'me@site', replyTo: 'a@x.co' });
    expect(owner.subject).toContain('Contact');
    expect(owner.body).toContain('msg');
    // The submitter must never be a send target (SES would reject unverified
    // recipients; the submitter's address is reply-to metadata only).
    expect(emails.some((e) => e.to === 'a@x.co')).toBe(false);
  });

  it('contactEmails: no emails at all when no owner configured', () => {
    expect(contactEmails(contact, '')).toHaveLength(0);
  });

  it('cvEmails: owner-only, no confirmation to the requester', () => {
    const cv = { name: 'R', email: 'r@x.co', company: 'Acme', consent: true, type: 'cv-request' as const, site: 'GregCo', sentAt: 's' };
    const emails = cvEmails(cv, 'me@site');
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: 'me@site', replyTo: 'r@x.co' });
    expect(emails.some((e) => e.to === 'r@x.co')).toBe(false);
  });

  it('cvEmails: no emails at all when no owner configured', () => {
    const cv = { name: 'R', email: 'r@x.co', company: 'Acme', consent: true, type: 'cv-request' as const, site: 'GregCo', sentAt: 's' };
    expect(cvEmails(cv, '')).toHaveLength(0);
  });

  it('newsletterOwnerEmail: null when no owner', () => {
    const p = { email: 'a@x.co', action: 'subscribe' as const, site: 'GregCo', sentAt: 's' };
    expect(newsletterOwnerEmail(p, '')).toBeNull();
    expect(newsletterOwnerEmail(p, 'me@site')?.to).toBe('me@site');
    expect(newsletterWelcomeEmail('a@x.co', 'GregCo').to).toBe('a@x.co');
  });
});

describe('client stage-mode', () => {
  it('sendEmail without a mailerUrl does not fetch and returns true', async () => {
    const fetchMock = vi.fn();
    const ok = await sendEmail({ to: 'a@x.co', subject: 's', body: 'b' }, { fetchImpl: fetchMock });
    expect(ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('newsletterContact without a mailerUrl does not fetch', async () => {
    const fetchMock = vi.fn();
    await newsletterContact('subscribe', 'a@x.co', { fetchImpl: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendEmail POSTs to <mailerUrl>/send when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const ok = await sendEmail({ to: 'a@x.co', subject: 's', body: 'b' }, { mailerUrl: 'http://m', fetchImpl: fetchMock });
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://m/send');
  });
});
