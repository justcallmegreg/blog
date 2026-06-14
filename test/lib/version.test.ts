import { describe, it, expect } from 'vitest';
import { VERSION, COMMIT, BUILT_AT } from '../../src/lib/version';
import { GET } from '../../src/pages/version';

describe('version', () => {
  it('exposes a bare semver string from VERSION.txt', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes commit + builtAt strings (build-time defines, falling back gracefully)', () => {
    expect(typeof COMMIT).toBe('string');
    expect(COMMIT.length).toBeGreaterThan(0);
    expect(typeof BUILT_AT).toBe('string');
    expect(BUILT_AT.length).toBeGreaterThan(0);
  });

  it('GET /version returns JSON { version, commit, builtAt }', async () => {
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({ version: VERSION, commit: COMMIT, builtAt: BUILT_AT });
  });
});
