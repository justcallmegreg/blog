# Overseer Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal "Overseer" admin console to the blog whose first tab shows a subscribers-per-day heatmap and a subscriber table with an APPROVE-guarded delete, backed directly by the SES contact list.

**Architecture:** The `/overseer` routes live inside the existing Astro SSR app (reusing the `Terminal` layout and `Heatmap` component). The same Docker image is deployed twice via the `helm/blog-engine` chart: the existing public `blog-engine` (no AWS creds; middleware 404s `/overseer`) and a new, internal-only `overseer` Deployment (`OVERSEER_ENABLED=true`, SES creds, own Service + Ingress). The Overseer reads and deletes SES contacts directly with the AWS SDK.

**Tech Stack:** Astro (SSR, `@astrojs/node`), TypeScript, Vitest, `@aws-sdk/client-sesv2`, Helm.

## Global Constraints

- Astro SSR; container listens on port **4321**; health probes hit **`/version`**.
- New runtime dependency: **`@aws-sdk/client-sesv2`** (`^3`).
- SES config comes from env: `AWS_REGION`, `SES_CONTACT_LIST`, `SES_TOPIC`; AWS credentials via the SDK default provider (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).
- The Overseer is guarded by `OVERSEER_ENABLED === 'true'`; any other value ⇒ `/overseer*` returns `404`.
- Delete is **permanent** (`DeleteContact`); the server re-checks `confirm === 'APPROVE'` (not only the browser).
- The table lists **all** contacts (both `OPT_IN` and `OPT_OUT`) with a status column; the heatmap counts **every** contact on its created date.
- Tests use Vitest under `test/lib/overseer/`, mirroring existing patterns (`test/lib/mailer.test.ts` mocked client; `test/lib/contact-endpoint.test.ts` injectable-deps handler).
- Helm additions live in `helm/blog-engine`, all gated behind `overseer.enabled` (default `false`) — existing installs are unaffected.
- Work on branch `feat/overseer-admin`. Conventional commit messages.

---

### Task 1: Subscriber types + view builder (pure)

**Files:**
- Create: `src/lib/overseer/types.ts`
- Create: `src/lib/overseer/view.ts`
- Test: `test/lib/overseer/view.test.ts`

**Interfaces:**
- Consumes: `buildHeatmap(items: { createdAt: string }[], now: Date, weeks?: number): Heatmap` and the `Heatmap` type from `src/lib/heatmap.ts`.
- Produces:
  - `Subscriber = { email: string; createdAt: string; status: 'OPT_IN' | 'OPT_OUT' }`
  - `SubscriberRow = { email: string; date: string; status: 'OPT_IN' | 'OPT_OUT' }`
  - `SubscribersView = { heatmap: Heatmap; rows: SubscriberRow[]; total: number }`
  - `buildSubscribersView(subs: Subscriber[], now: Date): SubscribersView`

- [ ] **Step 1: Write the failing test**

```ts
// test/lib/overseer/view.test.ts
import { describe, it, expect } from 'vitest';
import { buildSubscribersView } from '../../../src/lib/overseer/view';

const now = new Date('2026-07-08T12:00:00.000Z');

describe('buildSubscribersView', () => {
  it('counts each subscriber on its created day and sorts rows newest-first', () => {
    const subs = [
      { email: 'a@x.co', createdAt: '2026-07-01T09:00:00.000Z', status: 'OPT_IN' as const },
      { email: 'b@x.co', createdAt: '2026-07-07T09:00:00.000Z', status: 'OPT_OUT' as const },
      { email: 'c@x.co', createdAt: '2026-07-07T18:00:00.000Z', status: 'OPT_IN' as const },
    ];
    const view = buildSubscribersView(subs, now);
    expect(view.total).toBe(3);
    expect(view.rows.map((r) => r.email)).toEqual(['c@x.co', 'b@x.co', 'a@x.co']);
    expect(view.rows[1].status).toBe('OPT_OUT');
    expect(view.rows[0].date).toBe('2026.07.07');
    const jul7 = view.heatmap.grid.flat().find((c) => c.date === '2026-07-07');
    expect(jul7?.count).toBe(2);
  });

  it('renders an empty view without throwing', () => {
    const view = buildSubscribersView([], now);
    expect(view.total).toBe(0);
    expect(view.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/view.test.ts`
