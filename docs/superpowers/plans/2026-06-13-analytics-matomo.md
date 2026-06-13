# Matomo Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a self-hosted Matomo tracking snippet site-wide, but only after a visitor accepts the GDPR consent gate (the `gregco-consent` cookie), capturing page views + time-on-page; the blog engine itself stores nothing.

**Architecture:** A new `analytics` config block; a shared client loader `src/lib/matomo.ts`; an `Analytics.astro` component that server-renders a tiny config marker + loader script only when analytics is enabled, configured, AND the consent cookie is present; and an accept-time hook in `ConsentBanner.astro` so the page where consent is given is counted without a reload. Matomo + its DB run as separate containers (documented), so the engine stays stateless.

**Tech Stack:** Astro 5 SSR (@astrojs/node), TypeScript, Vitest, Matomo (self-hosted).

---

## File Structure & Responsibilities

```
src/lib/config.ts            # + `analytics` block (enabled, matomoUrl, siteId) (+ test)
src/lib/matomo.ts            # shared client loader: loadMatomo(url, siteId) — idempotent
src/components/Analytics.astro   # SSR: render loader only when active (enabled+url+consent cookie)
src/components/ConsentBanner.astro  # ACCEPT also loads Matomo immediately; data-attrs + text
src/layouts/Terminal.astro   # render <Analytics /> site-wide
config.example.yaml / config.yaml   # document the analytics block (disabled by default)
docs/analytics-matomo.md     # how to run + configure Matomo
docker-compose.matomo.example.yml   # matomo + mariadb example
test/lib/config.test.ts      # analytics defaults
```

**Design notes:**
- `matomo.ts` is the single source of the snippet logic; both `Analytics.astro`
  (subsequent page loads, cookie already set) and `ConsentBanner.astro` (the
  accept click) import it — no duplicated tracker code. It guards against
  double-loading via a `window.__matomoLoaded` flag.
- Astro hoisted `<script>` blocks are ES modules (can `import`), but cannot read
  server vars directly — so config values cross the boundary via `data-`
  attributes on a server-rendered element, read in the script.
- Default config has analytics **disabled** so dev/local and unconfigured deploys
  render nothing. The enabled path is proven in Task 6 with a temp config.

---

## Task 1: `analytics` config block

**Files:**
- Modify: `src/lib/config.ts`, `test/lib/config.test.ts`, `config.example.yaml`, `config.yaml`

- [ ] **Step 1: Add assertions to the config test**

In `test/lib/config.test.ts`, in the "loads a full config and applies defaults" test, after the existing `cfg.privacy.consentBanner` assertion add:

```ts
    expect(cfg.analytics.enabled).toBe(false);
    expect(cfg.analytics.matomoUrl).toBe('');
    expect(cfg.analytics.siteId).toBe(1);
```

- [ ] **Step 2: Run the test, confirm it FAILS**

Run: `npx vitest run test/lib/config.test.ts`
Expected: FAIL — `cfg.analytics` is undefined.

- [ ] **Step 3: Add the `analytics` block to the schema**

In `src/lib/config.ts`, add this property to the top-level `z.object({...})`, immediately after the `privacy` block:

```ts
  // Self-hosted Matomo analytics. Loads only after the visitor accepts the
  // consent gate. Disabled + empty by default so nothing loads until configured.
  analytics: z
    .object({
      enabled: z.boolean().default(false),
      matomoUrl: z.string().default(''),
      siteId: z.number().int().default(1),
    })
    .default({}),
```

- [ ] **Step 4: Run the test, confirm it PASSES**

Run: `npx vitest run test/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Document + set the config files**

Append to `config.example.yaml` (after the `privacy:` block):

```yaml
analytics:
  enabled: false                       # set true once Matomo is reachable
  matomoUrl: "https://analytics.example.com"   # your Matomo base URL (no trailing /matomo.php)
  siteId: 1                            # the Matomo site id for this blog
