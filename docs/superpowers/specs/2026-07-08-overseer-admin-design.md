# Overseer — internal admin console (design)

Date: 2026-07-08
Status: approved (brainstorming)

## Summary

**Overseer** is an internal admin console for the blog, themed as the Fallout
"Overseer" terminal but otherwise identical in look to the public site. Its first
(and, for now, only) tab is **Subscribers**: a heatmap of newsletter signups per
day over the last month, and below it a table of subscribers with a per-row
delete action guarded by a typed `APPROVE` confirmation.

Authentication is intentionally out of scope — the Overseer is exposed only on an
internal host and is not publicly reachable.

## Key architectural decision: same image, separate guarded deployment

The `/overseer` routes live **inside the existing blog Astro app**, so they reuse
the site's design directly (`Terminal.astro` layout, `Heatmap.astro`, existing
CSS). The same Docker image is deployed twice:

| Deployment | Public? | AWS creds | `/overseer` |
|---|---|---|---|
| `blog-engine` (existing) | yes | **none** | middleware returns `404` |
| `overseer` (new) | internal only | SES creds (`mailer-secrets` for now) | served |

Rationale:

- Reuses the blog's design components and build — no duplicated mini-app.
- The **public** pod holds **zero AWS credentials**; only the internal Overseer
  pod does. (Better than injecting SES creds into the public blog engine.)
- "Separate deployment / separate Service + Ingress" is satisfied within the
  existing `helm/blog-engine` chart, gated behind `overseer.enabled` (default
  false), so nothing changes for existing installs.
- The SES secret starts as the mailer's `mailer-secrets`; later it can be swapped
  for a narrower, Overseer-scoped SES key without code changes.

## Data source

The subscriber list lives entirely in the **SES v2 contact list**
(`blog-subscribers`, topic `weekly-digest`, region `eu-central-1`) — the mailer is
stateless and there is no database. The Overseer reads and mutates SES directly
using the AWS SDK (new dependency `@aws-sdk/client-sesv2`).

- **List + created dates:** SES `ListContacts` does **not** return a created
  timestamp, so for each contact the Overseer calls `GetContact` (which returns
  `CreatedTimestamp`) to get the true signup date. Acceptable at personal-blog
  scale; results are computed per request (small N).
- **Delete:** SES `DeleteContact` — permanent removal from the contact list
  (not merely an opt-out).

## Components

### Blog app (new files)

