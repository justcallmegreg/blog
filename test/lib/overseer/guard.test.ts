import { describe, it, expect } from 'vitest';
import { overseerBlocked } from '../../../src/lib/overseer/guard';

describe('overseerBlocked', () => {
  it('blocks /overseer routes when disabled', () => {
    expect(overseerBlocked('/overseer', false)).toBe(true);
    expect(overseerBlocked('/overseer/', false)).toBe(true);
    expect(overseerBlocked('/overseer/api/delete', false)).toBe(true);
  });

  it('allows /overseer routes when enabled', () => {
    expect(overseerBlocked('/overseer', true)).toBe(false);
    expect(overseerBlocked('/overseer/api/delete', true)).toBe(false);
  });

  it('never blocks non-overseer paths', () => {
    expect(overseerBlocked('/', false)).toBe(false);
    expect(overseerBlocked('/about', false)).toBe(false);
    expect(overseerBlocked('/overseerish', false)).toBe(false);
  });
});
