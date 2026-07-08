import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCvRequest, __resetCvRateLimit } from '../../src/pages/api/cv-request';

const good = { name: 'Recruiter', email: 'r@acme.example', company: 'Acme', consent: true };
const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-13T00:00:00.000Z'),
  ip: '9.9.9.9',
  owner: 'owner@gregco.example',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetCvRateLimit());

describe('handleCvRequest', () => {
  it('stage mode (no mailer) → 200, no fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleCvRequest(good, { ...ctx, mailerUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails the owner only (reply-to requester), no confirmation to the requester', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleCvRequest(good, {
      ...ctx, mailerUrl: 'http://mailer.svc:8080', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://mailer.svc:8080/send');
    const owner = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(owner).toMatchObject({ to: 'owner@gregco.example', replyTo: 'r@acme.example' });
    expect(owner.subject).toContain('CV');
    // The requester's address must never be a send destination.
    expect(fetchMock.mock.calls.every((c) => JSON.parse(c[1].body).to !== 'r@acme.example')).toBe(true);
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
    const res = await handleCvRequest({ ...good, captchaToken: 'tok' }, {
      ...ctx, mailerUrl: undefined,
      captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } },
    });
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok');
  });

  it('rate-limits after 5 from one ip (429)', async () => {
    const opts = { ...ctx, mailerUrl: undefined as string | undefined };
    for (let i = 0; i < 5; i++) expect((await handleCvRequest(good, opts)).status).toBe(200);
    expect((await handleCvRequest(good, opts)).status).toBe(429);
  });
});