```

Append to `config.yaml` (kept disabled — the running server loads no analytics until you set this up):

```yaml
analytics:
  enabled: false
  matomoUrl: ""
  siteId: 1
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts test/lib/config.test.ts config.example.yaml
git commit -m "feat: analytics config block (matomo)"
```

(`config.yaml` is gitignored — `git add` skips it; still edit it on disk.)

---

## Task 2: shared Matomo loader (`src/lib/matomo.ts`)

**Files:**
- Create: `src/lib/matomo.ts`

This is a tiny browser-only module imported by the two component scripts. It has
no easy unit test (it mutates `document`/`window`); it is verified by the build
(Task 3+) and the manual check (Task 6).

- [ ] **Step 1: Create `src/lib/matomo.ts`**

```ts
// Idempotent Matomo loader. Queues the standard tracker config (with the
// heartbeat timer for accurate time-on-page) and injects matomo.js once.
export function loadMatomo(matomoUrl: string, siteId: number): void {
  if (!matomoUrl) return;
  const w = window as unknown as { __matomoLoaded?: boolean; _paq?: unknown[][] };
  if (w.__matomoLoaded) return;
  w.__matomoLoaded = true;

  const u = matomoUrl.replace(/\/+$/, '') + '/';
  const _paq = (w._paq = w._paq || []);
  // Tracker target must be set before the queued trackPageView is processed.
  _paq.push(['setTrackerUrl', u + 'matomo.php']);
  _paq.push(['setSiteId', String(siteId)]);
  _paq.push(['enableHeartBeatTimer']); // accurate dwell time incl. the exit page
  _paq.push(['enableLinkTracking']);
  _paq.push(['trackPageView']);

  const d = document;
  const g = d.createElement('script');
  const s = d.getElementsByTagName('script')[0];
  g.async = true;
  g.src = u + 'matomo.js';
  s.parentNode?.insertBefore(g, s);
}
```

- [ ] **Step 2: Type-check via build**

Run: `npm run build`
Expected: build succeeds (module compiles; no consumer yet, so no behavior change).

- [ ] **Step 3: Commit**

```bash
git add src/lib/matomo.ts
git commit -m "feat: shared idempotent Matomo client loader"
```

---

## Task 3: `Analytics.astro` + render site-wide

**Files:**
- Create: `src/components/Analytics.astro`
- Modify: `src/layouts/Terminal.astro`

- [ ] **Step 1: Create `src/components/Analytics.astro`**

```astro
---
// Server-renders the Matomo loader ONLY when analytics is enabled, configured,
// and the visitor has accepted the consent gate (gregco-consent cookie). The
// values cross to the client via data- attributes; the script imports the
// shared loader. Renders nothing otherwise.
import { getConfig } from '../lib/config';

const a = getConfig().analytics;
const accepted = Astro.cookies.get('gregco-consent')?.value === '1';
const active = a.enabled && a.matomoUrl !== '' && accepted;
---
{active && (
  <div id="matomo-config" data-url={a.matomoUrl} data-site={String(a.siteId)} hidden></div>
)}

<script>
  import { loadMatomo } from '../lib/matomo';
  const el = document.getElementById('matomo-config');
  if (el) loadMatomo(el.dataset.url ?? '', Number(el.dataset.site ?? '1'));
</script>
```

- [ ] **Step 2: Render it site-wide in `src/layouts/Terminal.astro`**

The body already ends with the overlays then `</body>`:
```astro
    {cfg.contact.enabled && <ContactOverlay />}
    {cfg.about.enabled && <CvRequestOverlay />}
    <ConsentBanner />
  </body>
```
Add the import at the top with the other component imports:
```astro
import ConsentBanner from '../components/ConsentBanner.astro';
import Analytics from '../components/Analytics.astro';
```
And render `<Analytics />` just before `</body>` (after `<ConsentBanner />`):
```astro
    {cfg.contact.enabled && <ContactOverlay />}
    {cfg.about.enabled && <CvRequestOverlay />}
    <ConsentBanner />
    <Analytics />
  </body>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify the SSR gating (default config = disabled → nothing renders)**

```bash
pkill -9 -f "dist/server/entry.mjs" 2>/dev/null; lsof -ti tcp:4321 2>/dev/null | xargs kill -9 2>/dev/null; sleep 1
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
sleep 2
curl -s http://127.0.0.1:4321/ | grep -oc 'id="matomo-config"'
pkill -9 -f "dist/server/entry.mjs"
```
Expected: `0` (analytics disabled by default → no marker).

- [ ] **Step 5: Commit**

```bash
git add src/components/Analytics.astro src/layouts/Terminal.astro
git commit -m "feat: consent-gated Matomo Analytics component, rendered site-wide"
```

---

## Task 4: accept-time injection + consent text

**Files:**
- Modify: `src/components/ConsentBanner.astro`

So the page where the visitor clicks ACCEPT is counted immediately (the
server-rendered `Analytics.astro` only kicks in on the *next* navigation, once
the cookie exists).