- `src/lib/overseer/ses.ts` — SES admin client wrapping `@aws-sdk/client-sesv2`:
  - `listSubscribers(): Promise<Subscriber[]>` where
    `Subscriber = { email: string; createdAt: string; status: 'OPT_IN' | 'OPT_OUT' }`.
    Implementation: paginate `ListContacts`, then `GetContact` per contact for
    `CreatedTimestamp` and the `weekly-digest` topic preference.
  - `deleteSubscriber(email: string): Promise<void>` → `DeleteContact`.
  - Reads config from env: `AWS_REGION`, `SES_CONTACT_LIST`, `SES_TOPIC`, and AWS
    creds from the standard `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env (via
    the SDK default provider). The SES client is injectable for tests.
- `src/lib/overseer/view.ts` — pure, AWS-free view builder:
  - `buildSubscribersView(subs: Subscriber[], now: Date): { heatmap: Heatmap; rows: SubscriberRow[]; total: number }`
    using the existing `buildHeatmap(items: {createdAt}[], now, weeks)`.
  - Rows sorted newest-first; each row carries email, formatted date, status.
  - **Scope of "subscribers":** the table lists **all contacts** in the list
    (both `OPT_IN` and `OPT_OUT`), with the status column distinguishing them, so
    the Overseer can see and delete anyone. The heatmap counts **every contact on
    its created date** (signups per day), regardless of current opt status.
  - Effective status: `GetContact`'s topic preference for `weekly-digest`; if the
    contact has no explicit preference, fall back to the list's default
    (`OPT_IN`).
- `src/pages/overseer/index.astro` — the console page:
  - `Terminal` layout, title **"Overseer"**.
  - A **tab bar** component with `Subscribers` active; structured so future tabs
    are additional entries/routes (only Subscribers exists now).
  - The `Heatmap` (label/legend: subscribers per day, last month).
  - The subscriber **table**: columns email · subscribed date · status · action.
    The action is a **trash icon** button (not text) that opens the confirm modal.
- `src/components/overseer/OverseerTabs.astro` — the tab bar (single active tab
  for now; easy to extend).
- `src/components/overseer/DeleteConfirm.astro` — confirmation modal reusing the
  existing `.contact-overlay` / `.contact-window` pattern (like
  `NewsletterOverlay`). Opened from a row's trash icon with the target email; the
  confirm button is disabled until the input reads exactly `APPROVE`; on confirm
  it POSTs to the delete endpoint and reloads on success.
- `src/pages/overseer/api/delete.ts` — endpoint with a testable core:
  - `handleDelete({ email, confirm }, deps): Promise<{ status, body }>`.
  - **Server-side re-check**: `confirm === 'APPROVE'` is required server-side (not
    only in the browser); otherwise `400`. On success calls
    `deps.deleteSubscriber(email)`; SES failure → `502`.
- `src/middleware.ts` — Astro middleware: any request whose path starts with
  `/overseer` returns `404` unless `process.env.OVERSEER_ENABLED === 'true'`.

### Helm (`helm/blog-engine`) — all gated by `overseer.enabled` (default false)

- `templates/overseer-deployment.yaml` — same image as blog-engine, with:
  - `OVERSEER_ENABLED=true`, `AWS_REGION`, `SES_CONTACT_LIST`, `SES_TOPIC` from
    `.Values.overseer.env`.
  - `envFrom` the SES secret named by `.Values.overseer.existingSecret`
    (e.g. `mailer-secrets`).
- `templates/overseer-service.yaml` — its own Service.
- `templates/overseer-ingress.yaml` — its own Ingress: `overseer.ingress.host`,
  annotations, optional TLS — independent of the public blog ingress.
- `values.yaml` additions:
  ```yaml
  overseer:
    enabled: false
    existingSecret: ""      # SES creds; e.g. "mailer-secrets"
    replicas: 1
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
      tls: { enabled: false, secretName: "" }
  ```

## Data flow

1. Request to `/overseer` hits the **Overseer** pod (public pod would `404` via
   middleware). SSR handler calls `listSubscribers()` → `ListContacts`
   (paginated) → `GetContact` per contact.
2. `buildSubscribersView` turns that into the heatmap + table model; the page
   renders with `Terminal` + `Heatmap`.
3. Delete: trash icon → `DeleteConfirm` modal → type `APPROVE` →
   `POST /overseer/api/delete` → `handleDelete` validates → `DeleteContact` →
   browser reloads the list.

## Error handling

- SES unreachable / list missing → the page renders a terminal-style banner
  (`> subscriber data unavailable (<reason>)`) and an empty table, mirroring the
  contributions page's degradation. Never a blank screen.
- Delete: missing/incorrect `APPROVE` → `400`; SES error → `502`, surfaced in the
  modal so the Overseer can retry.

## Testing (vitest, following existing patterns)

- `view.ts`: heatmap counts and row ordering from fixture subscribers (pure, no
  AWS).
- `ses.ts`: against a mocked SES client — `ListContacts` + `GetContact` mapping to
  `Subscriber`, and that `deleteSubscriber` issues `DeleteContact` with the right
  args.
- `handleDelete`: `APPROVE` required (400 when absent/wrong), calls the injected
  deleter on success, `502` on SES failure.
- middleware: `/overseer` → `404` when `OVERSEER_ENABLED` unset; passes through
  when `true`.

## Out of scope (YAGNI)

- Authentication / authorization (internal host only for now).
- Additional tabs, table pagination/search, CSV export.
- A dedicated Overseer image or separate repo/app.
- Narrowly-scoped SES IAM key (reuses `mailer-secrets` initially; tightening is a
  later, creds-only change).
