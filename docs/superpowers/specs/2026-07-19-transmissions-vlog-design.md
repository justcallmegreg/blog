# Transmissions vlog — design

Date: 2026-07-19
Status: approved (brainstorming)

## Summary

A **Transmissions** tab: a vlog where each entry is a video, listed newest-first
with a title, short description, and a clickable poster thumbnail. Clicking a
poster opens a player page whose HLS player fills the content area.

Videos are stored and streamed **segmented (HLS)** from **Cloudflare R2**
(zero egress), so playback fetches short chunks on demand and adapts bitrate —
never a single whole-file download. The **blog engine stays stateless**: it only
renders URLs and never holds video bytes or R2 credentials.

Content is **gitops** — a transmission is a small entry in the `blog-content`
repo (mirroring posts/decks), the single source of truth. The **overseer**
(private admin console) is the management surface: create/upload/edit/hide/delete,
each committing to `blog-content` via the GitHub API. Transcoding runs **locally**
(the arm64 Raspberry Pi cluster never transcodes).

## Decisions (from brainstorming)

- **Scale:** ambitious — 200 GB–1 TB+/month egress; per-GB delivery cost is the
  driving constraint. This rules out S3+CloudFront (~$0.085/GB → ~$85/TB).
- **Storage/CDN:** Cloudflare R2 — **$0 egress**, ~$0.015/GB-mo storage,
  S3-compatible API. Public-read behind a Cloudflare custom domain
  (e.g. `media.justcallmegreg.io`), fully CDN-cacheable, no signed URLs.
- **Streaming:** roll-your-own **HLS** (adaptive ladder) served as static files;
  `hls.js` in-browser (native HLS on Safari/iOS).
- **Source of truth:** git (`blog-content`). The overseer commits to it.
- **Overseer commit style:** **direct commits to `main`** (the overseer is the
  trusted, authenticated admin surface). Manual PR authoring still works in
  parallel.