- [ ] **Step 1: Read analytics config + pass values to the gate element**

In `src/components/ConsentBanner.astro` frontmatter, after `const email = cfg.privacy.email;` add:

```ts
const analytics = cfg.analytics;
const analyticsActive = analytics.enabled && analytics.matomoUrl !== '';
```

- [ ] **Step 2: Add data- attributes to the gate + mention analytics in the text**

Change the gate opening tag to carry the Matomo values (only meaningful when active):
```astro
  <div
    id="consent-gate"
    class="consent-gate"
    role="dialog"
    aria-modal="true"
    aria-label="Data processing consent"
    data-matomo-url={analyticsActive ? analytics.matomoUrl : ''}
    data-site-id={String(analytics.siteId)}
  >
```
And update the notice sentence to mention analytics — replace:
```astro
        submit (contact or CV requests) solely to respond to you — in line with GDPR. No tracking
        or advertising. You may request erasure of your data at any time{email ? (
```
with:
```astro
        submit (contact or CV requests) solely to respond to you, plus anonymous, IP-masked
        analytics so we can improve the site — in line with GDPR. No advertising. You may request
        erasure of your data at any time{email ? (
```

- [ ] **Step 3: Load Matomo in the ACCEPT handler**

Replace the whole `<script>` block at the bottom with:

```astro
<script>
  import { loadMatomo } from '../lib/matomo';
  // ACCEPT is always wired; it no-ops when the gate isn't on the page.
  const gate = document.getElementById('consent-gate');
  const accept = document.getElementById('consent-accept');
  if (gate && accept) {
    accept.addEventListener('click', () => {
      // ~180 days; SameSite=Lax is fine for a first-party consent flag.
      document.cookie = 'gregco-consent=1; path=/; max-age=15552000; SameSite=Lax';
      const url = gate.dataset.matomoUrl;
      if (url) loadMatomo(url, Number(gate.dataset.siteId ?? '1'));
      gate.remove();
    });
  }
</script>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConsentBanner.astro
git commit -m "feat: load Matomo on consent ACCEPT + mention analytics in the gate"
```

---

## Task 5: Matomo setup docs + compose example

**Files:**
- Create: `docs/analytics-matomo.md`, `docker-compose.matomo.example.yml`

- [ ] **Step 1: Create `docker-compose.matomo.example.yml`**

```yaml
# Example: run Matomo + MariaDB alongside the blog (separate from the engine,
# which stays stateless). Copy to docker-compose.matomo.yml and set passwords.
services:
  matomo-db:
    image: mariadb:11
    command: --max-allowed-packet=64MB
    environment:
      MYSQL_ROOT_PASSWORD: change-me-root
      MYSQL_DATABASE: matomo
      MYSQL_USER: matomo
      MYSQL_PASSWORD: change-me
    volumes:
      - matomo-db:/var/lib/mysql
    restart: unless-stopped

  matomo:
    image: matomo:5
    environment:
      MATOMO_DATABASE_HOST: matomo-db
      MATOMO_DATABASE_ADAPTER: mysql
      MATOMO_DATABASE_USERNAME: matomo
      MATOMO_DATABASE_PASSWORD: change-me
      MATOMO_DATABASE_DBNAME: matomo
    volumes:
      - matomo:/var/www/html
    ports:
      - "8080:80"      # put behind your reverse proxy / TLS in production
    depends_on:
      - matomo-db
    restart: unless-stopped

volumes:
  matomo-db:
  matomo:
```

- [ ] **Step 2: Create `docs/analytics-matomo.md`**

````markdown
# Analytics (self-hosted Matomo)

The blog injects the Matomo tracking snippet **only after** a visitor accepts the
consent gate (the `gregco-consent` cookie). The engine stores nothing — the
browser talks directly to your Matomo instance.

## 1. Run Matomo

```bash
cp docker-compose.matomo.example.yml docker-compose.matomo.yml
# edit the passwords, then:
docker compose -f docker-compose.matomo.yml up -d
```

Open Matomo (e.g. `http://your-host:8080`, ideally behind TLS) and complete the
install wizard, pointing it at the `matomo-db` service with the credentials you set.

## 2. Privacy settings (do this)

In Matomo: **Administration → Privacy → Anonymize data**
- Anonymize visitor IP addresses (mask at least 2 bytes).
- Optionally enable "respect DoNotTrack".