Expected: FAIL — cannot resolve `../../../src/lib/overseer/view`.

- [ ] **Step 3: Write the types**

```ts
// src/lib/overseer/types.ts
import type { Heatmap } from '../heatmap';

export type SubscriptionStatus = 'OPT_IN' | 'OPT_OUT';

export interface Subscriber {
  email: string;
  createdAt: string; // ISO 8601
  status: SubscriptionStatus;
}

export interface SubscriberRow {
  email: string;
  date: string; // YYYY.MM.DD
  status: SubscriptionStatus;
}

export interface SubscribersView {
  heatmap: Heatmap;
  rows: SubscriberRow[];
  total: number;
}
```

- [ ] **Step 4: Write the view builder**

```ts
// src/lib/overseer/view.ts
import { buildHeatmap } from '../heatmap';
import type { Subscriber, SubscribersView } from './types';

/** Build the Subscribers-tab view model from raw SES subscribers. Pure. */
export function buildSubscribersView(subs: Subscriber[], now: Date): SubscribersView {
  const heatmap = buildHeatmap(
    subs.map((s) => ({ createdAt: s.createdAt })),
    now
  );
  const rows = [...subs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({
      email: s.email,
      date: s.createdAt.slice(0, 10).replace(/-/g, '.'),
      status: s.status,
    }));
  return { heatmap, rows, total: subs.length };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/overseer/types.ts src/lib/overseer/view.ts test/lib/overseer/view.test.ts
git commit -m "feat(overseer): subscriber types + view builder"
```

---

### Task 2: SES admin client

**Files:**
- Modify: `package.json` (add dependency), `package-lock.json`
- Create: `src/lib/overseer/ses.ts`
- Test: `test/lib/overseer/ses.test.ts`

**Interfaces:**
- Consumes: `Subscriber`, `SubscriptionStatus` from `./types`.
- Produces:
  - `SesConfig = { region: string; contactList: string; topic: string }`
  - `sesConfigFromEnv(): SesConfig`
  - `SesLike = { send(command: unknown): Promise<any> }`
  - `listSubscribers(cfg: SesConfig, client?: SesLike): Promise<Subscriber[]>`
  - `deleteSubscriber(cfg: SesConfig, email: string, client?: SesLike): Promise<void>`

- [ ] **Step 1: Add the AWS SDK dependency**

Run: `npm install @aws-sdk/client-sesv2`
Expected: `package.json` gains `@aws-sdk/client-sesv2` under `dependencies`; lockfile updated.

- [ ] **Step 2: Write the failing test**

```ts
// test/lib/overseer/ses.test.ts
import { describe, it, expect } from 'vitest';
import { listSubscribers, deleteSubscriber, type SesLike } from '../../../src/lib/overseer/ses';

const cfg = { region: 'eu-central-1', contactList: 'blog-subscribers', topic: 'weekly-digest' };

function fakeClient(handlers: Record<string, (cmd: any) => any>): SesLike {
  return { send: (cmd: any) => Promise.resolve(handlers[cmd.constructor.name]?.(cmd) ?? {}) };
}

describe('listSubscribers', () => {
  it('paginates ListContacts and enriches each with GetContact date + status', async () => {
    let listCalls = 0;
    const client = fakeClient({
      ListContactsCommand: () => {
        listCalls += 1;
        return listCalls === 1
          ? { Contacts: [{ EmailAddress: 'a@x.co' }], NextToken: 'p2' }
          : { Contacts: [{ EmailAddress: 'b@x.co' }] };
      },
      GetContactCommand: (cmd) => ({
        CreatedTimestamp: new Date('2026-07-01T00:00:00.000Z'),
        TopicPreferences:
          cmd.input.EmailAddress === 'b@x.co'
            ? [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_OUT' }]
            : [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_IN' }],
      }),
    });
    const subs = await listSubscribers(cfg, client);
    expect(subs.map((s) => s.email)).toEqual(['a@x.co', 'b@x.co']);
    expect(subs[0].status).toBe('OPT_IN');
    expect(subs[1].status).toBe('OPT_OUT');
    expect(subs[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('falls back to the list default status when no explicit topic preference', async () => {
    const client = fakeClient({
      ListContactsCommand: () => ({ Contacts: [{ EmailAddress: 'a@x.co' }] }),
      GetContactCommand: () => ({
        CreatedTimestamp: new Date('2026-07-01T00:00:00.000Z'),
        TopicDefaultPreferences: [{ TopicName: 'weekly-digest', SubscriptionStatus: 'OPT_OUT' }],
      }),
    });
    const subs = await listSubscribers(cfg, client);
    expect(subs[0].status).toBe('OPT_OUT');
  });
});

describe('deleteSubscriber', () => {
  it('issues DeleteContact with the list + email', async () => {
    const sent: any[] = [];
    const client: SesLike = { send: (cmd: any) => { sent.push(cmd); return Promise.resolve({}); } };
    await deleteSubscriber(cfg, 'a@x.co', client);
    expect(sent[0].constructor.name).toBe('DeleteContactCommand');
    expect(sent[0].input).toMatchObject({ ContactListName: 'blog-subscribers', EmailAddress: 'a@x.co' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/ses.test.ts`
