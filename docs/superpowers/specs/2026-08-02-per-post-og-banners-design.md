# Per-post OG banners — design

**Date:** 2026-08-02
**Status:** approved
**Depends on:** social-embed / Open Graph unfurls (shipped in v0.43.0)

## Problem

Every page currently shares one static `public/og-default.png` in its social
unfurl card. Posts and transmissions should each get a unique, on-brand banner
generated from their own title and metadata.

Constraint that drives the architecture: **content is git-synced at runtime**
(ContentStore clones/fetches `blog-content` on an interval), so the set of
posts is not known at image build time. Banners therefore cannot be
pre-generated static assets in the engine image.

## Decisions (locked with Greg)

1. **Card style: log-entry.** Site-title header + divider rule + wrapped
   title + meta line with block cursor. Terminal look shared with the site:
   VT323, `#33ff66` on `#0b0f0b`, scanlines, vignette.
2. **Scope: blog posts AND transmissions.** Other pages keep the static
   default banner. Overseer untouched.
3. **Generation: runtime endpoint, cached, with fallback.** No content-repo
   or publish-flow changes; covers all existing and future posts
   automatically.

## Architecture

```
GET /og/blog/<slug>.png          GET /og/transmissions/<slug>.png
  → look up live post/transmission by slug (ContentStore)
  → cache HIT on its blobHash?  → serve cached PNG bytes
  → MISS → build SVG(title, meta) → rasterize to PNG (resvg)
          → cache by blobHash → serve
  → not found OR any render error → serve default-banner bytes (HTTP 200)
```

- **Cache key = `blobHash`** (already on `Post` and `Transmission`): a card
  renders once per content version and re-renders only when the post changes.
- **Cache:** module-level `Map<blobHash, Buffer>`, FIFO-capped at 200
  entries — mirrors the `vaultboy.gif.ts` cache pattern.
- **Headers:** `content-type: image/png`, `cache-control: public,
  max-age=3600` (a re-published post's card refreshes downstream within an
  hour).
- **Fallback:** the endpoint never 500s. Unknown slug, hidden/draft post, or
  a render failure all serve the default banner bytes (read once from
  `dist/client`/`public`, same lookup convention as `vaultboy.gif.ts`).
  A scraper always gets a valid image.

## Renderer & font

- **Dependency added: `@resvg/resvg-js`** — SVG→PNG rasterizer, no headless
  browser. Prebuilt binaries exist for prod (linux-arm64-musl, Alpine) and
  dev (darwin-arm64). The font is passed as an in-memory buffer, so **no
  Dockerfile or fontconfig changes**.
- **Font bundled in-repo:** `src/lib/og/VT323-Regular.ttf` + its SIL OFL
  license file (`OFL.txt`). The font travels with the code.
- The SVG is a hand-built string: background, scanline pattern
  (`<pattern>` of 1px dark lines), radial vignette, header text, divider
  `<rect>`, title `<text>` lines, meta line, block-cursor `<rect>`.

## Text fitting (exact, not heuristic)

VT323 is fixed-width, so fitting is arithmetic with one calibrated
advance-ratio constant (`ADVANCE ≈ advance-width / font-size`, measured from
the TTF):

```
chars_per_line = floor(maxTextWidth / (fontSize × ADVANCE))
```

- Wrap the title on word boundaries at `chars_per_line`. A single word longer
  than the line is hard-broken.
- Step the font size down through 96 → 84 → 72 → 60 px until the wrapped
  title fits in ≤ 4 lines. At 60px, clamp to 4 lines and ellipsize the last
  line if needed (extreme titles only).

## Card template (1200×630)

| Zone | Content |
|---|---|
| Header (top) | posts: `GregCo Industries // Personal log` · transmissions: `GregCo Industries // Transmission log` (site title from config) |
| Divider | thin `#33ff66` rule under the header |
| Title (dominant) | wrapped + auto-fit per the rules above |
| Meta (bottom) | posts: `<date> · <N> min read ▉` · transmissions: `<date> · Transmission ▉` (date omitted when empty; cursor is a drawn `<rect>`, not a glyph) |

**Unified default banner:** `public/og-default.png` is regenerated from this
same template (site title as the "title", no meta date) via a small
`scripts/` one-off, so generated and static cards share one look. The static
file remains a committed asset — the runtime endpoint does not serve the
default for non-post pages.

## Wiring

- `src/pages/[slug].astro`: pass `image={`/og/blog/${slug}.png`}` to
  `Terminal`.
- `src/pages/transmissions/[slug].astro`: pass
  `image={`/og/transmissions/${slug}.png`}`.
- `Terminal.astro` already absolutizes relative `image` props against
  `site.baseUrl` — no layout changes needed.

## Files

| File | Change |
|---|---|
| `package.json` | + `@resvg/resvg-js` |
| `src/lib/og/card.ts` | new — pure: wrap/fit arithmetic + SVG string builder (`buildCardSvg({title, header, meta})`) |
| `src/lib/og/render.ts` | new — resvg wiring: font buffer load, SVG→PNG, blobHash cache, default-banner fallback bytes |
| `src/lib/og/VT323-Regular.ttf`, `src/lib/og/OFL.txt` | new — bundled font + license |
| `src/pages/og/[collection]/[slug].png.ts` | new — APIRoute; validates `collection ∈ {blog, transmissions}`, looks up content, serves |
| `src/pages/[slug].astro`, `src/pages/transmissions/[slug].astro` | pass `image` prop |
| `public/og-default.png` | regenerated from the shared template |
| `scripts/render-og-default.mjs` | new — one-off generator for the default banner |

## Testing

- **`test/lib/og-card.test.ts`** — pure logic: wrapping at exact char
  boundaries, font-size stepping, 4-line clamp + ellipsis, header/meta
  variants, SVG contains expected elements (no XML parsing — string asserts,
  matching repo convention).
- **`test/lib/og-render.test.ts`** — smoke: renders a card, asserts PNG magic
  bytes + nonzero length; cache returns identical Buffer for same blobHash;
  distinct for different blobHash.
- **`test/lib/og-endpoint.test.ts`** — mirrors `qr-endpoint.test.ts`: valid
  slug → 200 `image/png`; unknown slug → 200 default-banner bytes (not 500);
  invalid collection → 200 default-banner bytes; draft/hidden post → default
  banner (no information leak about hidden content).

## Error handling summary

| Failure | Behavior |
|---|---|
| Unknown slug / hidden / draft | default banner, 200 |
| Invalid collection segment | default banner, 200 |
| resvg throws / font missing | default banner, 200; `console.warn` once per blobHash |
| Default banner file itself missing | 404 (matches `vaultboy.gif.ts`; only possible in a broken build) |

## Out of scope

- Banners for decks, about, contributions, home (keep static default).
- Publish-time baking into `blog-content`.
- Poster-frame compositing for transmission banners (title card only, v1).
