import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/lib/version';
import { GET } from '../../src/pages/version';

describe('version', () => {
  it('exposes a bare semver string from VERSION.txt', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('GET /version returns JSON { version }', async () => {
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({ version: VERSION });
  });
});