Expected: FAIL — cannot resolve `../../../src/lib/overseer/ses`.

- [ ] **Step 4: Write the SES admin client**

```ts
// src/lib/overseer/ses.ts
import {
  SESv2Client,
  ListContactsCommand,
  GetContactCommand,
  DeleteContactCommand,
} from '@aws-sdk/client-sesv2';
import type { Subscriber, SubscriptionStatus } from './types';

export interface SesConfig {
  region: string;
  contactList: string;
  topic: string;
}

export function sesConfigFromEnv(): SesConfig {
  return {
    region: process.env.AWS_REGION || 'eu-central-1',
    contactList: process.env.SES_CONTACT_LIST || 'blog-subscribers',
    topic: process.env.SES_TOPIC || 'weekly-digest',
  };
}

/** Minimal shape of an AWS SDK v3 client — lets tests inject a fake. */
export interface SesLike {
  send(command: unknown): Promise<any>;
}

function makeClient(cfg: SesConfig): SesLike {
  return new SESv2Client({ region: cfg.region });
}

function toIso(ts: unknown): string {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toISOString();
  return new Date(0).toISOString();
}

function effectiveStatus(contact: any, topic: string): SubscriptionStatus {
  const pref = (contact.TopicPreferences ?? []).find((p: any) => p.TopicName === topic);
  if (pref) return pref.SubscriptionStatus === 'OPT_OUT' ? 'OPT_OUT' : 'OPT_IN';
  const def = (contact.TopicDefaultPreferences ?? []).find((p: any) => p.TopicName === topic);
  if (def) return def.SubscriptionStatus === 'OPT_OUT' ? 'OPT_OUT' : 'OPT_IN';
  return 'OPT_IN';
}

/** All contacts in the list, each enriched with its true created date + status. */
export async function listSubscribers(
  cfg: SesConfig,
  client: SesLike = makeClient(cfg)
): Promise<Subscriber[]> {
  const emails: string[] = [];
  let token: string | undefined;
  do {
    const page: any = await client.send(
      new ListContactsCommand({ ContactListName: cfg.contactList, PageSize: 100, NextToken: token })
    );
    for (const c of page.Contacts ?? []) if (c.EmailAddress) emails.push(c.EmailAddress);
    token = page.NextToken;
  } while (token);

  const subs: Subscriber[] = [];
  for (const email of emails) {
    const c: any = await client.send(
      new GetContactCommand({ ContactListName: cfg.contactList, EmailAddress: email })
    );
    subs.push({ email, createdAt: toIso(c.CreatedTimestamp), status: effectiveStatus(c, cfg.topic) });
  }
  return subs;
}

/** Permanently remove a contact from the list. */
export async function deleteSubscriber(
  cfg: SesConfig,
  email: string,
  client: SesLike = makeClient(cfg)
): Promise<void> {
  await client.send(new DeleteContactCommand({ ContactListName: cfg.contactList, EmailAddress: email }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/ses.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/overseer/ses.ts test/lib/overseer/ses.test.ts
git commit -m "feat(overseer): SES admin client (list/delete contacts)"
```

---

### Task 3: Route guard + middleware