- **Transcode location:** **local** (author's Mac). The overseer uploads an
  already-produced HLS bundle; it never runs ffmpeg.

## Shared contract (all three planes depend on this)

### Git — the entry (in `blog-content`)

Mirrors the existing `blogs/` and `decks/` layout:

```
transmissions/justcallmegreg-blog/{slug}/
    index.md          # frontmatter below
    assets/poster.jpg # clickable thumbnail — a small image, stays in git
```

`index.md` frontmatter:

```yaml
title: "Booting the Vault — First Transmission"
date: "2026-06-02"                 # display date; PR-merge-date logic still applies
publishAt: "2026-06-02T09:00"      # optional scheduling, same semantics as posts
description: "Channel zero. Why I'm recording these…"
video: "booting-the-vault/master.m3u8"   # path relative to the R2 media base
duration: "05:52"                  # optional; shown on the card and player
draft: false                       # true = hidden from the list and 404 (the "hide" action)
```

Rationale for a **relative** `video` path plus a config base URL (rather than a
full URL in frontmatter): DRY and portable — the entry says *what*, config says
*where*; re-pointing providers never requires rewriting entries.

### R2 — the media bytes

```
<bucket>/transmissions/{slug}/master.m3u8      # multivariant playlist
                              /1080p.m3u8 + segments…
                              /720p.m3u8  + segments…
                              /480p.m3u8  + segments…
```

Uploaded with long-lived `Cache-Control` (segments are immutable). Bucket is
public-read via the Cloudflare custom domain.

### Engine config (new)

```yaml
transmissions:
  enabled: true
  mediaBaseUrl: "https://media.justcallmegreg.io"   # R2 custom domain
```

Playback URL = `mediaBaseUrl + "/transmissions/" + video`.

## Plane A — Engine rendering (read plane) — BUILD FIRST

Deployable and testable against a single hand-authored entry; this is the
user-visible feature, and the interactive mockup already exists at
`mockups/transmissions-vlog.html`.

**Content type.** Add `transmissions` as a third indexed type in `ContentStore`,
alongside posts and decks, reusing the existing machinery: path parsing,
`blobHash` change detection, `draft` gating, `publishAt` visibility gating, and
the PR-merge-date logic. A transmission indexes to: `url`, `slug`, `title`,
`date`, `description`, `video`, `duration`, `posterUrl` (the in-repo
`assets/poster.jpg`), `draft`, `publishAt`.

**Routes (server-rendered, like posts).**
- `GET /transmissions` — the list view (mockup): newest-first entries, each a
  poster thumbnail + title + description + duration. Hidden (`draft`) and
  not-yet-`publishAt` entries are excluded, matching post behavior.
- `GET /transmissions/{slug}` — the player page: the HLS player fills the content
  area; title/date/description/duration below. A real route makes each
  transmission **shareable/deep-linkable**. The poster on the list links here.
  A hidden or unpublished slug 404s (via the engine's existing gating).
- `GET /transmissions/{slug}/assets/{file}` — serves the in-git poster (and any
  future entry assets), mirroring the existing post asset route
  (`src/pages/[slug]/assets/[...file].ts`) with the same slug-scoped traversal
  guard. `posterUrl` resolves to this route.

**Player.** `hls.js` loaded **lazily on the player page only** (not site-wide).
Safari/iOS play the `.m3u8` natively; elsewhere `hls.js` drives segmented,
adaptive-bitrate playback. The engine embeds `mediaBaseUrl + "/transmissions/" +
video` as the source.

**JS-disabled degradation.** The site is "fully readable with JS off." HLS needs
JS, so with JS disabled the player page shows the poster + a short
"playback needs JavaScript" note + a direct link to the `.m3u8`. Never a blank
box.

**Tab.** Activate the **Transmissions** tab → `/transmissions`. (The disabled
placeholder tab lives on the separate `feat/disabled-tabs` branch; Plane A owns
making Transmissions active regardless of that branch's state, and keeps
Computer Programs disabled.)

**Config.** Add the `transmissions` block above to config schema + defaults.
When `transmissions.enabled` is false, the tab is hidden and the routes 404
(mirroring the `about`/`newsletter` enabled-gating pattern).

## Plane B — Overseer CRUD (write plane) — BUILD SECOND (with C)

A new **Transmissions** tab in the overseer, following the existing overseer
handler pattern (pure `handle*()` + thin route + confirm-token for mutations).
The overseer is the same image deployed privately with new secrets: R2
credentials and a `blog-content` write token.

- **Create.** Upload a locally-produced HLS bundle (the Plane-C output) + poster
  + metadata form (title, description, date, duration). The overseer pushes the
  bundle to `R2 transmissions/{slug}/…` and commits the entry
  (`transmissions/justcallmegreg-blog/{slug}/index.md` + `assets/poster.jpg`) to
  `blog-content` main via the GitHub API.
- **Edit.** Rewrite `index.md` frontmatter (title/description/date/duration) and
  commit.
- **Hide/Unhide.** Toggle `draft: true/false` in `index.md` and commit (reuses
  the engine's existing draft gating — no new visibility logic).
- **Delete.** Remove the entry dir (commit) **and** delete the
  `R2 transmissions/{slug}/` objects so storage isn't orphaned. Guarded by the
  existing `confirm: "APPROVE"` pattern.

**Security boundary.** The overseer now has content-write + R2 power, so it MUST
remain on the private ingress, never publicly exposed. (Its only gate today is
network privacy via `OVERSEER_ENABLED` + private ingress; that property must
hold.)

**Latency note.** Overseer changes go live after the engine's next content sync,
not instantly — acceptable and consistent with all other content.

## Plane C — Local transcode helper — BUILD SECOND (with B)

A small local script (author's Mac) that turns `clip.mp4` into the exact bundle
Plane B ingests:

1. `ffmpeg` → HLS ladder (default 1080p/720p/480p, H.264/AAC, ~6s segments) →
   `master.m3u8` + per-rendition playlists + segments under `{slug}/`.
2. Extract a poster frame (default ~1s in, overridable) → `poster.jpg`.
3. Auto-detect duration for the metadata form.

Output is the on-disk bundle the overseer Create form uploads. Home/location
(repo `scripts/` vs a standalone skill like deck-creator) is decided when Plane
C is specced.

## Build order

1. **Plane A** — arch + Spec A (this doc). Build, test against one hand-authored
   entry, deploy. Proves the read plane and ships the visible feature.
2. **Planes B + C together** — the authoring pipeline; C defines the bundle B
   ingests. Each gets its own spec → plan → implementation cycle.

## Testing (Plane A)

- `ContentStore`: a `transmissions/{owner}-{repo}/{slug}/index.md` fixture
  indexes with the right fields; `draft: true` and future `publishAt` are
  excluded from the list and 404 on the route; poster URL resolves to the
  in-repo asset path.
- URL composition: `mediaBaseUrl + "/transmissions/" + video` for representative
  inputs; trailing/leading slash normalization.
- Route rendering: `/transmissions` lists visible entries newest-first;
  `/transmissions/{slug}` renders the player with the composed source and a
  JS-off fallback containing the poster + `.m3u8` link.
- Config gating: `transmissions.enabled: false` hides the tab and 404s routes.

## Out of scope (Plane A)

- The overseer CRUD (Plane B) and the transcode helper (Plane C).
- Any in-pod transcoding or R2 credentials in the public engine.
- Signed/private video URLs — the vlog is public.
- Per-video analytics beyond what Matomo already captures for page views.
