# Puzzle Captcha (Contact Form) — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Summary

Add a server-validated **slide-puzzle captcha** to the contact form. When the
visitor clicks SEND (after field validation), a puzzle appears: a background
image with a puzzle-piece-shaped notch and a draggable piece. The image is a
random pick from `public/puzzles/`. The notch position (`gapX`) is a server
secret; the client slides the piece and the server validates the X within a
tolerance. Only after solving does the form advance to the typewriter preview;
APPROVE then forwards the message only if the solved captcha token is valid and
unconsumed. Built with vanilla JS + Node/`sharp` — **no Python dependency**.

> Note: `vsmutok/PuzzleCaptchaSolver` is a *solver* (it defeats this kind of
> captcha) and is Python. We are building the *challenge*, not embedding the
> solver; the repo is only a reference for the captcha style.

## Goals

- Slide-puzzle captcha gating contact submissions, self-hosted, no Python.
- Puzzle image chosen at random from `public/puzzles/{img}`.
- Server-side validation: `gapX` never sent to the browser; verified within a
  tolerance behind a one-time token.
- Failed validation → the user can try again (fresh challenge).
- Graceful degradation: if the captcha is disabled or no puzzle images exist,
  the form still sends (no hard break).

## Non-goals

- No third-party captcha service, no Python, no ML solver.
- Not claiming bot-proof: slide captchas are defeatable by solvers; this is
  meaningful friction layered on the existing honeypot + rate limit.
- No keyboard-only solving path in v1 (pointer/touch drag); noted as future.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Validation | Server-side, token-based | `gapX` stays secret; real-ish protection; no Python (uses `sharp`). |
| Image cutting | `sharp` + inline SVG shape | libvips is already present; composites a notch + masks the piece. |
| Gate point | After field validation, before preview | Matches "when the user clicks SEND"; don't make users solve a puzzle for an invalid form. |
| Token store | In-memory Map + TTL | Matches the single-process stateless container; restart just voids open puzzles. |
| When enforced | `config.contact.captcha && puzzles exist` | Strict when active; degrades gracefully when off or no images. |
| Piece shape | Rounded square with a small jigsaw tab (SVG) | Recognizable; simple to mask/composite. |

## Architecture & flow

Endpoints (Astro SSR):

- **`GET /api/captcha`** → if captcha inactive, `{ active: false }`. Otherwise:
  pick a random image from `public/puzzles/`, cut it with `sharp`, return
  `{ active: true, token, background, piece, pieceY, pieceSize, width, height }`
  where `background`/`piece` are PNG data-URLs. Stores `{ gapX, solved:false,
  consumed:false, createdAt }` under `token`. `gapX` is NOT returned.
- **`POST /api/captcha`** → `{ token, x }`. Looks up the token; if unexpired and
  `|x − gapX| ≤ TOLERANCE` (e.g. 8px), sets `solved:true`, returns `{ ok:true }`;
  else `{ ok:false }`.
- **`/api/contact`** (existing) → request body gains `captchaToken`. When the
  captcha is active, the handler requires the token to be solved, unexpired and
  unconsumed, then consumes it; otherwise it ignores the token.

Token store (`src/lib/captcha-store.ts`), in-memory `Map<token, Entry>`:
- `issue(gapX): string` — make a token, store the entry, return the token.
- `verify(token, x, tolerance): boolean` — mark solved if within tolerance and
  unexpired.
- `consume(token): boolean` — return true (and mark consumed) only if solved,
  unexpired, and not already consumed.
- TTL ~10 min; lazy cleanup of expired entries on access, with a size cap.

Client flow inside the overlay state machine:

```
FORM --SEND (fields valid)--> CAPTCHA --solved--> PREVIEW --APPROVE (token)--> POST /api/contact
CAPTCHA --verify fail--> CAPTCHA (fresh challenge, "try again")
CAPTCHA --back--> FORM
(if GET /api/captcha → active:false) FORM --SEND--> PREVIEW   (skip captcha)
```

