# New Transmission modal + direct video upload — design

Date: 2026-07-20
Status: approved (brainstorming; interactive mockup approved — `mockups/transmissions-new-modal.html`)

## Summary

Replace the overseer's inline "New Transmission" form with a **Fallout-styled modal**
opened from a wide glowing button, and let the operator **upload the video from the
modal**. The raw video streams **directly from the browser to Cloudflare R2** via a
presigned PUT (the Raspberry-Pi pod never touches the bytes); the browser reads the
**duration** and grabs a **poster frame** client-side. On submit the overseer commits
the git entry (poster + metadata) pointing at the uploaded object. The player plays the
mp4 natively with HTTP range requests.

This reverses two Plane B assumptions on purpose: video no longer arrives via a separate
local tool, and the format is **progressive mp4** rather than HLS (adaptive bitrate and
the local transcode tool are dropped).

Builds on:
- Plane A — `docs/superpowers/specs/2026-07-19-transmissions-vlog-design.md`
- Plane B — `docs/superpowers/specs/2026-07-19-transmissions-plane-b-overseer-design.md`

## Decisions (from brainstorming)

- **Upload path:** browser → R2 **direct**, presigned PUT. The overseer mints the URL;
  the Pi never streams video. Real progress/speed/ETA come from the XHR upload events.
- **Format:** raw **mp4** (H.264/AAC) or **webm**, played by a native `<video>` with
  range requests (partial download + seek — the "not the whole file at once" property
  holds). HLS/adaptive and the local transcode tool are out.
- **Poster:** auto-grabbed from the video client-side (hidden `<video>` + `<canvas>` →
  JPEG), committed to git on submit. One file picker (the video).
- **Duration:** read client-side from the file (`<video>.duration`), formatted `mm:ss`,
  sent as a field. No server transcode.
- **Slug:** hidden field — derived silently from the Title (`slugify`) at submit; no
  custom-URL control.
- **Auth:** unchanged — network-privacy-only + confirm-token on delete. The overseer's
  R2 credentials now need **write** (`PutObject`) in addition to delete; the public
  engine still gets none.

## Architecture & data flow

**New endpoint** `POST /overseer/transmissions/api/presign`
- Body: `{ slug, contentType }`. Validates the slug (`^[a-z0-9][a-z0-9-]*$`) and the
  content type (`video/mp4` | `video/webm`).
- Returns `{ url, key }` — a short-lived (~15 min) presigned **PUT** URL for
  `transmissions/{slug}/video.<ext>` via `@aws-sdk/s3-request-presigner` (new dep) using
  the overseer's R2 write creds. `ext` = mp4/webm from the content type.

**Modal create flow**
1. Wide glowing **New Transmission** button on `/overseer/transmissions` opens the modal.
2. Operator fills Title (Slug derives silently), Date (defaults today), Description.
3. Operator picks a video → the browser:
   a. reads `duration`; b. seeks to ~1s and draws a frame to a `<canvas>` → `poster.jpg`
   bytes; c. requests a presigned URL for `slug + contentType`; d. **PUTs the file to R2**
   via `XMLHttpRequest`, driving the progress bar from `upload.onprogress`.
4. **UPLOAD TRANSMISSION** enables only when Title is non-empty (valid derived slug),
   Date is set, and the upload is 100 % complete.
5. Submit → `POST …/api/create` (existing handler, adjusted) with title, derived slug,
   date, description, draft, `video: {slug}/video.<ext>`, computed `duration`, and the
   grabbed poster bytes → the overseer commits the git entry → modal closes, list
   refreshes.

**Interaction rule:** the file picker is enabled once the Title yields a valid slug (the
R2 key is slug-derived). Changing the Title after an upload **resets the upload** so the
R2 object and the entry can't diverge. An abandoned/failed upload leaves an orphaned R2
object (cheap, GC-able) — same best-effort philosophy as delete.

**Player change (Plane A `src/pages/transmissions/[slug].astro`):** pick by extension —
`video` ending `.m3u8` keeps the `hls.js` path (backward compatible); otherwise set
`<video src>` directly and stream via native range requests. Poster still served from git.

## The modal (UI spec — matches the approved mockup)

Rendered in the overseer, reusing the site's terminal aesthetic and the existing overlay
patterns (Contact/Newsletter overlays already do block-cursor inputs, CRT effects, and
click sounds).

- **Wide glowing button** at the top of the list, opening a centered modal overlay
  (scrim + blur, `Esc`/✕/scrim-click to close).
