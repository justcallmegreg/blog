# Analytics (self-hosted Matomo) — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Summary

Integrate privacy-respecting web analytics so the owner can see which pages
visitors open, how long they spend on each page, and where they came from — for
later analysis. The tool is **Matomo, self-hosted** as a separate container +
database on the owner's Docker host (the blog engine stays stateless; the
browser talks directly to Matomo). The Matomo tracking snippet is injected only
after the visitor clicks **ACCEPT** on the existing GDPR consent gate (decided
by the `gregco-consent` cookie), and IP addresses are anonymized.

## Goals

- Capture page opens, time-on-page (dwell), and referrers per visit; retain the
  data for later analysis/querying.
- Free: self-hosted open-source Matomo (no SaaS cost).
- Load analytics only after consent (the existing single ACCEPT gate covers it);
  nothing loads for visitors who haven't accepted, or in dev when disabled.
- Keep the blog engine stateless — no analytics storage or proxying in the engine.

## Non-goals

- No in-engine analytics storage, dashboard, or event API (Matomo owns all of that).
- No granular multi-option consent (decided: single ACCEPT is enough).
- No server-side proxying of Matomo requests (browser → Matomo directly).
- No A/B testing, heatmaps, or session recording (Matomo plugins, out of scope).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tool | Matomo, self-hosted | Free; first-class pageviews + visit duration + visitor logs for later analysis; built-in GDPR features (IP anonymization, consent API). Owner has a Docker host. |
| Storage | Separate Matomo + MariaDB containers | Keeps the blog engine stateless; same decoupled pattern as the contact webhook. |
| Data path | Browser → Matomo directly | No engine proxy; engine stores/forwards nothing. |
| Consent | Load only when `gregco-consent=1` cookie present | Existing single-ACCEPT gate is the consent; analytics never fires pre-consent. |
| Dwell time | `enableHeartBeatTimer` | Accurate time-on-page including the exit page. |
| Config | `analytics: { enabled, matomoUrl, siteId }` | Non-secret; disabled/empty by default so dev and unconfigured deploys load nothing. |

## Architecture & flow

- **`analytics` config block** (`src/lib/config.ts`):
  - `enabled: boolean` (default `false`)
  - `matomoUrl: string` (default `''`) — Matomo base URL, e.g. `https://analytics.example.com`
  - `siteId: number` (default `1`)
- **`Analytics.astro`** (new component, rendered site-wide via `Terminal.astro`):
  - Server-side, reads `getConfig().analytics` and the `gregco-consent` cookie
    (`Astro.cookies`), exactly like `ConsentBanner.astro`.
  - Computes `active = analytics.enabled && matomoUrl !== '' && cookie === '1'`.
  - When `active`, renders the standard Matomo snippet with
    `_paq.push(['enableHeartBeatTimer'])`, `_paq.push(['trackPageView'])`, and the
    `matomoUrl`/`siteId` wired in. When not active, renders nothing.
- **Consent gate hand-off** (`ConsentBanner.astro`): the ACCEPT handler, after
  writing the cookie, injects the Matomo snippet immediately when
  `analytics.enabled && matomoUrl` (passed to the client via `data-` attributes),
  so the page on which the visitor accepts is counted without a reload. On every
  subsequent navigation the server-rendered `Analytics.astro` snippet handles it.
- **Consent text:** the gate notice gains "…and anonymous analytics" so ACCEPT
  clearly covers analytics.
- **Statelessness:** the engine renders a script tag and nothing else; all
  collection/storage happens in the visitor's browser → the owner's Matomo.

### Matomo snippet (rendered when active)

```html
<script is:inline define:vars={{ matomoUrl, siteId }}>
  var _paq = (window._paq = window._paq || []);
  _paq.push(['enableHeartBeatTimer']);
  _paq.push(['trackPageView']);
  _paq.push(['enableLinkTracking']);
  (function () {
    var u = matomoUrl.replace(/\/$/, '') + '/';
    _paq.push(['setTrackerUrl', u + 'matomo.php']);
    _paq.push(['setSiteId', String(siteId)]);
    var d = document, g = d.createElement('script'), s = d.getElementsByTagName('script')[0];
    g.async = true; g.src = u + 'matomo.js'; s.parentNode.insertBefore(g, s);
  })();
</script>
```

(IP anonymization is configured in Matomo itself — see Setup — not in the snippet.)

## Setup (documented, not code)

A `docs/analytics-matomo.md` (and a `docker-compose.matomo.example.yml`)
covering: running `matomo` + `mariadb` containers; completing the Matomo
install wizard; **Administration → Privacy → Anonymize data**: anonymize IP (≥2
bytes) and respect DoNotTrack; creating the website entry to obtain the
`siteId`; then setting `analytics.enabled: true`, `analytics.matomoUrl`, and
`analytics.siteId` in `config.yaml`.

## Testing

- **Unit:** `analytics` config defaults (`enabled=false`, `matomoUrl=''`,
  `siteId=1`).
- **SSR/integration (curl against the built server):**
  - Default config (analytics disabled) → no `matomo.js` / `_paq` in any page.
  - With `analytics.enabled=true` + `matomoUrl` set, **no** consent cookie → no
    snippet (gate present instead).
  - Same config **with** `Cookie: gregco-consent=1` → the Matomo snippet is
    present, containing the configured `matomoUrl` and `siteId` and
    `enableHeartBeatTimer`.
- **Build** clean. **Manual:** point at a real/staging Matomo, accept the gate,
  confirm the dashboard records the pageview and visit duration.

## Files

- Modify: `src/lib/config.ts` (+ `test/lib/config.test.ts`), `config.example.yaml`,
  `config.yaml`, `src/layouts/Terminal.astro` (render `<Analytics />`),
  `src/components/ConsentBanner.astro` (accept-time injection + text + `data-` vars).
- Create: `src/components/Analytics.astro`,
  `docs/analytics-matomo.md`, `docker-compose.matomo.example.yml`.

## Open questions / future work

- Optional later: a "Privacy" link to revisit/withdraw consent (would clear the
  cookie and stop analytics) — not needed for this iteration.
- Optional later: swap-in a different provider behind the same `analytics` config
  shape if Matomo proves too heavy.
