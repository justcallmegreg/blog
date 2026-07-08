import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleContact, __resetRateLimit } from '../../src/pages/api/contact';

const good = {
  name: 'Vault Dweller',
  email: 'dweller@vault111.example',
  subject: 'Hi',
  message: 'Hello there.',
  company: '',
};
const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-13T00:00:00.000Z'),
  ip: '1.2.3.4',
  owner: 'owner@gregco.example',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetRateLimit());

describe('handleContact', () => {
  it('stage mode (no mailer): returns 200 and does not fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact(good, { ...ctx, mailerUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the owner notification only (no confirmation to the sender)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleContact(good, {
      ...ctx,
      mailerUrl: 'http://mailer.svc:8080',
      fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // owner only
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://mailer.svc:8080/send');
    const owner = JSON.parse(init.body);
    expect(owner).toMatchObject({ to: 'owner@gregco.example', replyTo: 'dweller@vault111.example' });
    expect(owner.subject).toContain('Contact');
    // The sender's address must never be a send destination.
    expect(fetchMock.mock.calls.every((c) => JSON.parse(c[1].body).to !== 'dweller@vault111.example')).toBe(true);
  });

  it('honeypot returns 200 success but does NOT send', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, company: 'bot' }, {
      ...ctx, mailerUrl: 'http://mailer.svc:8080', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid input returns 400 and does not send', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, email: 'nope' }, {
      ...ctx, mailerUrl: 'http://mailer.svc:8080', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits after 5 requests from the same ip (429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const opts = { ...ctx, mailerUrl: 'http://mailer.svc:8080', fetchImpl: fetchMock };
    for (let i = 0; i < 5; i++) expect((await handleContact(good, opts)).status).toBe(200);
    expect((await handleContact(good, opts)).status).toBe(429);
  });

  it('returns 502 when a send fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await handleContact(good, {
      ...ctx, mailerUrl: 'http://mailer.svc:8080', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(502);
  });
});

describe('handleContact captcha', () => {
  const mailer = { mailerUrl: undefined, fetchImpl: () => Promise.resolve({ ok: true } as Response) };

  it('rejects with 400 when captcha is active and the token is missing/invalid', async () => {
    const res = await handleContact(
      { ...good, captchaToken: 'bad' },
      { ...ctx, ...mailer, captcha: { active: true, consume: () => false } }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });

  it('accepts when captcha is active and the token is valid', async () => {
    let consumed = '';
    const res = await handleContact(
      { ...good, captchaToken: 'tok-123' },
      { ...ctx, ...mailer, captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } } }
    );
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok-123');
  });
});
