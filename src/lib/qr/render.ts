import QRCode from 'qrcode';
import { PIPBOY_FACE } from './pipboy-face';

export type Ecc = 'L' | 'M' | 'Q' | 'H';
export interface QrOptions {
  ecc: Ecc;
  logo: boolean;
  frame: boolean;
  scanlines: boolean;
}

const FG = '#39ff74';
const BG = '#06110a';
const DIM = '#0c3f1c';
const M = 8; // module px
const Q = 4; // quiet-zone modules

/** Render a Fallout/Pip-Boy-styled QR as an SVG string. */
export function buildQrSvg(data: string, opts: QrOptions): string {
  const qr = QRCode.create(data, { errorCorrectionLevel: opts.ecc });
  const N = qr.modules.size;
  const bits = qr.modules.data;
  const S = (N + Q * 2) * M;

  let rects = '';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (bits[y * N + x]) {
        rects += `<rect x="${(x + Q) * M}" y="${(y + Q) * M}" width="${M}" height="${M}" rx="1.5"/>`;
      }
    }
  }

  const logoS = Math.round(S * 0.26);
  const logoXY = Math.round((S - logoS) / 2);
  const panel = logoS + M * 2;
  const panelXY = Math.round((S - panel) / 2);

  const logo = opts.logo
    ? `<rect x="${panelXY}" y="${panelXY}" width="${panel}" height="${panel}" rx="${M * 1.5}" fill="${BG}" stroke="${DIM}" stroke-width="2"/>` +
      `<image href="${PIPBOY_FACE}" x="${logoXY}" y="${logoXY}" width="${logoS}" height="${logoS}" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  const scan = opts.scanlines ? `<rect width="${S}" height="${S}" fill="url(#scan)"/>` : '';
  const frame = opts.frame
    ? `<rect width="${S}" height="${S}" fill="none" stroke="${FG}" stroke-opacity="0.5" stroke-width="3" rx="${M * 2}"/>` +
      `<rect x="6" y="6" width="${S - 12}" height="${S - 12}" fill="none" stroke="${DIM}" stroke-width="1.5" rx="${M * 1.6}"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="QR code">` +
    `<defs>` +
    `<radialGradient id="crt" cx="50%" cy="42%" r="75%"><stop offset="0%" stop-color="#0b1f10"/><stop offset="70%" stop-color="${BG}"/><stop offset="100%" stop-color="#030805"/></radialGradient>` +
    `<filter id="glow"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.4" y="2.6" fill="#000" opacity="0.22"/></pattern>` +
    `<clipPath id="round"><rect width="${S}" height="${S}" rx="${M * 2}"/></clipPath>` +
    `</defs>` +
    `<g clip-path="url(#round)">` +
    `<rect width="${S}" height="${S}" fill="url(#crt)"/>` +
    `<g fill="${FG}" filter="url(#glow)">${rects}</g>` +
    `${logo}${scan}${frame}` +
    `</g></svg>`
  );
}

/** Validate + normalise the query string. Returns parsed params or an error. */
export function parseQrParams(url: URL): ParsedQr | { error: string } {
  const q = url.searchParams;
  const data = q.get('data');
  if (!data) return { error: 'missing data' };
  if (data.length > 1500) return { error: 'data too long (max 1500)' };

  const format = q.get('format') ?? 'svg';
  if (format !== 'svg' && format !== 'png') return { error: 'invalid format' };

  const ecc = (q.get('ecc') ?? 'H').toUpperCase();
  if (ecc !== 'L' && ecc !== 'M' && ecc !== 'Q' && ecc !== 'H') return { error: 'invalid ecc' };

  const flag = (key: string, def: boolean): boolean | null => {
    const v = q.get(key);
    if (v === null) return def;
    if (v === 'on' || v === 'true' || v === '1') return true;
    if (v === 'off' || v === 'false' || v === '0') return false;
    return null;
  };
  const logo = flag('logo', true);
  const frame = flag('frame', true);
  const scanlines = flag('scanlines', true);
  if (logo === null || frame === null || scanlines === null) return { error: 'invalid boolean param' };

  const sizeRaw = Number(q.get('size') ?? '512');
  if (!Number.isFinite(sizeRaw)) return { error: 'invalid size' };
  const size = Math.max(128, Math.min(2048, Math.round(sizeRaw)));

  return { data, format, size, opts: { ecc, logo, frame, scanlines } };
}

export interface ParsedQr {
  data: string;
  format: 'svg' | 'png';
  size: number;
  opts: QrOptions;
}