**Files:**
- Create: `src/lib/overseer/guard.ts`
- Create: `src/middleware.ts`
- Test: `test/lib/overseer/guard.test.ts`

**Interfaces:**
- Produces: `overseerBlocked(pathname: string, enabled: boolean): boolean`.
- `src/middleware.ts` exports Astro's `onRequest`; it is a thin wrapper around `overseerBlocked` (kept out of the unit test to avoid importing the `astro:middleware` virtual module).

- [ ] **Step 1: Write the failing test**

```ts
// test/lib/overseer/guard.test.ts
import { describe, it, expect } from 'vitest';
import { overseerBlocked } from '../../../src/lib/overseer/guard';

describe('overseerBlocked', () => {
  it('blocks /overseer routes when disabled', () => {
    expect(overseerBlocked('/overseer', false)).toBe(true);
    expect(overseerBlocked('/overseer/', false)).toBe(true);
    expect(overseerBlocked('/overseer/api/delete', false)).toBe(true);
  });

  it('allows /overseer routes when enabled', () => {
    expect(overseerBlocked('/overseer', true)).toBe(false);
    expect(overseerBlocked('/overseer/api/delete', true)).toBe(false);
  });

  it('never blocks non-overseer paths', () => {
    expect(overseerBlocked('/', false)).toBe(false);
    expect(overseerBlocked('/about', false)).toBe(false);
    expect(overseerBlocked('/overseerish', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/guard.test.ts`
Expected: FAIL — cannot resolve `../../../src/lib/overseer/guard`.

- [ ] **Step 3: Write the guard**

```ts
// src/lib/overseer/guard.ts
/** True when the path is an Overseer route and the console is not enabled. */
export function overseerBlocked(pathname: string, enabled: boolean): boolean {
  const isOverseer = pathname === '/overseer' || pathname.startsWith('/overseer/');
  return isOverseer && !enabled;
}
```

- [ ] **Step 4: Write the middleware**

```ts
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';
import { overseerBlocked } from './lib/overseer/guard';

export const onRequest = defineMiddleware((context, next) => {
  if (overseerBlocked(context.url.pathname, process.env.OVERSEER_ENABLED === 'true')) {
    return new Response('Not found', { status: 404 });
  }
  return next();
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/guard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/overseer/guard.ts src/middleware.ts test/lib/overseer/guard.test.ts
git commit -m "feat(overseer): route guard middleware behind OVERSEER_ENABLED"
```

---

### Task 4: Delete endpoint

**Files:**
- Create: `src/pages/overseer/api/delete.ts`
- Test: `test/lib/overseer/delete-endpoint.test.ts`

**Interfaces:**
- Consumes: `sesConfigFromEnv`, `deleteSubscriber` from `src/lib/overseer/ses.ts`.
- Produces:
  - `DeleteInput = { email?: string; confirm?: string }`
  - `DeleteResult = { status: number; body: { ok: boolean; error?: string } }`
  - `DeleteDeps = { deleteSubscriber: (email: string) => Promise<void> }`
  - `handleDelete(input: DeleteInput, deps: DeleteDeps): Promise<DeleteResult>`
  - `POST: APIRoute`

- [ ] **Step 1: Write the failing test**

```ts
// test/lib/overseer/delete-endpoint.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleDelete } from '../../../src/pages/overseer/api/delete';

describe('handleDelete', () => {
  it('400 when confirm is not exactly APPROVE', async () => {
    const del = vi.fn();
    expect((await handleDelete({ email: 'a@x.co', confirm: 'approve' }, { deleteSubscriber: del })).status).toBe(400);
    expect((await handleDelete({ email: 'a@x.co' }, { deleteSubscriber: del })).status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('400 when email is missing', async () => {
    const del = vi.fn();
    expect((await handleDelete({ confirm: 'APPROVE' }, { deleteSubscriber: del })).status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes (trimmed) and returns 200 on APPROVE', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const res = await handleDelete({ email: ' a@x.co ', confirm: 'APPROVE' }, { deleteSubscriber: del });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(del).toHaveBeenCalledWith('a@x.co');
  });

  it('502 when the delete throws', async () => {
    const del = vi.fn().mockRejectedValue(new Error('ses down'));
    const res = await handleDelete({ email: 'a@x.co', confirm: 'APPROVE' }, { deleteSubscriber: del });
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/overseer/delete-endpoint.test.ts`
Expected: FAIL — cannot resolve `../../../src/pages/overseer/api/delete`.

