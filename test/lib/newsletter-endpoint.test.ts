import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleNewsletter, __resetNewsletterRateLimit } from '../../src/pages/api/newsletter';

const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-14T00:00:00.000Z'),
  ip: '9.9.9.9',
  subscribeUrl: 'https://hooks.example/sub',
  unsubscribeUrl: 'https://hooks.example/unsub',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetNewsletterRateLimit());

describe('handleNewsletter', () => {
  it('subscribe routes to the subscribe webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.example/sub');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ email: 'a@b.example', action: 'subscribe', site: 'GregCo' });
  });
  it('unsubscribe routes to the unsubscribe webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleNewsletter({ email: 'a@b.example', action: 'unsubscribe' }, { ...ctx, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hooks.example/unsub');
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
  it('stage mode (no url) → 200, no fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, { ...ctx, subscribeUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rate-limits after 5 (429)', async () => {
    const opts = { ...ctx, subscribeUrl: undefined as string | undefined };
    for (let i = 0; i < 5; i++) expect((await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, opts)).status).toBe(200);
    expect((await handleNewsletter({ email: 'a@b.example', action: 'subscribe' }, opts)).status).toBe(429);
  });
});
