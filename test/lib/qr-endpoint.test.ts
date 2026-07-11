import { describe, it, expect } from 'vitest';
import { handleQr } from '../../src/pages/api/qr';

const u = (qs: string) => new URL('http://x/api/qr' + qs);

describe('handleQr', () => {
  it('400 on missing data', async () => {
    const r = await handleQr(u(''));
    expect(r.status).toBe(400);
    expect(r.contentType).toBe('text/plain');
  });
  it('200 image/svg+xml by default', async () => {
    const r = await handleQr(u('?data=https://example.test'));
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/svg+xml');
    expect(String(r.body).startsWith('<svg')).toBe(true);
  });
  it('200 image/png for format=png (PNG magic bytes)', async () => {
    const r = await handleQr(u('?data=hi&format=png&size=256'));
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    const b = r.body as Buffer;
    expect(b.subarray(0, 4).toString('hex')).toBe('89504e47'); // \x89PNG
  });
});
