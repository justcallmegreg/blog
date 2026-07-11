import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { buildQrSvg, parseQrParams } from '../../src/lib/qr/render';

async function decode(svg: string): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return res ? res.data : null;
}

describe('buildQrSvg', () => {
  it('produces a scannable code WITH the centre logo (ecc H)', async () => {
    const url = 'https://example.test/vault/94';
    const svg = buildQrSvg(url, { ecc: 'H', logo: true, frame: true, scanlines: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data:image/png;base64,'); // the embedded face
    expect(await decode(svg)).toBe(url);
  });

  it('is scannable with the logo off too', async () => {
    const url = 'https://example.test/x';
    const svg = buildQrSvg(url, { ecc: 'H', logo: false, frame: false, scanlines: false });
    expect(svg).not.toContain('data:image/png;base64,');
    expect(await decode(svg)).toBe(url);
  });
});

describe('parseQrParams', () => {
  const p = (qs: string) => parseQrParams(new URL('http://x/api/qr' + qs));
  it('requires data and caps length', () => {
    expect(p('')).toEqual({ error: 'missing data' });
    expect('error' in p('?data=' + 'a'.repeat(1501))).toBe(true);
  });
  it('defaults: svg, ecc H, logo/frame/scanlines on, size 512', () => {
    expect(p('?data=hi')).toMatchObject({ data: 'hi', format: 'svg', size: 512, opts: { ecc: 'H', logo: true, frame: true, scanlines: true } });
  });
  it('parses overrides and clamps size', () => {
    expect(p('?data=hi&format=png&ecc=M&logo=off&size=9000')).toMatchObject({ format: 'png', size: 2048, opts: { ecc: 'M', logo: false } });
    expect(p('?data=hi&size=1')).toMatchObject({ size: 128 });
  });
  it('rejects invalid enums', () => {
    expect('error' in p('?data=hi&format=gif')).toBe(true);
    expect('error' in p('?data=hi&ecc=Z')).toBe(true);
    expect('error' in p('?data=hi&logo=maybe')).toBe(true);
  });
});