## Image cutting (`src/lib/captcha-image.ts`)

- Normalize the chosen image to a fixed canvas (**320×180**, cover-fit) so the
  slide range is predictable.
- `pieceSize ≈ 56`. `gapX ∈ [pieceSize + 8, width − pieceSize − 8]`,
  `gapY ∈ [0, height − pieceSize]` (random).
- Define the piece shape as an inline SVG path (rounded square + small tab),
  `pieceSize × pieceSize`.
- **Piece** = `sharp(img).extract({left:gapX, top:gapY, width:pieceSize,
  height:pieceSize})` composited with the shape SVG as a `dest-in` mask →
  transparent-edged piece, PNG.
- **Background** = the normalized image composited with a dark, semi-transparent
  copy of the shape at `(gapX, gapY)` → the visible hole, PNG.
- Returns `{ background: Buffer, piece: Buffer, gapX, gapY, pieceSize, width,
  height }`. The endpoint converts buffers to data-URLs and keeps `gapX` server-side.

## Client captcha UI (in `ContactOverlay.astro`)

- A hidden captcha panel: a positioned container of `width × height` showing the
  background; the piece overlaid absolutely at `left:0; top:pieceY`; a slider
  handle on a track beneath. Pointer events (mouse + touch) drag the handle,
  mapping linearly to the piece's `x ∈ [0, width − pieceSize]`.
- On pointer-up: `POST /api/captcha {token, x}`. `ok` → keep token, go to PREVIEW;
  else show `> ACCESS DENIED — RECALIBRATING`, fetch a fresh challenge.
- `← back` returns to FORM. If `GET /api/captcha` returns `active:false`, skip to
  PREVIEW.
- The solved `token` is included in the APPROVE `POST /api/contact` body as
  `captchaToken`.
- Terminal-styled to match the form. Existing typing/click sounds unaffected.

## `/api/contact` enforcement, config & images

- `handleContact(input, opts)` gains `opts.captcha = { active: boolean;
  consume(token?): boolean }` (injected for testability). When `active`: a
  missing token or `consume()` returning false → `400 { ok:false, error:'captcha
  required' }`; otherwise forward/stage as before. When inactive: ignore the token.
- The Astro `POST` wrapper builds `captcha` from `captchaActive()` (=
  `getConfig().contact.captcha && puzzlesAvailable()`) and the real
  `captcha-store.consume`.
- **Config:** `contact.captcha: boolean` (default `true`). `contact.enabled`
  still gates the tab/overlay.
- **Images:** create `public/puzzles/` and `scripts/make-puzzle-samples.mjs`
  (sharp) generating 2–3 terminal-green sample images, committed so the feature
  works out of the box; real photos can be dropped in later. `puzzlesAvailable()`
  checks the directory (under `dist/client/puzzles` at runtime, `public/puzzles`
  in dev) for at least one image.

## Testing

- **`captcha-store.ts` (unit):** `issue` stores and returns a token; `verify`
  within tolerance → solved, outside → false; expired → false; `consume` returns
  true once for a solved+unexpired token and false on reuse / unsolved / expired.
- **`handleContact` (unit):** captcha active + no token → 400; + bad token
  (consume false) → 400; + valid token (consume true) → forwarded/staged. Existing
  endpoint tests updated to pass `captcha:{ active:false }` so they still hold;
  new tests cover the active path.
- **`captcha-image.ts` (smoke):** returns background + piece buffers; piece is
  `pieceSize × pieceSize`; `gapX`/`gapY` within bounds. No pixel assertions on
  sharp output.
- **Client UI** (slider drag, verify, retry, inactive fallback): manual/visual.

## Open questions / future work

- Keyboard-accessible solving (arrow keys) — future.
- Optional: rate-limit `GET /api/captcha` issuance; reuse the existing limiter.
- Real puzzle photos replace the generated samples whenever the user adds them.
