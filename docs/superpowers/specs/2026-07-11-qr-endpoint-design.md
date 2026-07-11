# Fallout QR endpoint — design

Date: 2026-07-11
Status: approved (brainstorming; mockup approved)

## Summary

A stateless API endpoint that renders a **Fallout / Pip-Boy-styled QR code on
demand** from a query string. Pip-Boy green modules on a CRT ground, scanline
texture, glow, a green frame, and the Vault Boy face embedded at the centre. The
code stays scannable (error-correction **H** recovers the ~26% centre emblem —
verified by round-trip decode).

Approved constraints:
- **Always generated on demand; never saved.** No server-side persistence or
  caching of generated QR images. Each request builds and returns the image.
- The only committed artefact is the **logo** (the deploy container can't reach
  the source `~/Desktop/pipboy.png`): the background-removed green face, baked in
  as a committed asset and embedded into the SVG at generation time.

## Endpoint

`GET /api/qr`

| Param | Default | Notes |
|---|---|---|
| `data` | — (required) | Text/URL to encode. Reject empty; cap length (≤ 1500 chars → 400). |
| `format` | `svg` | `svg` \| `png`. PNG is rasterised from the SVG via `sharp` (already a dep). |
| `ecc` | `H` (when logo on) | `L` \| `M` \| `Q` \| `H`. |
| `logo` | `on` | `on` \| `off`. When off, no centre emblem. |
| `size` | `512` | Output pixel size for PNG; SVG viewBox is intrinsic and scales. Clamp 128–2048. |
| `frame` | `on` | `on` \| `off` — the green border. |
| `scanlines` | `on` | `on` \| `off` — the CRT scanline overlay. |

Responses:
- `200` `image/svg+xml` (or `image/png`) with the rendered code.
- `400` `text/plain` for missing/too-long `data` or invalid enum params.
- `Cache-Control: public, max-age=86400` — the output is deterministic for a given
  query, so downstream (browser/CDN) caching is fine; **we** store nothing.

## Components

- `src/lib/qr/pipboy-face.ts` — **committed** `export const PIPBOY_FACE: string`
  (a `data:image/png;base64,…` URI of the background-removed green face).
  Generated once (see build note) from `~/Desktop/pipboy.png`; not reprocessed at
  runtime.
- `src/lib/qr/render.ts` — pure builder:
  - `buildQrSvg(data: string, opts: QrOptions): string` — uses `qrcode`
    (`QRCode.create`, ECC per opts) to get the module matrix, then emits the
    styled SVG (CRT radial ground, green module rects, optional scanline
    `<pattern>`, glow `<filter>`, optional frame, and — when `logo` — a centre
    panel + `<image href={PIPBOY_FACE}>`).
  - `QrOptions = { ecc, logo, frame, scanlines }` plus derived sizing.
  - `parseQrParams(url: URL): { data, format, size, opts } | { error }` — validate
    + normalise query params (used by the route; unit-testable).
- `src/pages/api/qr.ts` — `GET` route: parse params → `buildQrSvg` → for `png`,
  `sharp(Buffer.from(svg)).png().resize(size)` → return with the right
  `Content-Type` + `Cache-Control`. Errors → 400.

## Dependencies

- Runtime: **`qrcode`** (new). `sharp` already present (PNG rasterisation).
- Dev: `@types/qrcode`, and **`jsqr`** for the round-trip decode test.

## Style (from the approved mockup)

Green `#39ff74` modules on a radial CRT ground (`#0a1f10 → #06110a → #030805`),
`rx≈1.5` on modules, scanline `<pattern>` at low opacity, a `feGaussianBlur` glow
merge on the modules, a green frame stroke, and a dark rounded centre panel behind
the face (~26% of the canvas). 4-module quiet zone.

## Testing

- `parseQrParams`: required `data`; length cap → error; enum validation
  (`format`/`ecc`/`logo`/`frame`/`scanlines`); `size` clamp. (node, pure)
- **Round-trip scannability**: `buildQrSvg('https://example.test/x', {logo:on,ecc:H})`
  → `sharp` rasterise to PNG → `jsQR` decode → equals the input. Also assert it
  still decodes with the logo ON (the important case). (node — `jsqr` needs no DOM.)
- Endpoint handler: a helper `handleQr(url)` returns `{status, contentType, body}`;
  test 200 svg, 200 png (magic bytes), and 400 on missing/oversized `data`.

## Build note (one-time logo generation)

`pipboy-face.ts` is produced by a small committed script or a documented one-off:
read `~/Desktop/pipboy.png` with `sharp`, key out near-white (bright + low-chroma)
pixels to transparent with a feathered edge, base64 the PNG, write the TS const.
The endpoint never touches the original image.

## Out of scope (YAGNI)

- Server-side caching / a QR store (explicitly not wanted).
- Custom colours / arbitrary logos per request (fixed Fallout identity).
- Batch generation, download filenames, vCard/wifi payload helpers.
