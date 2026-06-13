# About Me + Request CV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an About me page (`/about`, config-driven bio + unnamed projects) with a Request-CV modal: GDPR consent → slide-puzzle captcha → POST to a new `/api/cv-request` (forwarded to `CV_WEBHOOK_URL`, notification only) → "received, reached out in 24h" → back to index.

**Architecture:** Pure `cv-request.ts` (validate + payload, unit-tested); `/api/cv-request` SSR endpoint mirroring the contact endpoint (rate-limit → validate → captcha → forward/stage); a config `about` block; an `about.astro` page; a self-contained `CvRequestOverlay.astro` island reusing the existing global CSS classes and the `/api/captcha` endpoint (own `cv-`-prefixed ids to avoid clashing with the layout's ContactOverlay).

**Tech Stack:** Astro 5 SSR (@astrojs/node), TypeScript, Vitest, existing captcha (`/api/captcha`, `captcha-store`), existing terminal/field/puzzle CSS.

---

## File Structure & Responsibilities

```
src/lib/cv-request.ts         # pure: validateCvRequest + buildCvPayload (unit-tested)
src/pages/api/cv-request.ts   # SSR POST: rate-limit → validate → captcha → forward/stage
src/lib/config.ts             # add `about` block (+ test)
src/pages/about.astro         # /about page: bio + achievements + Request CV button
src/components/CvRequestOverlay.astro  # consent → captcha → received modal (self-contained island)
src/layouts/Terminal.astro    # About me tab
src/styles/theme.css          # about-page styles (modal reuses existing classes)
config.example.yaml/config.yaml  # document `about`
test/lib/cv-request.test.ts
test/lib/cv-request-endpoint.test.ts
test/lib/config.test.ts       # about defaults
```

**Design note (island isolation):** `CvRequestOverlay` reuses the existing global CSS classes (`.contact-overlay`, `.field-box`, `.field-cursor`, `.puzzle`, `.puzzle-handle`, etc.) and the `/api/captcha` endpoint, but uses **`cv-`-prefixed element ids** (the layout's `ContactOverlay` renders on every page, including `/about`, so ids must not collide). Its client script intentionally mirrors `ContactOverlay`'s proven field-cursor + dial-in + captcha-slider logic rather than refactoring the working Contact overlay — Astro islands are self-contained bundles, so this keeps Contact stable. A future cleanup could extract shared helpers.

---

## Task 1: CV request validation + payload (`src/lib/cv-request.ts`)

**Files:**
- Create: `src/lib/cv-request.ts`
- Test: `test/lib/cv-request.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateCvRequest, buildCvPayload } from '../../src/lib/cv-request';

const good = { name: 'Recruiter', email: 'r@acme.example', company: 'Acme', consent: true };

describe('validateCvRequest', () => {
  it('accepts a valid consented request', () => {
    expect(validateCvRequest(good).ok).toBe(true);
  });
  it('requires consent === true', () => {
    const r = validateCvRequest({ ...good, consent: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/consent/i);
  });
  it('requires a name', () => {
    const r = validateCvRequest({ ...good, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });
  it('requires a valid email', () => {
    const r = validateCvRequest({ ...good, email: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });
  it('allows an empty company (optional)', () => {
    expect(validateCvRequest({ ...good, company: '' }).ok).toBe(true);
  });
});

describe('buildCvPayload', () => {
  it('builds a trimmed cv-request payload with type/site/sentAt', () => {
    const p = buildCvPayload(
      { name: '  Recruiter ', email: ' r@acme.example ', company: '  Acme ', consent: true },
      { site: 'GregCo', now: new Date('2026-06-13T00:00:00.000Z') }
    );
    expect(p).toEqual({
      name: 'Recruiter',
      email: 'r@acme.example',
      company: 'Acme',
      consent: true,
      type: 'cv-request',
      site: 'GregCo',
      sentAt: '2026-06-13T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/cv-request.test.ts`
Expected: FAIL — cannot find module `cv-request`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface CvInput {
  name: string;
  email: string;
  company?: string;
  consent?: boolean;
}

export interface CvPayload {
  name: string;
  email: string;
  company: string;
  consent: boolean;
  type: 'cv-request';
  site: string;
  sentAt: string;
}

export type CvValidation = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCvRequest(input: CvInput): CvValidation {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  const email = (input.email ?? '').trim();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'a valid email is required' };
  if (input.consent !== true) return { ok: false, error: 'consent is required' };
  if (name.length > 200 || email.length > 320 || (input.company ?? '').length > 200) {
    return { ok: false, error: 'field too long' };
  }
  return { ok: true };
}

export function buildCvPayload(input: CvInput, opts: { site: string; now: Date }): CvPayload {
  return {
    name: input.name.trim(),
    email: input.email.trim(),
    company: (input.company ?? '').trim(),
    consent: true,
    type: 'cv-request',
    site: opts.site,
    sentAt: opts.now.toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/cv-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cv-request.ts test/lib/cv-request.test.ts
git commit -m "feat: CV request validation + forward-payload builder"
```

---

## Task 2: `about` config block

**Files:**
- Modify: `src/lib/config.ts`, `test/lib/config.test.ts`, `config.example.yaml`, `config.yaml`

- [ ] **Step 1: Add assertions to the config test**

In `test/lib/config.test.ts`, after the existing `cfg.social.medium` assertion in the "loads a full config and applies defaults" test, add:

```ts
    expect(cfg.about.enabled).toBe(true);
    expect(cfg.about.headline).toBe('');
    expect(cfg.about.bio).toBe('');
    expect(cfg.about.projects).toEqual([]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — `cfg.about` is undefined.

- [ ] **Step 3: Add the `about` block to the schema**

In `src/lib/config.ts`, add this property to the top-level `z.object({...})` (after the `social` block):

```ts
  about: z
    .object({
      enabled: z.boolean().default(true),
      headline: z.string().default(''),
      bio: z.string().default(''),
      projects: z
        .array(
          z.object({
            start: z.number().int(),
            end: z.number().int(),
            description: z.string(),
            responsibilities: z.string().default(''),
            deliveries: z.string().default(''),
          })
        )
        .default([]),
    })
    .default({}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document + populate the config files**

Append to `config.example.yaml` (after the `social:` block):

```yaml
about:
  enabled: true
  headline: "Greg — software engineer"
  bio: "Short background summary — who I am, what I work on."
  projects:
    - start: 2021
      end: 2023
      description: "Confidential project — what it was (no client name)."
      responsibilities: "What I owned / led."
      deliveries: "What I shipped / achieved."
  # CV requests are sent to the CV_WEBHOOK_URL env var (not stored here);
  # stage-mode logs the request when unset.
```

Append the same block (without the trailing comment) to `config.yaml` so the running server has content:

```yaml
about:
  enabled: true
  headline: "Greg — software engineer"
  bio: "Short background summary — who I am, what I work on."
  projects:
    - start: 2021
      end: 2023
      description: "Confidential project — what it was (no client name)."
      responsibilities: "What I owned / led."
      deliveries: "What I shipped / achieved."
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml config.yaml
git commit -m "feat: about config block (bio + projects)"
```

(`config.yaml` is gitignored; `git add` skips it — expected, but edit it on disk so the server renders content.)

---

## Task 3: `/api/cv-request` endpoint

**Files:**
- Create: `src/pages/api/cv-request.ts`
- Test: `test/lib/cv-request-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCvRequest, __resetCvRateLimit } from '../../src/pages/api/cv-request';

const good = { name: 'Recruiter', email: 'r@acme.example', company: 'Acme', consent: true };
const ctx = {
  site: 'GregCo',
  now: new Date('2026-06-13T00:00:00.000Z'),
  ip: '9.9.9.9',
  captcha: { active: false, consume: () => true },
};

beforeEach(() => __resetCvRateLimit());

describe('handleCvRequest', () => {
  it('stage mode (no webhook) → 200, no fetch', async () => {
    const fetchMock = vi.fn();
    const res = await handleCvRequest(good, { ...ctx, webhookUrl: undefined, fetchImpl: fetchMock });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a cv-request payload to the webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleCvRequest(good, {
      ...ctx, webhookUrl: 'https://hooks.example/cv', fetchImpl: fetchMock,
    });
    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ name: 'Recruiter', type: 'cv-request', consent: true, site: 'GregCo' });
  });

  it('400 when not consented', async () => {
    const res = await handleCvRequest({ ...good, consent: false }, { ...ctx });
    expect(res.status).toBe(400);
  });

  it('400 when captcha active and token missing/invalid', async () => {
    const res = await handleCvRequest({ ...good, captchaToken: 'bad' }, {
      ...ctx, captcha: { active: true, consume: () => false },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/captcha/i);
  });

  it('accepts + consumes a valid captcha token', async () => {
    let consumed = '';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const res = await handleCvRequest({ ...good, captchaToken: 'tok' }, {
      ...ctx, webhookUrl: 'https://hooks.example/cv', fetchImpl: fetchMock,
      captcha: { active: true, consume: (t?: string) => { consumed = t ?? ''; return true; } },
    });
    expect(res.status).toBe(200);
    expect(consumed).toBe('tok');
  });

  it('rate-limits after 5 from one ip (429)', async () => {
    const opts = { ...ctx, webhookUrl: undefined as string | undefined };
    for (let i = 0; i < 5; i++) expect((await handleCvRequest(good, opts)).status).toBe(200);
    expect((await handleCvRequest(good, opts)).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/cv-request-endpoint.test.ts`
Expected: FAIL — cannot find module `cv-request`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { APIRoute } from 'astro';
import { getConfig } from '../../lib/config';
import { validateCvRequest, buildCvPayload, type CvInput } from '../../lib/cv-request';
import { captchaActive } from './captcha';
import { consume as consumeCaptcha } from '../../lib/captcha-store';

interface HandleResult { status: number; body: { ok: boolean; error?: string } }
interface HandleOpts {
  site: string;
  now: Date;
  ip: string;
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  captcha?: { active: boolean; consume: (token?: string) => boolean };
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  if (hits.size > 1000) {
    for (const [k, ts] of hits) if (ts.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

export function __resetCvRateLimit(): void {
  hits.clear();
}

export async function handleCvRequest(input: CvInput, opts: HandleOpts): Promise<HandleResult> {
  if (rateLimited(opts.ip, opts.now.getTime())) {
    return { status: 429, body: { ok: false, error: 'rate limited' } };
  }
  const v = validateCvRequest(input);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };

  if (opts.captcha?.active) {
    const token = (input as CvInput & { captchaToken?: string }).captchaToken;
    if (!token || !opts.captcha.consume(token)) {
      return { status: 400, body: { ok: false, error: 'captcha required' } };
    }
  }

  const payload = buildCvPayload(input, { site: opts.site, now: opts.now });
  if (!opts.webhookUrl) {
    console.log('[cv-request] stage mode (no webhook):', JSON.stringify(payload));
    return { status: 200, body: { ok: true } };
  }
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.webhookUrl, {
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
  let input: CvInput;
  try {
    input = (await request.json()) as CvInput;
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
  const result = await handleCvRequest(input, {
    site: getConfig().site.title,
    now: new Date(),
    ip,
    webhookUrl: process.env.CV_WEBHOOK_URL,
    captcha: { active: captchaActive(), consume: (t?: string) => (t ? consumeCaptcha(t) : false) },
  });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/cv-request-endpoint.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Build to confirm the route compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/cv-request.ts test/lib/cv-request-endpoint.test.ts
git commit -m "feat: /api/cv-request endpoint (validate, consent, captcha, forward/stage)"
```

---

## Task 4: About page + tab

**Files:**
- Create: `src/pages/about.astro`
- Modify: `src/layouts/Terminal.astro` (add the tab)
- Modify: `src/styles/theme.css` (about-page styles)

- [ ] **Step 1: Create `src/pages/about.astro`**

```astro
---
import Terminal from '../layouts/Terminal.astro';
import CvRequestOverlay from '../components/CvRequestOverlay.astro';
import { getConfig } from '../lib/config';

const cfg = getConfig();
const about = cfg.about;
if (!about.enabled) return new Response('Not found', { status: 404 });
const projects = [...about.projects].sort((a, b) => b.end - a.end || b.start - a.start);
---
<Terminal title="About">
  <h1>&gt; ABOUT{about.headline && <span class="muted"> // </span>}{about.headline}</h1>
  {about.bio && <p class="about-bio">{about.bio}</p>}

  <h2 class="pane-title">// ACHIEVEMENTS</h2>
  {projects.length === 0 && <p class="muted">&gt; no entries listed.</p>}
  <ul class="about-projects">
    {projects.map((p) => (
      <li class="about-project">
        <div class="about-years">[ {p.start} – {p.end} ]</div>
        <div class="about-desc">{p.description}</div>
        {p.responsibilities && (
          <div class="about-sub"><span class="muted">responsibilities:</span> {p.responsibilities}</div>
        )}
        {p.deliveries && (
          <div class="about-sub"><span class="muted">deliveries:</span> {p.deliveries}</div>
        )}
      </li>
    ))}
  </ul>

  <button class="contact-send about-cv-btn" id="request-cv" type="button">▸ REQUEST CV</button>
  <CvRequestOverlay />
</Terminal>
```

- [ ] **Step 2: Add the About me tab in `src/layouts/Terminal.astro`**

Find the `tabs` array:
```ts
const tabs = [
  { label: 'Blogs', href: '/' },
  { label: 'Contributions', href: '/contributions' },
];
```
Replace with (gate the About tab on config — add a computed array):
```ts
const tabs = [
  { label: 'Blogs', href: '/' },
  { label: 'Contributions', href: '/contributions' },
  ...(getConfig().about.enabled ? [{ label: 'About me', href: '/about' }] : []),
];
```
NOTE: `cfg` is already defined in the frontmatter (`const cfg = getConfig();`); use `cfg.about.enabled` instead of calling `getConfig()` again:
```ts
const tabs = [
  { label: 'Blogs', href: '/' },
  { label: 'Contributions', href: '/contributions' },
  ...(cfg.about.enabled ? [{ label: 'About me', href: '/about' }] : []),
];
```

- [ ] **Step 3: Add about-page styles to `src/styles/theme.css`** (append):

```css
/* About page */
.about-bio { color: var(--fg-dim); max-width: 70ch; }
.about-projects { list-style: none; padding: 0; margin: 0; }
.about-project { margin: 0 0 1.25rem; }
.about-years { color: var(--accent); letter-spacing: 0.05em; }
.about-desc { margin: 0.1rem 0; }
.about-sub { color: var(--fg-dim); font-size: 0.95rem; }
.about-cv-btn { max-width: 16rem; margin-top: 1.5rem; }
```

- [ ] **Step 4: Build (NOTE — `about.astro` imports `CvRequestOverlay`, created in Task 5; until then the build will fail to resolve it).**

If implementing strictly in order, create an empty placeholder so this task builds, OR implement Task 5 before building. Simplest: create the component file with minimal markup now and flesh it out in Task 5. To keep tasks independent, add a minimal stub `src/components/CvRequestOverlay.astro` containing just `<div id="cv-overlay" hidden></div>` so `about.astro` resolves, then Task 5 replaces it fully.

Create the stub:
```astro
---
// Placeholder — full markup + behavior added in the next task.
---
<div id="cv-overlay" hidden></div>
```

Run: `npm run build`
Expected: build succeeds; `/about` route present.

- [ ] **Step 5: Commit**

```bash
git add src/pages/about.astro src/layouts/Terminal.astro src/styles/theme.css src/components/CvRequestOverlay.astro
git commit -m "feat: About me page + tab (bio + achievements), CV overlay stub"
```

---

## Task 5: CvRequestOverlay markup + reuse styles

**Files:**
- Modify: `src/components/CvRequestOverlay.astro` (replace the stub with full markup)

Reuses existing global classes; all element ids are `cv-`-prefixed to avoid colliding with the layout's ContactOverlay.

- [ ] **Step 1: Replace `src/components/CvRequestOverlay.astro` with:**

```astro
---
// Request-CV modal: GDPR consent → slide captcha → received. Hidden until opened
// by the #request-cv button on the About page. Reuses global terminal/field/
// puzzle CSS; ids are cv-prefixed to avoid clashing with ContactOverlay.
---
<div id="cv-overlay" class="contact-overlay" hidden aria-hidden="true">
  <div class="contact-window" role="dialog" aria-modal="true" aria-label="Request CV">
    <button id="cv-close" class="contact-close" type="button" aria-label="Close">[ X ]</button>

    <form id="cv-consent" class="contact-form" novalidate>
      <p class="contact-boot">&gt; REQUEST CV // DATA CONSENT</p>
      <p class="cv-notice">
        Redistribution of the CV is not permitted. Your details are processed solely to
        handle this request; under GDPR you may exercise your right to erasure (right to
        be forgotten) at any time.
      </p>

      <label class="field">
        <span class="field-title">NAME</span>
        <span class="field-box" data-field="name">
          <span class="field-text" id="cv-name-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cv-name" type="text" autocomplete="off" spellcheck="false" maxlength="200" />
        </span>
      </label>
      <label class="field">
        <span class="field-title">EMAIL</span>
        <span class="field-box" data-field="email">
          <span class="field-text" id="cv-email-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cv-email" type="text" inputmode="email" autocomplete="off" spellcheck="false" maxlength="320" />
        </span>
      </label>
      <label class="field">
        <span class="field-title">COMPANY (OPTIONAL)</span>
        <span class="field-box" data-field="company">
          <span class="field-text" id="cv-company-text"></span><span class="cursor field-cursor"> </span>
          <input class="field-input" id="cv-company" type="text" autocomplete="off" spellcheck="false" maxlength="200" />
        </span>
      </label>

      <p class="contact-error" id="cv-error" hidden></p>
      <div class="preview-actions">
        <button class="contact-btn" id="cv-cancel" type="button">CANCEL</button>
        <button class="contact-btn contact-approve" id="cv-consent-btn" type="submit">CONSENT</button>
      </div>
    </form>

    <div class="contact-captcha" id="cv-captcha" hidden>
      <p class="contact-boot">&gt; SECURITY CHECK — SLIDE THE PIECE INTO THE GAP</p>
      <div class="puzzle" id="cv-puzzle">
        <img class="puzzle-bg" id="cv-puzzle-bg" alt="" />
        <img class="puzzle-piece" id="cv-puzzle-piece" alt="" />
      </div>
      <div class="puzzle-track" id="cv-puzzle-track">
        <div class="puzzle-handle" id="cv-puzzle-handle">&gt;&gt;</div>
      </div>
      <p class="contact-error" id="cv-captcha-msg" hidden></p>
      <button class="contact-btn" id="cv-captcha-back" type="button">&lt; BACK</button>
    </div>

    <div class="contact-preview" id="cv-received" hidden>
      <p class="contact-boot">&gt; REQUEST RECEIVED</p>
      <p>Your request has been logged. You will be reached out within <strong>24 hours</strong>.</p>
      <button class="contact-btn contact-approve" id="cv-acknowledge" type="button">ACKNOWLEDGE</button>
    </div>
  </div>
</div>
<style>
  .cv-notice { color: var(--fg-dim); max-width: 60ch; margin: 0 0 1rem; }
</style>
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/CvRequestOverlay.astro
git commit -m "feat: Request-CV modal markup (consent, captcha, received)"
```

---

## Task 6: CvRequestOverlay behavior

**Files:**
- Modify: `src/components/CvRequestOverlay.astro` (append a `<script>`)

- [ ] **Step 1: Append this `<script>` to the end of `CvRequestOverlay.astro`:**

```astro
<script>
  const overlay = document.getElementById('cv-overlay') as HTMLElement | null;
  const trigger = document.getElementById('request-cv');
  if (overlay && trigger) {
    const consent = document.getElementById('cv-consent') as HTMLFormElement;
    const captchaPanel = document.getElementById('cv-captcha') as HTMLElement;
    const received = document.getElementById('cv-received') as HTMLElement;
    const errorEl = document.getElementById('cv-error') as HTMLElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const muted = () => localStorage.getItem('blog-sound-muted') === '1';

    interface F { input: HTMLInputElement; text: HTMLElement; box: HTMLElement; }
    const fields: F[] = ['name', 'email', 'company'].map((id) => ({
      input: document.getElementById('cv-' + id) as HTMLInputElement,
      text: document.getElementById('cv-' + id + '-text') as HTMLElement,
      box: (document.getElementById('cv-' + id) as HTMLElement).closest('.field-box') as HTMLElement,
    }));
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
      [[697, 1209], [770, 1336], [852, 1477], [941, 1209]].forEach((pair, i) => beep(pair, i * 0.18, 0.12));
      setTimeout(() => ctx.close().catch(() => {}), 1200);
    }

    function showConsent() { consent.hidden = false; captchaPanel.hidden = true; received.hidden = true; errorEl.hidden = true; }
    function open() {
      overlay.hidden = false; overlay.setAttribute('aria-hidden', 'false');
      showConsent(); dialIn(); fields.forEach(sync); fields[0].input.focus();
    }
    function close() { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); }
    trigger.addEventListener('click', open);
    document.getElementById('cv-close')?.addEventListener('click', close);
    document.getElementById('cv-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function readInput() {
      return {
        name: fields[0].input.value.trim(),
        email: fields[1].input.value.trim(),
        company: fields[2].input.value.trim(),
        consent: true,
      };
    }
    function clientError(v: ReturnType<typeof readInput>): string | null {
      if (!v.name) return 'name is required';
      if (!v.email || !EMAIL_RE.test(v.email)) return 'a valid email is required';
      return null;
    }

    // CONSENT → captcha
    consent.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = clientError(readInput());
      if (err) { errorEl.textContent = '> ' + err; errorEl.hidden = false; return; }
      showCaptcha();
    });

    // --- captcha slider (mirrors ContactOverlay; cv- ids) ---
    const puzzleBg = document.getElementById('cv-puzzle-bg') as HTMLImageElement;
    const puzzlePiece = document.getElementById('cv-puzzle-piece') as HTMLImageElement;
    const puzzleTrack = document.getElementById('cv-puzzle-track') as HTMLElement;
    const puzzleHandle = document.getElementById('cv-puzzle-handle') as HTMLElement;
    const captchaMsg = document.getElementById('cv-captcha-msg') as HTMLElement;
    let captchaToken: string | null = null;
    let puzzle: { token: string; pieceSize: number; width: number } | null = null;

    async function submitCv() {
      const v = readInput();
      received.hidden = false; consent.hidden = true; captchaPanel.hidden = true;
      const ackBefore = document.getElementById('cv-acknowledge') as HTMLButtonElement;
      try {
        const res = await fetch('/api/cv-request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...v, captchaToken }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // back to consent with error
          showConsent();
          errorEl.textContent = '> REQUEST FAILED: ' + (data.error || res.status);
          errorEl.hidden = false;
          ackBefore;
        }
      } catch {
        showConsent();
        errorEl.textContent = '> REQUEST FAILED: network error';
        errorEl.hidden = false;
      }
    }

    async function loadPuzzle() {
      captchaMsg.hidden = true;
      puzzleHandle.style.left = '0px';
      puzzlePiece.style.transform = 'translateX(0px)';
      currentX = 0;
      try {
        const res = await fetch('/api/captcha');
        const data = await res.json();
        if (!data.active) { captchaToken = null; submitCv(); return; }
        puzzle = { token: data.token, pieceSize: data.pieceSize, width: data.width };
        puzzleBg.src = data.background;
        puzzlePiece.src = data.piece;
        puzzlePiece.style.top = data.pieceY + 'px';
        puzzlePiece.style.width = data.pieceSize + 'px';
        puzzlePiece.style.height = data.pieceSize + 'px';
      } catch { captchaToken = null; submitCv(); }
    }
    function showCaptcha() { consent.hidden = true; received.hidden = true; captchaPanel.hidden = false; loadPuzzle(); }

    let dragging = false;
    let currentX = 0;
    function maxX() { return puzzle ? puzzle.width - puzzle.pieceSize : 0; }
    function setX(px: number) {
      const x = Math.max(0, Math.min(px, maxX()));
      puzzlePiece.style.transform = `translateX(${x}px)`;
      const handleMax = puzzleTrack.clientWidth - puzzleHandle.offsetWidth;
      puzzleHandle.style.left = (maxX() > 0 ? (x / maxX()) * handleMax : 0) + 'px';
      return x;
    }
    puzzleHandle.addEventListener('pointerdown', (e) => { dragging = true; puzzleHandle.setPointerCapture(e.pointerId); });
    puzzleHandle.addEventListener('pointermove', (e) => {
      if (!dragging || !puzzle) return;
      const rect = puzzleTrack.getBoundingClientRect();
      const handleMax = puzzleTrack.clientWidth - puzzleHandle.offsetWidth;
      const ratio = handleMax > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / handleMax)) : 0;
      currentX = setX(ratio * maxX());
    });
    puzzleHandle.addEventListener('pointerup', async () => {
      if (!dragging || !puzzle) return;
      dragging = false;
      try {
        const res = await fetch('/api/captcha', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: puzzle.token, x: Math.round(currentX) }),
        });
        const data = await res.json();
        if (data.ok) { captchaToken = puzzle.token; submitCv(); }
        else { captchaMsg.textContent = '> ACCESS DENIED — RECALIBRATING'; captchaMsg.hidden = false; loadPuzzle(); }
      } catch { captchaMsg.textContent = '> CHECKPOINT OFFLINE — RETRY'; captchaMsg.hidden = false; }
    });
    puzzleHandle.addEventListener('pointercancel', () => { dragging = false; });
    document.getElementById('cv-captcha-back')?.addEventListener('click', showConsent);

    document.getElementById('cv-acknowledge')?.addEventListener('click', () => { window.location.href = '/'; });
  }
</script>
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (the CV overlay client script compiles). Fix any TS error minimally (e.g. casts); report changes. Remove the stray `ackBefore;` no-op line if your linter flags it — it can be deleted (it does nothing).

- [ ] **Step 3: Commit**

```bash
git add src/components/CvRequestOverlay.astro
git commit -m "feat: Request-CV modal behavior (consent → captcha → received → index)"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; `dist/server/entry.mjs` present.

- [ ] **Step 2: Start the server**

```bash
pkill -f "dist/server/entry.mjs" 2>/dev/null
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
```

- [ ] **Step 3: Verify the page + endpoint**

```bash
# About tab + page render with config content
curl -s http://127.0.0.1:4321/ | grep -oE 'href="/about">About me'
curl -s http://127.0.0.1:4321/about | grep -oE '(ABOUT|ACHIEVEMENTS|id="request-cv"|id="cv-overlay")'
# cv-request without a solved token while captcha active -> 400
curl -s -X POST http://127.0.0.1:4321/api/cv-request -H 'content-type: application/json' \
  -d '{"name":"R","email":"r@a.co","company":"","consent":true}' -w "\nstatus=%{http_code}\n"
# not consented -> 400
curl -s -X POST http://127.0.0.1:4321/api/cv-request -H 'content-type: application/json' \
  -d '{"name":"R","email":"r@a.co","consent":false}' -w "\nstatus=%{http_code}\n"
```

Expected: About tab link present; `/about` shows ABOUT/ACHIEVEMENTS/request-cv/cv-overlay; cv-request without token → `status=400` (`captcha required`); not consented → `status=400`.

- [ ] **Step 4: Verify the full happy path at HTTP (solve captcha, then cv-request 200)**

```bash
node --input-type=module -e '
const base="http://127.0.0.1:4321";
const g=await (await fetch(base+"/api/captcha")).json();
let x=-1; for(let i=0;i<=320;i+=4){const r=await (await fetch(base+"/api/captcha",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:g.token,x:i})})).json(); if(r.ok){x=i;break;}}
const c=await fetch(base+"/api/cv-request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Recruiter",email:"r@acme.example",company:"Acme",consent:true,captchaToken:g.token})});
console.log("solved x="+x, "cv-request status="+c.status, await c.text());
'
```

Expected: `cv-request status=200 {"ok":true}` (stage-mode logs the payload).

- [ ] **Step 5: Manual browser check (http://localhost:4321/about)**

- About me tab → `/about` shows bio + the projects (years, description, responsibilities, deliveries).
- **REQUEST CV** → modal opens (dial-in), consent notice + Name/Email/Company fields with block cursor; CANCEL closes.
- Fill Name + valid Email → **CONSENT** → captcha panel; solve the slider → **RECEIVED** modal ("reached out within 24 hours") → **ACKNOWLEDGE** → index.
- Invalid email on CONSENT → inline error.

- [ ] **Step 6: Stop server; commit any fixes**

```bash
pkill -f "dist/server/entry.mjs"
git add -A && git commit -m "fix: address issues found during About/CV verification"
```
(Skip if nothing changed.)

---

## Notes for the implementer

- **Distinct ids:** the layout's `ContactOverlay` is on every page (including `/about`), so the CV modal must use `cv-`-prefixed ids (done). CSS is class-based and shared.
- **Captcha reuse:** the CV modal calls the same `/api/captcha` (GET issue, POST verify); the `/api/cv-request` endpoint consumes the token via the same store. No captcha code is duplicated server-side.
- **Notification only:** `/api/cv-request` forwards `{name,email,company,consent,type:"cv-request",site,sentAt}` to `CV_WEBHOOK_URL`; it never stores or sends a CV file. Stage-mode logs when the env var is unset.
- **Graceful captcha:** if the captcha is inactive (disabled or no `public/puzzles/` images), `loadPuzzle()` gets `{active:false}` and submits directly; `/api/cv-request` then doesn't require a token.
- **Client duplication is intentional** (island isolation); a future refactor can extract the shared field-cursor + captcha-slider + dial-in into a helper used by both overlays.
