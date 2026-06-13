# Contact Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Contact tab that opens a Fallout-terminal contact form overlay (dial-in sound → form with per-field block cursor + typing sounds → typewriter preview → EDIT/APPROVE), where APPROVE POSTs JSON to an SSR endpoint that forwards it to a configurable webhook.

**Architecture:** Pure validation/payload logic in `src/lib/contact.ts` (unit-tested); an SSR endpoint `src/pages/api/contact.ts` (validate → honeypot → rate-limit → forward to `CONTACT_WEBHOOK_URL` or stage); a `ContactOverlay.astro` island in the shared layout driving the client state machine, cursors, Web Audio dial-in (`src/lib/dialup` client helper), typing sounds, and the typewriter preview.

**Tech Stack:** Astro 5 SSR (@astrojs/node), TypeScript, Vitest, zod (already a dep), Web Audio, existing `ui:blip` + `Typewriter` patterns.

---

## File Structure & Responsibilities

```
src/lib/contact.ts            # pure: validate input, detect honeypot, build forward payload
src/pages/api/contact.ts      # SSR POST endpoint: validate → honeypot → rate-limit → forward/stage
src/components/ContactOverlay.astro  # overlay markup + client script (state machine, cursors, sounds, preview, POST)
src/layouts/Terminal.astro    # add Contact tab (button) + include ContactOverlay
src/styles/theme.css          # overlay/form/field/cursor/button styles
src/lib/config.ts             # contact.enabled knob
config.example.yaml           # document contact.enabled + CONTACT_WEBHOOK_URL
test/lib/contact.test.ts      # unit tests for contact.ts
```

The overlay client script is sizable; keep the Web Audio dial-in synth as its own small function inside the island's `<script>` (no separate module needed — it's browser-only and used in one place).

---

## Task 1: Contact payload validation + build (`src/lib/contact.ts`)

**Files:**
- Create: `src/lib/contact.ts`
- Test: `test/lib/contact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateContact, buildForwardPayload } from '../../src/lib/contact';

const good = {
  name: 'Vault Dweller',
  email: 'dweller@vault111.example',
  subject: 'Reactor status',
  message: 'All systems nominal.',
  company: '',
};

describe('validateContact', () => {
  it('accepts a well-formed submission', () => {
    const r = validateContact(good);
    expect(r.ok).toBe(true);
  });

  it('flags the honeypot as spam (ok:false, spam:true)', () => {
    const r = validateContact({ ...good, company: 'bot inc' });
    expect(r.ok).toBe(false);
    expect(r.spam).toBe(true);
  });

  it('rejects blank required fields', () => {
    for (const f of ['name', 'email', 'subject', 'message'] as const) {
      const r = validateContact({ ...good, [f]: '   ' });
      expect(r.ok).toBe(false);
      expect(r.spam).toBeFalsy();
      expect(r.error).toMatch(new RegExp(f, 'i'));
    }
  });

  it('rejects a malformed email', () => {
    const r = validateContact({ ...good, email: 'not-an-email' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/email/i);
  });

  it('rejects over-length fields', () => {
    const r = validateContact({ ...good, message: 'x'.repeat(5001) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/message/i);
  });
});

describe('buildForwardPayload', () => {
  it('builds a trimmed payload with sentAt + site, excluding the honeypot', () => {
    const p = buildForwardPayload(
      { ...good, name: '  Vault Dweller  ' },
      { site: 'GregCo', now: new Date('2026-06-13T00:00:00.000Z') }
    );
    expect(p).toEqual({
      name: 'Vault Dweller',
      email: 'dweller@vault111.example',
      subject: 'Reactor status',
      message: 'All systems nominal.',
      site: 'GregCo',
      sentAt: '2026-06-13T00:00:00.000Z',
    });
    expect('company' in p).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/contact.test.ts`
Expected: FAIL — cannot find module `contact`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ContactInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  company?: string; // honeypot — must be empty for real humans
}

export interface ForwardPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  site: string;
  sentAt: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; spam?: boolean; error?: string };

