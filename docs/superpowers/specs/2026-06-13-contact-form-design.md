# Contact Form (Contact Tab) — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Summary

A new **Contact** tab (right of Contributions) that opens a Fallout-terminal
contact form as an **in-page modal overlay**. Clicking the tab plays a
synthesized dial-in sound, then the form animates in. The form has four fields
— Sender Name, Sender Email, Subject (one-line) and Message (textarea) — with a
blinking green block cursor in the focused field and keystroke click sounds.
SEND reveals a typewriter "transmission preview" with EDIT / APPROVE; APPROVE
POSTs a JSON payload to our SSR endpoint, which forwards it to a configurable
webhook (for Zapier or a separate mailer container).

## Goals

- Contact tab works from any page (overlay lives in the shared layout).
- Dial-in sound plays on the tab click (a real user gesture, so audio isn't
  blocked by autoplay policy).
- Per-field block cursor that moves to whichever field is focused; default focus
  is Sender Name.
- Typing plays the existing `ui:blip` sound; both sounds obey the existing mute
  toggle.
- SEND → typewriter preview (reusing the existing reveal) → EDIT / APPROVE.
- APPROVE sends a decoupled JSON payload to a webhook; delivery is handled
  downstream (Zapier / another container). No mail transport in this engine.

## Non-goals

- No SMTP / email transport in the engine itself (decoupled via webhook).
- No persistence/inbox of submitted messages in the engine.
- No `/contact` page or shareable URL (Contact is an overlay, by decision).
- No rich-text message body; plain text only.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Send mechanism | JSON POST → our `/api/contact` → forward to webhook | Decoupled; user wires Zapier / own mailer later. Server-side forward hides the webhook URL, avoids CORS, allows validation/spam guards. |
| Open mode | In-page modal overlay (no navigation) | The tab click is a user gesture, so the dial-in sound can play immediately; full-page nav would block autoplay on the new page. |
| Webhook URL | `CONTACT_WEBHOOK_URL` env var | Often embeds a secret token; kept server-side, never in YAML or the browser. |
| No webhook set | Stage mode (log payload, return success) | The full UX works before a webhook is configured. |
| Dial-in sound | Synthesized via Web Audio | No asset; consistent with existing Web Audio; obeys mute toggle. |
| Field cursor | Block cursor at end-of-text in the focused field only | Mirrors the search-box trick; end-of-text is correct for normal typing and far simpler than tracking arbitrary caret positions. |
| Spam | Honeypot field + server validation + light per-IP rate limit | Public form; minimal but real protection. |

## Architecture & flow

`ContactOverlay` is an island included once in the `Terminal` layout, so the
Contact tab works on every page. The Contact tab is a tab-styled button (not a
link); clicking it opens the overlay and marks the tab active while open.

State machine (client):

```
[closed] --click Contact--> play dial-in --> [FORM]
[FORM]    --SEND (valid)--> [PREVIEW]   (typewriter reveal of composed transmission)
[PREVIEW] --EDIT---------->  [FORM]      (field values preserved)
[PREVIEW] --APPROVE------->  POST /api/contact --> [SENT]   (or back to [FORM] + error)
[any]     --Esc / close--->  [closed]
```

Send path: `APPROVE` → browser `POST`s JSON to `/api/contact` → server validates
+ forwards to the webhook. Payload:

```json
{
  "name": "...",
  "email": "...",
  "subject": "...",
  "message": "...",
  "sentAt": "2026-06-13T00:00:00.000Z",
  "site": "GregCo Industries Unified Operating System"
}
```

(The honeypot `company` field is validated but never included in the forwarded
payload.)

## Overlay UX & mechanics

- **Layout** (per the sketch): four labeled fields stacked — `Sender Name`,
  `Sender Email`, `Subject` (one-line inputs), `Message` (textarea) — then a
  full-width `SEND` button. Terminal/CRT styling (green-on-black, scanlines).
- **Dial-in sound:** Web Audio synth — a short DTMF-style dialing burst followed
  by a brief modem-handshake screech (~2s). Skipped when sound is muted.
- **Block cursor:** each field hides its native caret (`caret-color: transparent`)
  and renders a blinking green block cursor at the end of its current text via a
  mirror element; only the focused field shows its cursor. Default focus is
  Sender Name. Focus moves the cursor with it.
- **Typing sound:** keystrokes in any field dispatch the existing `ui:blip`
  event (so typing also obeys the mute toggle).
- **Preview:** SEND composes a transmission and reveals it with the existing
  `Typewriter` island:
  ```
  FROM: {name} <{email}>
  SUBJ: {subject}
  ──────────────
  {message}
  ```
  then shows `EDIT` and `APPROVE`. APPROVE success → `> TRANSMISSION SENT`.

## Backend endpoint, validation & config

`/api/contact` (SSR POST endpoint):

- Accepts JSON `{ name, email, subject, message, company }` (`company` = honeypot).
- **Validation (authoritative):** name/email/subject/message all non-empty;
  email matches a basic pattern; length caps (name/subject ≤ 200, email ≤ 320,
  message ≤ 5000). On failure → `400` with a short reason.
- **Spam guards:** honeypot `company` non-empty → silently return success without
  forwarding; lightweight in-memory per-IP rate limit (5/min).
- **Forward:** if `CONTACT_WEBHOOK_URL` set, `POST` the payload there with a
  short timeout and relay success/failure; if unset, **stage mode** (log payload,
  return success).
- **Client validation** mirrors the server (required + email shape) for instant
  feedback; the server re-checks.

Config / secrets:

- `CONTACT_WEBHOOK_URL` — env var, never in YAML.
- `config.yaml`: `contact: { enabled: true }` (shows/hides the tab). Delivery is
  the webhook's responsibility; no recipient config needed.

## Files

- Create `src/lib/contact.ts` — pure: validate input + build forward payload
  (unit-tested).
- Create `src/pages/api/contact.ts` — SSR endpoint (validation, honeypot,
  rate-limit, forward/stage).
- Create `src/components/ContactOverlay.astro` — overlay markup + client script
  (state machine, per-field cursors, dial-in + typing sounds, typewriter preview,
  POST on APPROVE).
- Create `src/lib/dialup.ts` — Web Audio dial-in synth (imported by the island's
  client script), or inline in the island if cleaner.
- Modify `src/layouts/Terminal.astro` — add the Contact tab (button) + include
  `ContactOverlay`.
- Modify `src/styles/theme.css` — overlay, form, field, cursor, button styles.
- Modify `src/lib/config.ts` + `config.example.yaml` — `contact.enabled` knob.

## Testing

- **Unit (Vitest, `contact.ts`):** valid payload passes; missing/blank fields
  rejected; bad email rejected; over-length rejected; honeypot-filled flagged;
  forward-payload shape correct (includes `sentAt`, excludes `company`).
- **Endpoint:** validation + honeypot + stage-mode (no webhook → success) via the
  handler with a mocked `fetch`; configured webhook is invoked with the right body.
- **Client (overlay state machine, cursors, sounds, typewriter):** manual/visual
  verification, consistent with the other islands.

## Open questions / future work

- Real webhook delivery (Zapier or a mailer container) is configured by setting
  `CONTACT_WEBHOOK_URL`; building that downstream service is out of scope.
- Optional future: success/failure toast styling, attachments, i18n.
