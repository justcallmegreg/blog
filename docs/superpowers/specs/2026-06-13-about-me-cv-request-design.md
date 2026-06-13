# About Me tab + Request CV — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Summary

A new **About me** page (`/about`, a tab in the top bar) showing a short bio
("who I am") and an **Achievements** section of confidential, unnamed projects
(start–end year, description, responsibilities, deliveries) sourced from a
structured `about` config block. A **Request CV** button opens an in-page
terminal modal: a GDPR consent notice + Name/Email/Company(optional) fields
(block-cursor effect), CANCEL/CONSENT buttons, then the existing slide-puzzle
captcha, then a POST to a new `/api/cv-request` endpoint that forwards a
notification to `CV_WEBHOOK_URL`; finally a "request received — you'll be
reached out within 24 hours" modal with an ACKNOWLEDGE button that returns to
the index. The engine never stores or sends the CV file — the request is a
notification; the owner reaches out manually.

## Goals

- About page driven by structured config (bio + projects), projects unnamed.
- Request-CV flow: consent (GDPR) → captcha → notify → acknowledge → index.
- Reuse the existing slide-puzzle captcha, block-cursor fields, terminal styling,
  and the decoupled webhook pattern. No Python, no new heavy deps.
- CV request is a notification only (no CV storage/auto-send).

## Non-goals

- No CV file upload/storage/delivery by the engine.
- No account system or persistence of requests in the engine.
- No rich CMS for the bio — structured YAML only (projects), bio is a string.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Content source | Structured `about` config block | Structured projects (years/responsibilities/deliveries); fits config-driven engine. |
| About surface | A page at `/about` (tab) | Substantial, URL-addressable content. |
| Request CV surface | In-page modal overlay | Consent + captcha + success run without navigation (same pattern as Contact). |
| CV routing | New `/api/cv-request` → `CV_WEBHOOK_URL` | Distinct from contact messages; own downstream automation. Notification only. |
| Captcha | Reuse `/api/captcha` + slider | Already built; consistent UX. |
| Shared client logic | Extract captcha-slider + block-cursor field wiring | Avoid duplicating it across the Contact and CV modals. |
| Tab order | Blogs · Contributions · About me · Contact | About me is a page tab before the Contact overlay. |

## Architecture & flow

- **`/about` page** (`src/pages/about.astro`), gated by `about.enabled`, renders
  the bio + achievements from `getConfig().about`. The tab links to `/about`.
- **Request CV modal** (`src/components/CvRequestOverlay.astro`), included in the
  About page (or layout). State machine:

  ```
  [closed] --REQUEST CV--> [CONSENT]
  [CONSENT] --CANCEL--> [closed]
  [CONSENT] --CONSENT (valid)--> [CAPTCHA]
  [CAPTCHA] --solved--> POST /api/cv-request --> [RECEIVED]   (fail → CONSENT + error)
  [RECEIVED] --ACKNOWLEDGE--> location = "/"
  ```
  If the captcha is inactive (disabled or no images) the CAPTCHA step is skipped.
- **`/api/cv-request`** validates → requires a solved captcha token when captcha
  is active → forwards JSON to `CV_WEBHOOK_URL`, or stage-logs if unset.

## Content model (config `about`)

```yaml
about:
  enabled: true
  headline: "Greg — <one-line who-I-am>"
  bio: "Short background summary…"
  projects:
    - start: 2021
      end: 2023
      description: "Confidential project — <what it was>"
      responsibilities: "What I owned / led"
      deliveries: "What I shipped / achieved"
```

Schema (zod): `about.enabled` boolean default true; `headline` string default '';
`bio` string default ''; `projects` array (default []) of `{ start: number,
end: number, description: string, responsibilities: string default '', deliveries:
string default '' }`. Projects render newest-first (by `end` then `start`).

## About page layout

Terminal-styled, standard container:
- Header: `> ABOUT // {headline}`.
- Bio paragraph.
- `// ACHIEVEMENTS` section; each project an entry:
  ```
  [ 2021 – 2023 ]  <description>
     responsibilities: …
     deliveries: …
  ```
  Years bracketed (accent); responsibilities/deliveries as dim sub-lines.
- A `▸ REQUEST CV` button opening the modal.

## Request CV modal

1. **CONSENT panel:** notice — *"Redistribution of the CV is not permitted. Your
   details are processed solely to handle this request; under GDPR you may
   exercise your right to erasure (right to be forgotten) at any time."* Fields
   with the green block-cursor effect: **Name**, **Email**, **Company (optional)**.
   Buttons **CANCEL** (close) and **CONSENT** (validate: name non-empty, valid
   email; company optional → proceed).
2. **CAPTCHA panel:** the existing slide-puzzle (`GET`/`POST /api/captcha`). On
   solve → submit. Skipped if captcha inactive.
3. **Submit:** `POST /api/cv-request` with `{ name, email, company, consent: true,
   captchaToken }`.
4. **RECEIVED modal:** *"Request received. You'll be reached out within 24
   hours."* + **ACKNOWLEDGE** → `location.href = "/"`.

Dial-in sound on open + keystroke clicks, reusing the existing audio (mute
respected). Esc / backdrop / a close control dismiss the modal.

## Endpoint, config & shared code

- **`/api/cv-request` (SSR POST):** exports a testable `handleCvRequest(input,
  opts)` mirroring the contact handler: rate-limit → validate (name + valid email
  required; company optional; `consent` must be true) → captcha check (solved
  token required when `captchaActive()`) → forward to `CV_WEBHOOK_URL` (8s
  timeout) or stage-log. Returns `200 {ok:true}` / `400` / `429` / `502`.
  Forwarded payload: `{ name, email, company, consent, type: "cv-request", site,
  sentAt }`.
- **Config:** `about` block (above) + env `CV_WEBHOOK_URL` (secret, not in YAML).
- **Shared client helper:** extract the captcha-slider wiring and block-cursor
  field setup (currently inside `ContactOverlay`) into a small reusable client
  module/snippet used by both the Contact overlay and the CV modal, to avoid
  duplication.

## Testing

- **Unit:** `about` config defaults (enabled true, projects default []); a pure
  `validateCvRequest`/`buildCvPayload` (missing name → invalid; bad email →
  invalid; consent false → invalid; payload trims + includes `type:"cv-request"`,
  `site`, `sentAt`); `handleCvRequest` (captcha active + no token → 400; valid +
  token → forwarded; stage-mode when no webhook; honeypot if added).
- **E2E:** `/about` renders bio + projects from config; `/api/cv-request` returns
  400 without a solved token when captcha active; stage-mode 200 path; manual
  browser walk-through (consent → captcha → received → acknowledge → index).

## Files

- Create: `src/pages/about.astro`, `src/components/CvRequestOverlay.astro`,
  `src/lib/cv-request.ts` (pure validate + payload), `src/pages/api/cv-request.ts`.
- Create/extract: a shared client helper for the captcha slider + block-cursor
  fields (used by Contact + CV).
- Modify: `src/lib/config.ts` (+ test), `config.example.yaml`/`config.yaml`,
  `src/layouts/Terminal.astro` (About me tab), `src/styles/theme.css` (about page
  + any modal styles not already shared).

## Open questions / future work

- Bullet lists (arrays) for responsibilities/deliveries instead of strings — v2.
- A real CV delivery flow (link/file) — intentionally out of scope.
- Optional: a honeypot on the CV form (mirror the contact endpoint) — include if
  cheap.
