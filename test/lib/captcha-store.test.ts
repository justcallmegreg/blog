import { describe, it, expect, beforeEach } from 'vitest';
import { issue, verify, consume, __resetCaptchaStore } from '../../src/lib/captcha-store';

beforeEach(() => __resetCaptchaStore());

const now = () => 1_000_000; // fixed clock for determinism

describe('captcha-store', () => {
  it('issues a unique token per call', () => {
    const a = issue(120, now());
    const b = issue(120, now());
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
  });

  it('verify succeeds within tolerance and marks solved', () => {
    const t = issue(120, now());
    expect(verify(t, 124, { tolerance: 8, now: now() })).toBe(true);  // |124-120|=4
  });

  it('verify fails outside tolerance', () => {
    const t = issue(120, now());
    expect(verify(t, 140, { tolerance: 8, now: now() })).toBe(false); // |140-120|=20
  });

  it('verify fails for unknown or expired tokens', () => {
    expect(verify('nope', 120, { tolerance: 8, now: now() })).toBe(false);
    const t = issue(120, now());
    expect(verify(t, 120, { tolerance: 8, now: now() + 11 * 60_000 })).toBe(false); // > 10 min
  });

  it('consume succeeds once for a solved token, then fails on reuse', () => {
    const t = issue(120, now());
    verify(t, 120, { tolerance: 8, now: now() });
    expect(consume(t, now())).toBe(true);
    expect(consume(t, now())).toBe(false); // already consumed
  });

  it('consume fails for an unsolved token', () => {
    const t = issue(120, now());
    expect(consume(t, now())).toBe(false);
  });
});
