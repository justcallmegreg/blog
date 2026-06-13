import { describe, it, expect } from 'vitest';
import { TOLERANCE } from '../../src/pages/api/captcha';

describe('captcha endpoint constants', () => {
  it('exposes a small pixel tolerance', () => {
    expect(TOLERANCE).toBeGreaterThan(0);
    expect(TOLERANCE).toBeLessThanOrEqual(12);
  });
});