- [ ] **Step 3: Write the endpoint**

```ts
// src/pages/overseer/api/delete.ts
import type { APIRoute } from 'astro';
import { sesConfigFromEnv, deleteSubscriber } from '../../../lib/overseer/ses';

export interface DeleteInput {
  email?: string;
  confirm?: string;
}
export interface DeleteResult {
  status: number;
  body: { ok: boolean; error?: string };
}
export interface DeleteDeps {
  deleteSubscriber: (email: string) => Promise<void>;
}

export async function handleDelete(input: DeleteInput, deps: DeleteDeps): Promise<DeleteResult> {
  if (input.confirm !== 'APPROVE') {
    return { status: 400, body: { ok: false, error: 'confirmation required' } };
  }
  const email = (input.email ?? '').trim();
  if (!email) {
    return { status: 400, body: { ok: false, error: 'email required' } };
  }
  try {
    await deps.deleteSubscriber(email);
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 502, body: { ok: false, error: 'delete failed' } };
  }
}

export const POST: APIRoute = async ({ request }) => {
  let input: DeleteInput;
  try {
    input = (await request.json()) as DeleteInput;
  } catch {
    input = {};
  }
  const cfg = sesConfigFromEnv();
  const result = await handleDelete(input, { deleteSubscriber: (email) => deleteSubscriber(cfg, email) });
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/overseer/delete-endpoint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/overseer/api/delete.ts test/lib/overseer/delete-endpoint.test.ts
git commit -m "feat(overseer): APPROVE-guarded delete endpoint"
```

---

### Task 5: Overseer UI (tabs, delete modal, page)

**Files:**
- Create: `src/components/overseer/OverseerTabs.astro`
- Create: `src/components/overseer/DeleteConfirm.astro`
- Create: `src/pages/overseer/index.astro`

**Interfaces:**
- Consumes: `Terminal` layout (`src/layouts/Terminal.astro`, prop `title?: string`), `Heatmap` (`src/components/Heatmap.astro`, props `heatmap`, `label`, `legend`, `unit`), `listSubscribers` + `sesConfigFromEnv` (`src/lib/overseer/ses.ts`), `buildSubscribersView` (`src/lib/overseer/view.ts`). Delete modal POSTs to `/overseer/api/delete`.
- Produces: the rendered `/overseer` page. No unit tests (Astro UI); verified by `npm run build` + a dev smoke check.

- [ ] **Step 1: Write the tab bar**

```astro
---
// src/components/overseer/OverseerTabs.astro
interface Props { active: string }
const { active } = Astro.props;
// Only Subscribers exists today; add entries here as tabs are built.
const tabs = [{ id: 'subscribers', label: 'SUBSCRIBERS', href: '/overseer' }];
---
<nav class="overseer-tabs" aria-label="Overseer sections">
  {tabs.map((t) => (
    <a
      href={t.href}
      class:list={['overseer-tab', { active: t.id === active }]}
      aria-current={t.id === active ? 'page' : undefined}
    >{t.label}</a>
  ))}
</nav>
<style>
  .overseer-tabs { display: flex; gap: 0.5rem; margin: 1rem 0; border-bottom: 1px solid currentColor; }
  .overseer-tab { padding: 0.4rem 0.9rem; text-decoration: none; color: inherit; opacity: 0.55; border: 1px solid transparent; border-bottom: none; }
  .overseer-tab.active { opacity: 1; border-color: currentColor; }
</style>
```

- [ ] **Step 2: Write the delete-confirm modal**