## 3. Add the website → get the siteId

**Administration → Websites → Manage → Add a new website.** Enter the blog URL.
The number in the site list is your `siteId`.

## 4. Point the blog at Matomo

In `config.yaml`:

```yaml
analytics:
  enabled: true
  matomoUrl: "https://analytics.your-host.com"   # base URL, no trailing /matomo.php
  siteId: 1                                       # from step 3
```

Restart the blog. Accept the consent gate; within a minute Matomo's
**Visitors → Visits Log** should show the visit, and **Behaviour → Pages** the
time spent per page.
````

- [ ] **Step 3: Commit**

```bash
git add docs/analytics-matomo.md docker-compose.matomo.example.yml
git commit -m "docs: Matomo self-hosting + configuration guide"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; build complete.

- [ ] **Step 2: Prove the enabled + consent path with a temp config**

`analytics:` is the LAST block in `config.yaml`, so this `awk` flips `enabled`
and `matomoUrl` ONLY inside that block (the `a` flag turns on at `^analytics:`
and never sees an earlier block):

```bash
awk '/^analytics:/{a=1}
     a && /^  enabled:/   {sub(/false/, "true")}
     a && /^  matomoUrl:/ {sub(/""/, "\"https://matomo.test\"")}
     {print}' config.yaml > /tmp/analytics-test.yaml
echo "--- analytics block in temp config: ---"
grep -A3 '^analytics:' /tmp/analytics-test.yaml
```
Expected: the temp file's `analytics:` block shows `enabled: true` and
`matomoUrl: "https://matomo.test"` (and no other block was altered).

- [ ] **Step 3: Run with the temp config + curl with/without consent cookie**

```bash
pkill -9 -f "dist/server/entry.mjs" 2>/dev/null; lsof -ti tcp:4321 2>/dev/null | xargs kill -9 2>/dev/null; sleep 1
CONFIG_PATH=/tmp/analytics-test.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
sleep 2
echo "no cookie -> gate shown, NO matomo marker:"
curl -s http://127.0.0.1:4321/ | grep -oE 'id="consent-gate"|id="matomo-config"' | sort -u
echo "with consent cookie -> matomo marker present with url+site:"
curl -s -H 'Cookie: gregco-consent=1' http://127.0.0.1:4321/ | grep -oE 'id="matomo-config"|data-url="https://matomo.test"|data-site="1"'
echo "gate carries data-matomo-url for accept-time load:"
curl -s http://127.0.0.1:4321/ | grep -oE 'data-matomo-url="https://matomo.test"'
pkill -9 -f "dist/server/entry.mjs"
rm -f /tmp/analytics-test.yaml
```

Expected:
- no cookie → `id="consent-gate"` present, `id="matomo-config"` ABSENT.
- with cookie → `id="matomo-config"`, `data-url="https://matomo.test"`, `data-site="1"` all present.
- gate carries `data-matomo-url="https://matomo.test"`.

- [ ] **Step 4: Confirm default config still loads nothing**

```bash
pkill -9 -f "dist/server/entry.mjs" 2>/dev/null; lsof -ti tcp:4321 2>/dev/null | xargs kill -9 2>/dev/null; sleep 1
CONFIG_PATH=./config.yaml CONTENT_LOCAL_DIR=/Users/greg/Workspaces/Personal/blog-content PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &
sleep 2
curl -s -H 'Cookie: gregco-consent=1' http://127.0.0.1:4321/ | grep -oc 'id="matomo-config"'
pkill -9 -f "dist/server/entry.mjs"
```
Expected: `0` (analytics disabled in the committed config → never loads, even with consent).

- [ ] **Step 5: Commit any fixes** (skip if none)

```bash
git add -A && git commit -m "fix: address issues found during analytics verification"
```

---

## Notes for the implementer

- **Statelessness preserved:** the engine only emits a `<script>` and a marker
  element; all collection happens browser → Matomo. No new server state/routes.
- **Consent-gated:** `Analytics.astro` renders the marker only when the
  `gregco-consent` cookie is `1`; `matomo.ts` is also idempotent
  (`window.__matomoLoaded`) so the accept-time load + a later server-rendered
  load can't double-count within one page.
- **Default off:** committed `config.yaml`/`config.example.yaml` keep analytics
  disabled; the owner flips it on after standing up Matomo (Task 5 doc).
- **No secrets:** `matomoUrl`/`siteId` are public by nature; nothing goes in env.
