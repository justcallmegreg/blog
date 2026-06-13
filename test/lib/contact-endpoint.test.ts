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
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetRateLimit());

describe('handleContact', () => {
  it('stage mode (no webhook): returns 200 and does not fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact(good, { ...ctx, webhookUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the payload to the webhook when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleContact(good, {
      ...ctx,
      webhookUrl: 'https://hooks.example/abc',
      fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ name: 'Vault Dweller', site: 'GregCo', sentAt: ctx.now.toISOString() });
    expect('company' in sent).toBe(false);
  });

  it('honeypot returns 200 success but does NOT forward', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, company: 'bot' }, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid input returns 400 and does not forward', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, email: 'nope' }, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits after 5 requests from the same ip (429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const opts = { ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock };
    for (let i = 0; i < 5; i++) expect((await handleContact(good, opts)).status).toBe(200);
    expect((await handleContact(good, opts)).status).toBe(429);
  });

  it('returns 502 when the webhook fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await handleContact(good, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(502);
  });
});

describe('handleContact captcha', () => {
  const webhook = { webhookUrl: undefined, fetchImpl: () => Promise.resolve({ ok: true } as Response) };

  it('rejects with 400 when captcha is active and the token is missing/invalid', async () => {
    const res = await handleContact(
      { ...good, captchaToken: 'bad' },
      { ...ctx, ...webhook, captcha: { active: true, consume: () => false } }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });

  it('accepts when captcha is active and the token is valid', async () => {
    let consumed = '';
    const res = await handleContact(
      { ...good, captchaToken: 'tok-123' },
      { ...ctx, ...webhook, captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } } }
    );
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok-123');
  });
});