```astro
---
// src/components/overseer/DeleteConfirm.astro
// APPROVE-guarded deletion modal. Reuses the global .contact-overlay /
// .contact-window terminal styling. Opened by clicking any [data-email]
// .ov-del-btn in the subscriber table (event-delegated below).
---
<div id="ov-del-overlay" class="contact-overlay" hidden aria-hidden="true">
  <div class="contact-window" role="dialog" aria-modal="true" aria-label="Delete subscriber">
    <button id="ov-del-close" class="contact-close" type="button" aria-label="Close">[ X ]</button>
    <p class="contact-boot">&gt; PURGE SUBSCRIBER</p>
    <p>Permanently delete <strong id="ov-del-email"></strong> from the contact list.</p>
    <p class="muted">Type <strong>APPROVE</strong> to confirm.</p>
    <input id="ov-del-input" type="text" autocomplete="off" spellcheck="false" aria-label="Type APPROVE to confirm" />
    <p id="ov-del-error" class="error" hidden></p>
    <div class="ov-del-actions"><button id="ov-del-confirm" type="button" disabled>DELETE</button></div>
  </div>
</div>
<script>
  const overlay = document.getElementById('ov-del-overlay') as HTMLElement | null;
  if (overlay) {
    const emailEl = document.getElementById('ov-del-email') as HTMLElement;
    const input = document.getElementById('ov-del-input') as HTMLInputElement;
    const confirmBtn = document.getElementById('ov-del-confirm') as HTMLButtonElement;
    const closeBtn = document.getElementById('ov-del-close') as HTMLButtonElement;
    const errorEl = document.getElementById('ov-del-error') as HTMLElement;
    let target = '';

    function open(email: string) {
      target = email;
      emailEl.textContent = email;
      input.value = '';
      confirmBtn.disabled = true;
      errorEl.hidden = true;
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      input.focus();
    }
    function close() {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }

    input.addEventListener('input', () => { confirmBtn.disabled = input.value !== 'APPROVE'; });
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.ov-del-btn') as HTMLElement | null;
      if (btn?.dataset.email) open(btn.dataset.email);
    });

    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        const res = await fetch('/overseer/api/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: target, confirm: 'APPROVE' }),
        });
        if (res.ok) { window.location.reload(); return; }
        errorEl.textContent = '> delete failed'; errorEl.hidden = false; confirmBtn.disabled = false;
      } catch {
        errorEl.textContent = '> network error'; errorEl.hidden = false; confirmBtn.disabled = false;
      }
    });
  }
</script>
<style>
  .ov-del-actions { margin-top: 1rem; }
  #ov-del-input { width: 100%; }
</style>
```

- [ ] **Step 3: Write the page**

```astro
---
// src/pages/overseer/index.astro
import Terminal from '../../layouts/Terminal.astro';
import Heatmap from '../../components/Heatmap.astro';
import OverseerTabs from '../../components/overseer/OverseerTabs.astro';
import DeleteConfirm from '../../components/overseer/DeleteConfirm.astro';
import { sesConfigFromEnv, listSubscribers } from '../../lib/overseer/ses';
import { buildSubscribersView } from '../../lib/overseer/view';

let error = '';
let view = buildSubscribersView([], new Date());
try {
  const subs = await listSubscribers(sesConfigFromEnv());
  view = buildSubscribersView(subs, new Date());
} catch (e) {
  error = e instanceof Error ? e.message : 'unknown error';
}
---
<Terminal title="Overseer">
  <h1>&gt; OVERSEER<span class="muted"> // </span>ADMIN TERMINAL</h1>
  <OverseerTabs active="subscribers" />

  {error && <p class="error">&gt; subscriber data unavailable ({error}).</p>}

  <Heatmap
    heatmap={view.heatmap}
    label="Subscribers per day, last month"
    unit="subscriber"
    legend="> new subscribers per day — last month (rows: weekday, columns: ISO week)"
  />

  <section class="pane">
    <h2 class="pane-title">// SUBSCRIBERS ({view.total})</h2>
    <table class="overseer-table">
      <thead><tr><th>EMAIL</th><th>SUBSCRIBED</th><th>STATUS</th><th>ACTION</th></tr></thead>
      <tbody>
        {view.rows.map((row) => (
          <tr>
            <td>{row.email}</td>
            <td>{row.date}</td>
            <td>{row.status}</td>
            <td>
              <button class="ov-del-btn" type="button" data-email={row.email} aria-label={`Delete ${row.email}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
              </button>
            </td>
          </tr>
        ))}
        {view.rows.length === 0 && (
          <tr><td colspan="4" class="muted">&gt; no subscribers.</td></tr>
        )}
      </tbody>
    </table>
  </section>

  <DeleteConfirm />
</Terminal>

