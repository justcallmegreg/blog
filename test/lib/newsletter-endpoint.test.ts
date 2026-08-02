import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleNewsletter, __resetNewsletterRateLimit } from '../../src/pages/api/newsletter';

const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-14T00:00:00.000Z'),
  ip: '9.9.9.9',
  owner: 'owner@gregco.example',
  mailerUrl: 'http://mailer.svc:8080',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetNewsletterRateLimit());

describe('handleNewsletter', () => {
  it('subscribe adds the contact then emails owner + welcome', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    // first call = contact list add
    expect(fetchMock.mock.calls[0][0]).toBe('http://mailer.svc:8080/subscribe');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'a@b.example' });
    // remaining calls are /send (owner notification + welcome)
    const sendUrls = fetchMock.mock.calls.slice(1).map((c) => c[0]);
    expect(sendUrls).toEqual(['http://mailer.svc:8080/send', 'http://mailer.svc:8080/send']);
  });

  it('unsubscribe removes the contact (no welcome)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'unsubscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://mailer.svc:8080/unsubscribe');
    // only the owner notification /send after it — no welcome
    const sendUrls = fetchMock.mock.calls.slice(1).map((c) => c[0]);
    expect(sendUrls).toEqual(['http://mailer.svc:8080/send']);
  });

  it('400 on bad email', async () => {
    expect((await handleNewsletter({ email: 'x', action: 'subscribe' }, ctx)).status).toBe(400);
  });
  it('400 on bad action', async () => {
    expect((await handleNewsletter({ email: 'a@b.example', action: 'nope' as never }, ctx)).status).toBe(400);
  });
  it('400 when captcha active and token missing', async () => {
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, captcha: { active: true, consume: () => false } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });
  it('stage mode (no mailer) → 200, no fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, mailerUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('subscribe returns 200 even when the contact-list update fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: !String(url).endsWith('/subscribe') })
    );
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('subscribe returns 200 even when the welcome email fails, as long as the owner is notified', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const to = JSON.parse(init.body).to as string | undefined;
      // welcome goes to the subscriber; owner notification goes to the owner
      return Promise.resolve({ ok: to !== 'a@b.example' });
    });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('502 when the owner notification fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const to = JSON.parse(init.body).to as string | undefined;
      return Promise.resolve({ ok: to !== 'owner@gregco.example' });
    });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(502);
  });

  it('rate-limits after 5 (429)', async () => {
    const opts = { ...ctx, mailerUrl: undefined as string | undefined };
    for (let i = 0; i < 5; i++) expect((await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, opts)).status).toBe(200);
    expect((await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, opts)).status).toBe(429);
  });
});
