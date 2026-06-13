import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCvRequest, __resetCvRateLimit } from '../../src/pages/api/cv-request';

const good = { name: 'Recruiter', email: 'r@acme.example', company: 'Acme', consent: true };
const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-13T00:00:00.000Z'),
  ip: '9.9.9.9',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetCvRateLimit());

describe('handleCvRequest', () => {
  it('stage mode (no webhook) → 200, no fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleCvRequest(good, { ...ctx, webhookUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a cv-request payload to the webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleCvRequest(good, {
      ...ctx, webhookUrl: 'https://hooks.example/cv', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ name: 'Recruiter', type: 'cv-request', consent: true, site: 'GregCo' });
  });

  it('400 when not consented', async () => {
    const res = await handleCvRequest({ ...good, consent: false }, { ...ctx });
    expect(res.status).toBe(400);
  });

  it('400 when captcha active and token missing/invalid', async () => {
    const res = await handleCvRequest({ ...good, captchaToken: 'bad' }, {
      ...ctx, captcha: { active: true, consume: () => false },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });

  it('accepts + consumes a valid captcha token', async () => {
    let consumed = '';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleCvRequest({ ...good, captchaToken: 'tok' }, {
      ...ctx, webhookUrl: 'https://hooks.example/cv', fetchImpl: fetchMock,
      captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } },
    });
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok');
  });

  it('rate-limits after 5 from one ip (429)', async () => {
    const opts = { ...ctx, webhookUrl: undefined as string | undefined };
    for (let i = 0; i < 5; i++) expect((await handleCvRequest(good, opts)).status).toBe(200);
    expect((await handleCvRequest(good, opts)).status).toBe(429);
  });
});