<style>
  .overseer-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  .overseer-table th, .overseer-table td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid currentColor; }
  .overseer-table th { opacity: 0.7; }
  .ov-del-btn { background: none; border: none; color: inherit; cursor: pointer; padding: 0.2rem; opacity: 0.7; }
  .ov-del-btn:hover { opacity: 1; }
</style>
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds; no TypeScript/import errors; `/overseer` is emitted as a server route.

- [ ] **Step 5: Smoke-test the guard + page in dev**

Run (guard blocks by default):
```bash
OVERSEER_ENABLED= npm run dev &
sleep 4
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/overseer   # expect 404
```
Run (enabled shows the page; SES will error without creds, which must degrade gracefully, not 500 the page):
```bash
OVERSEER_ENABLED=true npm run dev &
sleep 4
curl -s http://localhost:4321/overseer | grep -iE 'OVERSEER|subscriber data unavailable'   # expect a match
```
Expected: disabled → `404`; enabled → HTML containing the Overseer heading and (without creds) the "subscriber data unavailable" banner. Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/components/overseer/ src/pages/overseer/index.astro
git commit -m "feat(overseer): subscribers tab UI (heatmap, table, APPROVE delete)"
```

---

### Task 6: Helm — Overseer deployment, service, ingress

**Files:**
- Create: `helm/blog-engine/templates/overseer-deployment.yaml`
- Create: `helm/blog-engine/templates/overseer-service.yaml`
- Create: `helm/blog-engine/templates/overseer-ingress.yaml`
- Modify: `helm/blog-engine/values.yaml`

**Interfaces:**
- Consumes: existing helpers `blog-engine.fullname`, `blog-engine.labels`, `blog-engine.selectorLabels`, `blog-engine.image`, `blog-engine.serviceAccountName`, and `.Values` (`image`, `imagePullSecrets`, `podSecurityContext`, `securityContext`, `resources`, `nodeSelector`, `tolerations`, `affinity`, `config`, `matomo`).
- Produces: the `overseer` Deployment + Service + Ingress, all gated by `.Values.overseer.enabled`. The Overseer pod is selectable by `app.kubernetes.io/component: overseer` (added to the base selector labels).

- [ ] **Step 1: Add the `overseer` values block**

Append to `helm/blog-engine/values.yaml`:

```yaml
# Internal "Overseer" admin console — the SAME image as blog-engine, deployed
# separately with OVERSEER_ENABLED=true and SES credentials. Disabled by default;
# existing installs are unaffected. The public blog-engine holds no AWS creds and
# 404s /overseer.
overseer:
  enabled: false
  replicas: 1
  # Secret holding SES creds (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY). For now
  # this can be the mailer's Secret (e.g. "mailer-secrets"); tighten later.
  existingSecret: ""
  env:
    AWS_REGION: "eu-central-1"
    SES_CONTACT_LIST: "blog-subscribers"
    SES_TOPIC: "weekly-digest"
  service:
    type: ClusterIP
    port: 80
  ingress:
    enabled: false
    className: ""
    host: overseer.example.com
    annotations: {}
    tls:
      enabled: false
      secretName: ""
```

- [ ] **Step 2: Write the Overseer Deployment**

```yaml
# helm/blog-engine/templates/overseer-deployment.yaml
{{- if .Values.overseer.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "blog-engine.fullname" . }}-overseer
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
    app.kubernetes.io/component: overseer