- **Fields** (in order): Title, Date, Description, Video, Hidden. Each with a hover/focus
  **tooltip** (a green popover, `position: fixed` and JS-placed so it is never clipped by
  the modal's overflow and always renders on top).
- **Title** (required) — block-cursor input: the typed text is mirrored in a span with a
  blinking block cursor immediately after it; a transparent overlay input captures keys
  (native caret hidden).
- **Date** — a calendar picker defaulting to **today** (native `type="date"`, themed).
- **Description** — multiline textarea (green native caret), **max 355 chars**, with a
  live `NNN / 355` counter under it that turns red at the cap.
- **Video** — a Fallout file picker (hidden native input behind a "Select file ▸" button +
  filename/size readout, `accept="video/mp4,video/webm"`), enabled only once the Title
  yields a valid slug. On select: poster preview + auto-duration appear, and the progress
  bar runs.
- **Progress bar** — Fallout-styled: a segmented green fill, plus a readout of
  **percent**, **uploaded / total size**, **current speed** (MB/s, from a rolling window of
  progress events), and **ETA**. Goes solid on completion.
- **Hidden** — a **vertical Fallout toggle**: **red = OFF (public, default)**,
  **green = ON (hidden/draft)**, emitting a CRT click on flip (reusing the ClickSound
  mechanism); keyboard-toggleable.
- **UPLOAD TRANSMISSION** button — disabled/dim until Title + Date + a completed upload;
  then it lights up and glows. Submitting commits the entry.
- **Removed:** the `mm:ss` duration field (auto-computed) and the Slug field (derived).

## Server / handler changes

- **`src/pages/overseer/transmissions/api/presign.ts`** (new) — the presign endpoint
  above; thin route + a pure `presignInput` validator + injectable presigner for tests.
- **`src/lib/overseer/r2.ts`** — add `presignPut(cfg, key, contentType, expires?)` using
  `@aws-sdk/s3-request-presigner` + `PutObjectCommand`; injectable for tests. (Delete path
  unchanged.)
- **`src/pages/overseer/transmissions/api/create.ts`** — `handleCreate` already accepts
  `video`, `duration`, and `posterBytes`; the modal now supplies `video = {slug}/video.<ext>`
  (the uploaded key), the client-computed `duration`, and the grabbed poster. No handler
  signature change is expected beyond confirming `video`/`duration` pass through. Slug is
  derived from the title in the route's form parsing.
- **`src/pages/overseer/transmissions/index.astro`** — replace the inline form with the
  modal markup + client script (the bulk of the work): button, overlay, fields, tooltips,
  block cursor, calendar, file picker, description counter, vertical toggle + sound,
  progress bar, presign+XHR upload orchestration, client-side duration + poster extraction,
  submit gating.

## R2 configuration (operator-set; documented, not code)

- The overseer's R2 credentials need **write** (`PutObject`) scope, not just delete.
- The bucket needs a **CORS rule** allowing `PUT` (and the needed headers) from the
  overseer's origin — without it the browser upload is blocked. Document the exact rule in
  the README/values.yaml.

## Error handling

- Presign failure → the modal surfaces a clear error and the upload doesn't start.
- Upload (XHR) failure/abort → the progress bar shows the error; the operator can retry;
  a partial object may be orphaned in R2 (best-effort, GC-able).
- Create-commit failure → the existing `handleCreate` surfaces the (now-logged) error; the
  already-uploaded video is orphaned in R2 until re-tried or GC'd.
- No half-written git entry (create is a single atomic commit, per Plane B).

## Testing

- **Pure/units:** `presignInput` validation (slug + content type; rejects bad slug / wrong
  type), `presignPut` (with an injected presigner fake: returns a URL for the right key),
  duration-format and slugify helpers (extracted so they're testable), and the
  ETA/speed math.
- **Handler:** `create` still commits `video`/`duration`/poster correctly (existing tests
  cover the shape; extend if `video` extension handling changes).
- **Player:** the extension-based branch (`.m3u8` → hls.js, else native `<video src>`)
  verified in the build + a live check.
- **Modal UI:** build + live overseer verification (open modal, simulate the flow,
  gating, toggle, counter, tooltips) — Astro pages aren't unit-tested in this repo.

## Out of scope

- HLS / adaptive bitrate and the local transcode tool (both dropped by this design).
- Server-side transcoding or thumbnailing.
- A fully custom calendar widget (native styled `type="date"` for now).
- Editing an existing transmission's video (the edit page keeps metadata-only; replacing a
  video is a future follow-up).
- The deferred Plane B items (CSRF hardening, namespace/`contentDir`, unstyled tables).