const LIMITS = { name: 200, email: 320, subject: 200, message: 5000 } as const;
// Pragmatic email shape check (not full RFC): something@something.tld
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(input: ContactInput): ValidationResult {
  if ((input.company ?? '').trim() !== '') return { ok: false, spam: true };

  const fields = ['name', 'email', 'subject', 'message'] as const;
  for (const f of fields) {
    const v = (input[f] ?? '').trim();
    if (v === '') return { ok: false, error: `${f} is required` };
    if (v.length > LIMITS[f]) return { ok: false, error: `${f} is too long` };
  }
  if (!EMAIL_RE.test(input.email.trim())) {
    return { ok: false, error: 'email is invalid' };
  }
  return { ok: true };
}

export function buildForwardPayload(
  input: ContactInput,
  opts: { site: string; now: Date }
): ForwardPayload {
  return {
    name: input.name.trim(),
    email: input.email.trim(),
    subject: input.subject.trim(),
    message: input.message.trim(),
    site: opts.site,
    sentAt: opts.now.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/contact.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contact.ts test/lib/contact.test.ts
git commit -m "feat: contact payload validation + forward-payload builder"
```

---

## Task 2: Config — `contact.enabled` knob

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `test/lib/config.test.ts`
- Modify: `config.example.yaml`, `config.yaml`

- [ ] **Step 1: Add the assertion to the existing config test**

In `test/lib/config.test.ts`, inside the first test ("loads a full config and applies defaults"), add after the `cfg.github.username` assertion:

```ts
    expect(cfg.contact.enabled).toBe(true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — `cfg.contact` is undefined.

- [ ] **Step 3: Add the `contact` block to the schema**

In `src/lib/config.ts`, add this property to the top-level `z.object({...})` (e.g. right after the `github` block):

```ts
  contact: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the knobs in the config files**

Append to `config.example.yaml` (after the `github:` block):

```yaml
contact:
  enabled: true                     # show the Contact tab + form
  # Where APPROVE sends the JSON payload — set as the CONTACT_WEBHOOK_URL env
  # var (it often embeds a secret token, so it is NOT stored here). If unset,
  # submissions are logged server-side (stage mode) and still report success.
```

Append the same `contact:` block (without the long comment) to `config.yaml`:

```yaml
contact:
  enabled: true
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml config.yaml
git commit -m "feat: contact.enabled config knob"
```

Note: `config.yaml` is gitignored; the `git add` will simply skip it — that's expected.

---

## Task 3: SSR endpoint (`src/pages/api/contact.ts`)

**Files:**
- Create: `src/pages/api/contact.ts`
- Test: `test/lib/contact-endpoint.test.ts`

The endpoint module exports a small testable `handleContact(body, ctx)` plus the Astro `POST` wrapper. We test `handleContact` directly with a mocked fetch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleContact, __resetRateLimit } from '../../src/pages/api/contact';

const good = {
  name: 'Vault Dweller',
  email: 'dweller@vault111.example',
  subject: 'Hi',
  message: 'Hello there.',
  company: '',
};
const ctx = { site: 'GregCo', now: new Date('2026-06-13T00:00:00.000Z'), ip: '1.2.3.4' };

beforeEach(() => __resetRateLimit());

describe('handleContact', () => {
  it('stage mode (no webhook): returns 200 and does not fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact(good, { ...ctx, webhookUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the payload to the webhook when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleContact(good, {
      ...ctx,
      webhookUrl: 'https://hooks.example/abc',
      fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example/abc');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ name: 'Vault Dweller', site: 'GregCo', sentAt: ctx.now.toISOString() });
    expect('company' in sent).toBe(false);
  });

  it('honeypot returns 200 success but does NOT forward', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, company: 'bot' }, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalid input returns 400 and does not forward', async () => {
    const fetchMock = vi.fn();
    const res = await handleContact({ ...good, email: 'nope' }, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate-limits after 5 requests from the same ip (429)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const opts = { ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock };
    for (let i = 0; i < 5; i++) expect((await handleContact(good, opts)).status).toBe(200);
    expect((await handleContact(good, opts)).status).toBe(429);
  });

  it('returns 502 when the webhook fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await handleContact(good, {
      ...ctx, webhookUrl: 'https://hooks.example/abc', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/contact-endpoint.test.ts`
Expected: FAIL — cannot find module `contact`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { validateContact, buildForwardPayload, type ContactInput } from '../../lib/contact';

interface HandleResult { status: number; body: { ok: boolean; error?: string } }

interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export function __resetRateLimit(): void {
  hits.clear();
}

/** Pure-ish handler: validate → honeypot → rate-limit → forward/stage. */
export async function handleContact(
  input: ContactInput,
  opts: HandleOpts
): Promise<HandleResult> {
  if (rateLimited(opts.ip, opts.now.getTime())) {
    return { status: 429, body: { ok: false, error: 'rate limited' } };
  }

  const result = validateContact(input);
  if (!result.ok) {
    // Honeypot: pretend success, drop silently.
    if (result.spam) return { status: 200, body: { ok: true } };
    return { status: 400, body: { ok: false, error: result.error } };
  }

  const payload = buildForwardPayload(input, { site: opts.site, now: opts.now });

  if (!opts.webhookUrl) {
    console.log('[contact] stage mode (no webhook):', JSON.stringify(payload));
    return { status: 200, body: { ok: true } };
  }

  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(opts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: 502, body: { ok: false, error: 'forwarding failed' } };
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { ok: false, error: 'forwarding failed' } };
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let input: ContactInput;
  try {
    input = (await request.json()) as ContactInput;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'bad request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let ip = 'unknown';
  try {
    ip = clientAddress || 'unknown';
  } catch {
    ip = 'unknown';
  }

  const result = await handleContact(input, {
    site: getConfig().site.title,
    now: new Date(),
    ip,
    webhookUrl: process.env.CONTACT_WEBHOOK_URL,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/contact-endpoint.test.ts`
Expected: PASS (6 cases). Note: `AbortSignal.timeout` exists on Node 18+/22+/26 (our runtime) — fine.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/contact.ts test/lib/contact-endpoint.test.ts
git commit -m "feat: /api/contact endpoint (validate, honeypot, rate-limit, forward/stage)"
```

---

## Task 4: ContactOverlay island — markup + styles (no behavior yet)

**Files:**
- Create: `src/components/ContactOverlay.astro`
- Modify: `src/styles/theme.css`

This task creates the static markup + styling. Behavior (state machine, cursors, sounds) comes in Task 5. The overlay starts hidden.

- [ ] **Step 1: Create `src/components/ContactOverlay.astro`**

```astro
---
// Contact form as an in-page terminal overlay. Hidden until opened by the
// Contact tab. Behavior is wired in the client script (added next task).
---
<div id="contact-overlay" class="contact-overlay" hidden aria-hidden="true">
  <div class="contact-window" role="dialog" aria-modal="true" aria-label="Contact">
    <button id="contact-close" class="contact-close" type="button" aria-label="Close">[ X ]</button>

    <form id="contact-form" class="contact-form" novalidate>
      <p class="contact-boot" id="contact-boot">&gt; ESTABLISHING UPLINK...</p>

      <!-- honeypot: hidden from humans -->
      <div class="hp" aria-hidden="true">
        <label>Company<input type="text" name="company" id="cf-company" tabindex="-1" autocomplete="off" /></label>
      </div>

      <label class="field">
        <span class="field-title">SENDER NAME</span>
        <span class="field-box" data-field="name">
          <span class="field-text" id="cf-name-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cf-name" type="text" autocomplete="off" spellcheck="false" maxlength="200" />
        </span>
      </label>

      <label class="field">
        <span class="field-title">SENDER EMAIL</span>
        <span class="field-box" data-field="email">
          <span class="field-text" id="cf-email-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cf-email" type="text" inputmode="email" autocomplete="off" spellcheck="false" maxlength="320" />
        </span>
      </label>

      <label class="field">
        <span class="field-title">SUBJECT</span>
        <span class="field-box" data-field="subject">
          <span class="field-text" id="cf-subject-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cf-subject" type="text" autocomplete="off" spellcheck="false" maxlength="200" />
        </span>
      </label>

      <label class="field field-message">
        <span class="field-title">MESSAGE</span>
        <span class="field-box field-box-area" data-field="message">
          <span class="field-text field-text-area" id="cf-message-text"></span><span class="cursor field-cursor"> </span>
          <textarea class="field-input field-input-area" id="cf-message" autocomplete="off" spellcheck="false" maxlength="5000"></textarea>
        </span>
      </label>

      <p class="contact-error" id="contact-error" hidden></p>
      <button class="contact-send" id="contact-send" type="submit">SEND</button>
    </form>

    <div class="contact-preview" id="contact-preview" hidden>
      <p class="contact-boot">&gt; TRANSMISSION PREVIEW</p>
      <pre class="preview-body" id="preview-body"></pre>
      <div class="preview-actions">
        <button class="contact-btn" id="contact-edit" type="button">EDIT</button>
        <button class="contact-btn contact-approve" id="contact-approve" type="button">APPROVE</button>
      </div>
      <p class="contact-status" id="contact-status" hidden></p>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add styles to `src/styles/theme.css`**

Append:

```css
/* Contact overlay */
.contact-overlay {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 4vh 1rem; overflow-y: auto;
  background: rgba(11, 15, 11, 0.92);
}
.contact-window {
  position: relative; width: 100%; max-width: 720px;
  border: 1px solid var(--fg-dim); padding: 1.5rem 1.5rem 1.75rem;
  background: var(--bg);
}
.contact-close {
  position: absolute; top: 0.5rem; right: 0.5rem;
  background: transparent; color: var(--fg); border: 0; font: inherit; cursor: pointer;
}
.contact-boot { color: var(--accent); margin: 0 0 1rem; }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

.field { display: block; margin: 0 0 1rem; }
.field-title { display: block; color: var(--accent); letter-spacing: 0.1em; margin-bottom: 0.2rem; }
.field-box {
  position: relative; display: flex; align-items: center;
  border: 1px solid var(--fg-dim); padding: 0.35rem 0.5rem; min-height: 2rem;
}
.field-box-area { align-items: stretch; min-height: 12rem; }
.field-text { white-space: pre; }
.field-text-area { white-space: pre-wrap; word-break: break-word; flex: 1; }
.field-input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; padding: 0.35rem 0.5rem; border: 0; resize: none;
  background: transparent; color: transparent; caret-color: transparent;
  font: inherit; outline: none;
}
.field-input-area { white-space: pre-wrap; }
/* cursor hidden unless its field is focused (toggled by the .is-focused class) */
.field-cursor { visibility: hidden; }
.field-box.is-focused .field-cursor { visibility: visible; }

.contact-error { color: var(--accent); margin: 0.25rem 0 0.75rem; }
.contact-send, .contact-btn {
  display: block; width: 100%; padding: 0.4rem; margin-top: 0.5rem;
  background: transparent; color: var(--fg); border: 1px solid var(--fg-dim);
  font: inherit; letter-spacing: 0.1em; cursor: pointer; text-transform: uppercase;
}
.contact-send:hover, .contact-btn:hover { background: rgba(51, 255, 102, 0.12); }
.preview-body { white-space: pre-wrap; word-break: break-word; border: 1px solid var(--fg-dim); padding: 1rem; margin: 0 0 1rem; }
.preview-actions { display: flex; gap: 0.75rem; }
.preview-actions .contact-btn { margin-top: 0; }
.contact-approve { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.contact-status { color: var(--accent); margin-top: 0.75rem; }
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: build succeeds. NOTE: an un-imported `.astro` component is NOT compiled by `astro build`, so this only confirms the CSS additions didn't break the build. `ContactOverlay` is actually type-checked/compiled once it's imported in Task 6 — that is where any `.astro` errors will surface.

- [ ] **Step 4: Commit**

```bash
git add src/components/ContactOverlay.astro src/styles/theme.css
git commit -m "feat: contact overlay markup + terminal styles"
```

---

## Task 5: ContactOverlay behavior — client script

**Files:**
- Modify: `src/components/ContactOverlay.astro` (add a `<script>` block)

Add the client script that drives everything: open/close, dial-in sound, per-field block cursor, typing sounds, SEND→preview (typewriter), EDIT, APPROVE→POST. Append this `<script>` to the bottom of `ContactOverlay.astro` (after the closing `</div>` of `#contact-overlay`).

- [ ] **Step 1: Add the client `<script>`**

```astro
<script>
  const overlay = document.getElementById('contact-overlay') as HTMLElement | null;
  if (overlay) {
    const form = document.getElementById('contact-form') as HTMLFormElement;
    const preview = document.getElementById('contact-preview') as HTMLElement;
    const previewBody = document.getElementById('preview-body') as HTMLElement;
    const errorEl = document.getElementById('contact-error') as HTMLElement;
    const statusEl = document.getElementById('contact-status') as HTMLElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const muted = () => localStorage.getItem('blog-sound-muted') === '1';

    interface F { input: HTMLInputElement | HTMLTextAreaElement; text: HTMLElement; box: HTMLElement; }
    const fields: F[] = ['name', 'email', 'subject', 'message'].map((id) => ({
      input: document.getElementById('cf-' + id) as HTMLInputElement,
      text: document.getElementById('cf-' + id + '-text') as HTMLElement,
      box: (document.getElementById('cf-' + id) as HTMLElement).closest('.field-box') as HTMLElement,
    }));

    // --- block cursor: mirror text + show cursor only on the focused field ---
    function sync(f: F) { f.text.textContent = f.input.value; }
    for (const f of fields) {
      f.input.addEventListener('input', () => sync(f));
      f.input.addEventListener('focus', () => f.box.classList.add('is-focused'));
      f.input.addEventListener('blur', () => f.box.classList.remove('is-focused'));
      f.input.addEventListener('keydown', (e) => {
        if (!muted() && (e.key.length === 1 || e.key === 'Backspace')) {
          document.dispatchEvent(new Event('ui:blip'));
        }
      });
    }

    // --- Web Audio dial-in synth (DTMF burst + handshake screech) ---
    function dialIn() {
      if (muted() || reduce) return;
      let ctx: AudioContext;
      try { ctx = new AudioContext(); } catch { return; }
      const t0 = ctx.currentTime;
      const beep = (freqs: number[], start: number, dur: number) => {
        for (const fr of freqs) {
          const osc = ctx.createOscillator(); const g = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = fr;
          g.gain.setValueAtTime(0.0001, t0 + start);
          g.gain.exponentialRampToValueAtTime(0.08, t0 + start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          osc.connect(g).connect(ctx.destination);
          osc.start(t0 + start); osc.stop(t0 + start + dur + 0.02);
        }
      };
      // four DTMF-ish dial tones
      const tones = [[697, 1209], [770, 1336], [852, 1477], [941, 1209]];
      tones.forEach((pair, i) => beep(pair, i * 0.18, 0.12));
      // handshake screech: short noise burst + warble
      const screechStart = 0.9;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.9, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
      const noise = ctx.createBufferSource(); noise.buffer = buffer;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0 + screechStart);
      ng.gain.exponentialRampToValueAtTime(0.05, t0 + screechStart + 0.05);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + screechStart + 0.85);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
      noise.connect(bp).connect(ng).connect(ctx.destination);
      noise.start(t0 + screechStart); noise.stop(t0 + screechStart + 0.9);
      const warble = ctx.createOscillator(); const wg = ctx.createGain();
      warble.type = 'square'; warble.frequency.setValueAtTime(1100, t0 + screechStart);
      warble.frequency.linearRampToValueAtTime(2400, t0 + screechStart + 0.85);
      wg.gain.setValueAtTime(0.02, t0 + screechStart);
      wg.gain.exponentialRampToValueAtTime(0.0001, t0 + screechStart + 0.85);
      warble.connect(wg).connect(ctx.destination);
      warble.start(t0 + screechStart); warble.stop(t0 + screechStart + 0.9);
      setTimeout(() => ctx.close().catch(() => {}), 2200);
    }

    // --- open / close ---
    function open() {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      showForm();
      dialIn();
      fields.forEach(sync);
      fields[0].input.focus();
    }
    function close() {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      document.querySelector('.tabs .tab.contact-tab')?.classList.remove('is-active');
    }
    function showForm() {
      preview.hidden = true; form.hidden = false;
      errorEl.hidden = true; statusEl.hidden = true;
    }

    document.getElementById('contact-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

    // exposed for the Contact tab (added in the layout)
    (window as any).openContact = open;

    // --- validation (mirror of server) ---
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function readInput() {
      return {
        name: fields[0].input.value.trim(),
        email: fields[1].input.value.trim(),
        subject: fields[2].input.value.trim(),
        message: fields[3].input.value.trim(),
        company: (document.getElementById('cf-company') as HTMLInputElement).value,
      };
    }
    function clientError(v: ReturnType<typeof readInput>): string | null {
      if (!v.name) return 'sender name is required';
      if (!v.email || !EMAIL_RE.test(v.email)) return 'a valid sender email is required';
      if (!v.subject) return 'subject is required';
      if (!v.message) return 'message is required';
      return null;
    }

    // --- SEND -> preview with typewriter reveal ---
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = readInput();
      const err = clientError(v);
      if (err) { errorEl.textContent = '> ' + err; errorEl.hidden = false; return; }
      const composed =
        `FROM: ${v.name} <${v.email}>\n` +
        `SUBJ: ${v.subject}\n` +
        `──────────────\n` +
        `${v.message}`;
      form.hidden = true; preview.hidden = false; statusEl.hidden = true;
      typewrite(previewBody, composed);
    });

    function typewrite(el: HTMLElement, text: string) {
      if (reduce) { el.textContent = text; return; }
      el.textContent = '';
      let i = 0;
      const timer = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(timer);
      }, 8);
    }

    document.getElementById('contact-edit')?.addEventListener('click', showForm);

    // --- APPROVE -> POST /api/contact ---
    document.getElementById('contact-approve')?.addEventListener('click', async () => {
      const v = readInput();
      statusEl.hidden = false; statusEl.textContent = '> TRANSMITTING...';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(v),
        });
        if (res.ok) {
          statusEl.textContent = '> TRANSMISSION SENT';
          (document.getElementById('contact-approve') as HTMLButtonElement).disabled = true;
        } else {
          const data = await res.json().catch(() => ({}));
          statusEl.textContent = '> TRANSMISSION FAILED: ' + (data.error || res.status);
        }
      } catch {
        statusEl.textContent = '> TRANSMISSION FAILED: network error';
      }
    });
  }
</script>
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build`
Expected: build succeeds. NOTE: `ContactOverlay` is still not imported, so `astro build` does not yet compile its `<script>`. The script is genuinely compiled/type-checked when the component is imported in Task 6 — expect to fix any `.astro`/TS issues there (e.g. `(window as any)` casts are fine). This step only confirms nothing else broke.

- [ ] **Step 3: Commit**

```bash
git add src/components/ContactOverlay.astro
git commit -m "feat: contact overlay behavior (dial-in, cursors, typing, preview, approve)"
```

---

## Task 6: Wire the Contact tab + include the overlay (`src/layouts/Terminal.astro`)

**Files:**
- Modify: `src/layouts/Terminal.astro`

- [ ] **Step 1: Import and include the overlay**

Add to the imports at the top of the frontmatter (with the other component imports):

```ts
import ContactOverlay from '../components/ContactOverlay.astro';
```

Add the overlay just before the closing `</body>` (after the trailing `<script>` blocks, before `</body>`):

```astro
    {cfg.contact.enabled && <ContactOverlay />}
```

- [ ] **Step 2: Add the Contact tab as a button (not a navigating link)**

The existing tabs render as `<a>` links. Add Contact as a tab-styled button that opens the overlay. Replace the `<nav class="tabs">` block in the markup with:

```astro
        <nav class="tabs" aria-label="Primary">
          {tabs.map((t) => (
            <a class:list={['tab', { 'is-active': isActive(t.href) }]} href={t.href}>{t.label}</a>
          ))}
          {cfg.contact.enabled && (
            <button type="button" class="tab contact-tab" id="contact-tab">Contact</button>
          )}
        </nav>
```

- [ ] **Step 3: Wire the Contact tab click in the existing tab script**

In the existing tab `<script>` (the one that snaps `is-active` on click), append after the `tabEls.forEach(...)` block:

```ts
      const contactTab = document.getElementById('contact-tab');
      contactTab?.addEventListener('click', () => {
        tabEls.forEach((t) => t.classList.remove('is-active'));
        contactTab.classList.add('is-active');
        (window as any).openContact?.();
      });
```

- [ ] **Step 4: Build and verify it compiles + the overlay/endpoint are present**

Run: `npm run build`
Expected: build succeeds and produces `dist/server/entry.mjs`.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Terminal.astro
git commit -m "feat: add Contact tab that opens the contact overlay"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (contact + contact-endpoint + config + existing).

- [ ] **Step 2: Build and start the server (stage mode — no webhook)**

```bash
npm run build
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
```

- [ ] **Step 2b: Verify the Contact tab and endpoint exist**

```bash
curl -s http://127.0.0.1:4321/ | grep -oE 'id="contact-tab"|id="contact-overlay"'
# stage-mode submit (no webhook configured) -> {"ok":true}
curl -s -X POST http://127.0.0.1:4321/api/contact \
  -H 'content-type: application/json' \
  -d '{"name":"Greg","email":"g@example.com","subject":"Hi","message":"Hello","company":""}' \
  -w "\nstatus=%{http_code}\n"
# honeypot -> still 200 ok:true (silently dropped)
curl -s -X POST http://127.0.0.1:4321/api/contact -H 'content-type: application/json' \
  -d '{"name":"Bot","email":"b@example.com","subject":"x","message":"y","company":"spam"}' -w "\nstatus=%{http_code}\n"
# invalid email -> 400
curl -s -X POST http://127.0.0.1:4321/api/contact -H 'content-type: application/json' \
  -d '{"name":"Greg","email":"nope","subject":"x","message":"y","company":""}' -w "\nstatus=%{http_code}\n"
```

Expected: grep shows both ids; first POST `status=200 {"ok":true}`; honeypot `status=200`; invalid `status=400`.

- [ ] **Step 3: Manual browser check (http://localhost:4321)**

- Click the **Contact** tab → dial-in sound plays → overlay form appears, focus on Sender Name with a blinking block cursor.
- Tab between fields → the block cursor follows focus; typing plays the click sound.
- Click **SEND** with a blank/invalid field → inline error; with valid fields → typewriter preview of the transmission, with EDIT/APPROVE.
- **EDIT** → returns to the form with values intact. **APPROVE** → `> TRANSMISSION SENT` (stage mode).
- **Esc** or the backdrop or **[ X ]** closes the overlay.

- [ ] **Step 4: (Optional) verify real forwarding with a test webhook**

```bash
# point at a request bin / webhook.site URL
CONTACT_WEBHOOK_URL='https://webhook.site/your-id' CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content node ./dist/server/entry.mjs
# submit via the UI or curl; confirm the JSON payload arrives at the bin
```

- [ ] **Step 5: Stop the server and commit any fixes**

```bash
pkill -f "dist/server/entry.mjs"
git add -A && git commit -m "fix: address issues found during contact form verification"
```

(Skip the commit if nothing changed.)

---

## Notes for the implementer

- **Block cursor mechanics:** each field is a `.field-box` containing a mirror `.field-text` (shows the typed value), a `.field-cursor` (blinking block, reusing the global `.cursor` style), and a transparent-caret `.field-input` overlaid on top to capture input. `.field-box.is-focused .field-cursor` makes the cursor visible only on the focused field. The cursor sits after the mirrored text (end-of-text), which is correct for normal typing.
- **Textarea cursor:** the message uses the same pattern with `white-space: pre-wrap`; the cursor trails the wrapped text. Arbitrary caret repositioning (clicking mid-text) is not tracked — acceptable per spec.
- **Sounds obey mute:** dial-in checks `localStorage 'blog-sound-muted'`; typing dispatches `ui:blip` which `ClickSound` already gates on mute.
- **Autoplay:** `open()` runs synchronously inside the Contact tab's click handler, so the `AudioContext` is created during a user gesture and the dial-in plays.
- **`openContact` global:** the overlay script exposes `window.openContact`; the tab script calls it. The overlay is included once (in the layout), so this is safe.
- **Endpoint testability:** `handleContact(input, opts)` is the unit under test; the Astro `POST` is a thin wrapper that injects `getConfig().site.title`, `new Date()`, `clientAddress`, and `process.env.CONTACT_WEBHOOK_URL`.
- Do not add a mail transport dependency — delivery is the webhook's responsibility.