spec:
  replicas: {{ .Values.overseer.replicas }}
  selector:
    matchLabels:
      {{- include "blog-engine.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: overseer
  template:
    metadata:
      annotations:
        checksum/config: {{ list (.Values.config | toYaml) (.Values.matomo.enabled | toString) .Values.matomo.ingress.host | join "|" | sha256sum }}
      labels:
        {{- include "blog-engine.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: overseer
    spec:
      serviceAccountName: {{ include "blog-engine.serviceAccountName" . }}
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: overseer
          image: {{ include "blog-engine.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: 4321
          env:
            - name: OVERSEER_ENABLED
              value: "true"
            {{- range $k, $v := .Values.overseer.env }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
          {{- if .Values.overseer.existingSecret }}
          envFrom:
            - secretRef:
                name: {{ .Values.overseer.existingSecret }}
          {{- end }}
          volumeMounts:
            - name: config
              mountPath: /config/config.yaml
              subPath: config.yaml
              readOnly: true
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /tmp/content-cache
          startupProbe:
            httpGet: { path: /version, port: http }
            periodSeconds: 5
            failureThreshold: 30
          readinessProbe:
            httpGet: { path: /version, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /version, port: http }
            periodSeconds: 15
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      volumes:
        - name: config
          configMap:
            name: {{ include "blog-engine.fullname" . }}
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with .Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
```

- [ ] **Step 3: Write the Overseer Service**

```yaml
# helm/blog-engine/templates/overseer-service.yaml
{{- if .Values.overseer.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "blog-engine.fullname" . }}-overseer
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
    app.kubernetes.io/component: overseer
spec:
  type: {{ .Values.overseer.service.type }}
  ports:
    - port: {{ .Values.overseer.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "blog-engine.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: overseer
{{- end }}
```

- [ ] **Step 4: Write the Overseer Ingress**

```yaml
# helm/blog-engine/templates/overseer-ingress.yaml
{{- if and .Values.overseer.enabled .Values.overseer.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "blog-engine.fullname" . }}-overseer
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
    app.kubernetes.io/component: overseer
  {{- with .Values.overseer.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.overseer.ingress.className }}
  ingressClassName: {{ .Values.overseer.ingress.className }}
  {{- end }}
  {{- if .Values.overseer.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ .Values.overseer.ingress.host | quote }}
      secretName: {{ .Values.overseer.ingress.tls.secretName | quote }}
  {{- end }}
  rules:
    - host: {{ .Values.overseer.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "blog-engine.fullname" . }}-overseer
                port:
                  number: {{ .Values.overseer.service.port }}
{{- end }}
```

- [ ] **Step 5: Verify default render omits Overseer**

Run: `helm template t helm/blog-engine | grep -c overseer`
Expected: `0` (disabled by default — nothing rendered).

- [ ] **Step 6: Verify enabled render produces the resources**

Run:
```bash
helm template t helm/blog-engine \
  --set overseer.enabled=true \
  --set overseer.existingSecret=mailer-secrets \
  --set overseer.ingress.enabled=true \
  --set overseer.ingress.host=overseer.example.com \
  | grep -E 'kind: (Deployment|Service|Ingress)|name: t-blog-engine-overseer|OVERSEER_ENABLED|mailer-secrets'
```
Expected: shows the `-overseer` Deployment, Service, and Ingress, the `OVERSEER_ENABLED` env, and the `mailer-secrets` `secretRef`.

- [ ] **Step 7: Lint the chart**

Run: `helm lint helm/blog-engine --set overseer.enabled=true --set overseer.existingSecret=mailer-secrets`
Expected: `1 chart(s) linted, 0 chart(s) failed`.

- [ ] **Step 8: Commit**

```bash
git add helm/blog-engine/values.yaml helm/blog-engine/templates/overseer-deployment.yaml helm/blog-engine/templates/overseer-service.yaml helm/blog-engine/templates/overseer-ingress.yaml
git commit -m "feat(overseer): optional Helm deployment + service + ingress"
```

---

### Task 7: Full suite + docs

**Files:**
- Modify: `mailer/README.md` or `README.md` (brief Overseer note — optional, keep to a paragraph)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (the 4 new Overseer test files included).

- [ ] **Step 2: Final build check**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Add a short Overseer note to the README**

Add a paragraph under a new `## Overseer (admin)` heading describing: internal-only, same image, `overseer.enabled` in the chart, `OVERSEER_ENABLED=true` + SES creds, first tab = Subscribers.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(overseer): note the internal admin console"
```

---

## Notes for the implementer

- **Delete safety is server-side too:** never rely only on the modal's disabled button — `handleDelete` rejects anything but `confirm === 'APPROVE'`.
- **Graceful SES failure:** the page must render (with a banner) when SES is unreachable or the list is missing — see Task 5 Step 5. A thrown error inside the page frontmatter would 500 the whole route; the `try/catch` prevents that.
- **No auth by design:** the only thing keeping `/overseer` private is the `OVERSEER_ENABLED` guard + serving it on a separate internal ingress host. Do not expose the overseer ingress publicly.
