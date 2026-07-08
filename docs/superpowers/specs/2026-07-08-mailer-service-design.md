# Design: `mailer` service (SES) + email flows

**Date:** 2026-07-08
**Status:** Proposed

## Summary

A small, internal **mailer** service that sends email via **AWS SES**, plus the
wiring to use it for the blog's three flows and a weekly digest:

1. **Transactional email** — contact messages, CV requests, and newsletter
   subscribe/unsubscribe events are turned into emails (owner notifications, and
   confirmations to the sender/subscriber).
2. **Weekly digest** — a scheduled job emails subscribers a round-up of recent
   posts.

The mailer is a generic sender (`POST /send`) plus thin subscriber endpoints. It
runs in-cluster, reachable only by the blog engine and its own CronJob (ClusterIP,
no ingress, no app-level auth). Subscribers and unsubscribe handling live in an
**AWS SES v2 contact list**, so the mailer stays stateless (no database/PVC) and
AWS hosts the one-click unsubscribe.

## Goals

- One simple way to send email from the blog, backed by SES.
- Keep the blog engine stateless; keep the mailer stateless too.
- Internal-only; no public surface for the mailer.
- Deliver working transactional email first; the digest reuses the same service.
- Ship with a setup guide + a least-privilege sample IAM policy.

## Non-Goals

- No public/tenant-facing email API; only the blog engine + the digest CronJob call it.
- No app-level authN/Z — network isolation (ClusterIP) is the control.
- No custom subscriber database — SES contact lists own the list + unsubscribe.
- No transactional queue/retry beyond SES's own handling and a small in-request retry.

## Architecture

```
                         (public)                         (in-cluster only)
  visitor ── HTTPS ──▶  blog engine  ── POST /send ─────▶  mailer  ── SES API ──▶  AWS SES ──▶ inbox
                        (Astro SSR)   ── POST /subscribe ─▶ (FastAPI)                 │
                                                                                     └─ contact list
  CronJob (weekly) ── digest entrypoint ─▶ GET blog /rss.xml ─▶ build email ─▶ SES SendEmail (list mgmt)
```

- **mailer**: Python + FastAPI + boto3, packaged as a container (lives at
  `blog/mailer/` in this repo, built as its own image). Deployed as its own
  ArgoCD app with a `ClusterIP` Service (e.g. `mailer.app-mailer.svc:8080`).
- **blog engine**: builds email content and calls the mailer (replaces today's
  fire-and-forget `*_WEBHOOK_URL` posts).
- **digest CronJob**: the same image, `digest` entrypoint, on a weekly schedule.

## The mailer service

FastAPI app, one worker (uvicorn). Endpoints:

- `POST /send` — `{ "to": str, "subject": str, "body": str, "replyTo"?: str, "html"?: bool }`
  → SES `SendEmail`. `from` is fixed (config). Returns `{ ok, messageId }`. This is
  the generic primitive the blog uses for all transactional mail.
- `POST /subscribe` — `{ "email": str }` → SES `CreateContact` on the configured
  contact list (topic subscribed). Idempotent: treat "already exists" as success.
- `POST /unsubscribe` — `{ "email": str }` → SES `UpdateContact` opt-out (used by
  the blog's newsletter "unsubscribe" form; the email one-click path is handled by
  SES directly, see below).
- `GET /healthz` — liveness/readiness (no SES call).

Behavior notes:
- Validate `to`/`email` with a simple regex; reject malformed with 400.
- Errors from SES → 502 with a short message (logged, not leaked to the visitor;
  the blog surfaces a generic failure).
- Concurrency is tiny; no queue. One in-process retry on throttling.

Config (env; secrets via K8s Secret):

| Var | Purpose |
|---|---|
| `AWS_REGION` | SES region (contact list is per-region) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SES credentials (K8s Secret) |
| `MAIL_FROM` | verified SES sender, e.g. `GregCo <noreply@justcallmegreg.io>` |
| `MAIL_OWNER` | where owner notifications go (your address) |
| `SES_CONTACT_LIST` | SES v2 contact list name |
| `SES_TOPIC` | contact-list topic name (e.g. `weekly-digest`) |
| `PORT` | default 8080 |

## SES integration

- **Identity:** verify the sending domain (or address) in SES; add DKIM. Until
  SES production access is granted, the account is in the **sandbox** (can only
  send to verified addresses) — the setup guide calls this out.
- **Contact list:** one SES v2 contact list with a single topic (the digest).
  `/subscribe` adds a contact opted-in to that topic; `/unsubscribe` opts out.
- **Unsubscribe (digest):** the digest sends with `ListManagementOptions`
  (`ContactListName` + `TopicName`). SES then adds the `List-Unsubscribe` header
  and an unsubscribe footer, hosts the unsubscribe page, and records opt-outs back
  into the contact list automatically. **No public endpoint of ours is needed.**
- **Transactional email** (contact/CV/newsletter notices, confirmations) is sent
  **without** list management (it's 1:1, not bulk), just `SendEmail`.

## Transactional flows (blog → mailer)

The blog gains a small mailer client (`src/lib/mailer.ts`): builds `{to, subject,
body, replyTo}` and POSTs to `${MAILER_URL}/send`. The three API routes change
from posting raw payloads to a webhook to calling the mailer. `MAILER_URL` unset
→ keep today's "stage mode" (log only), so local dev is unaffected.

| Flow | Owner notification | Sender confirmation |
|---|---|---|
| **Contact** | to `MAIL_OWNER`, `replyTo` = sender, body = message + meta | to sender: "we received your message" |
| **CV request** | to `MAIL_OWNER`: name/email/company/consent | to sender: "your CV request was received" |
| **Newsletter subscribe** | to `MAIL_OWNER`: "X subscribed" + call `/subscribe` | to subscriber: "you're subscribed" (a `/send`) |
| **Newsletter unsubscribe** | to `MAIL_OWNER`: "X unsubscribed" + call `/unsubscribe` | (none) |

Content is plain, factual text (matching the site voice). No secrets or captcha
tokens are ever forwarded.

## Weekly digest

- **Trigger:** a K8s `CronJob` (weekly, schedule from config) running the mailer
  image with a `digest` entrypoint.
- **Generate:** GET the blog's internal `/rss.xml`, keep items published in the
  last `SUMMARY_DAYS` days. If none, exit without sending.
- **Send:** `ListContacts` (opted-in) → for each, `SendEmail` with
  `ListManagementOptions` so every recipient gets the one-click unsubscribe.
  (Loop `SendEmail`; the list is small. Revisit `SendBulkEmail` + a template only
  if volume grows.)
- **Config:** `SUMMARY_DAYS`, `DIGEST_SCHEDULE` (cron), `BLOG_RSS_URL`
  (e.g. `http://blog-engine.app-blog-engine-01.svc/rss.xml`), `SITE_TITLE`.

## Deployment

- **Image:** `mailer/Dockerfile` (slim Python), built + pushed to
  `ghcr.io/justcallmegreg/blog-mailer` by `.github/workflows/mailer.yml` on
  `mailer/**` changes.
- **Chart:** `helm/mailer` (Deployment + ClusterIP Service + digest CronJob),
  published to `oci://ghcr.io/justcallmegreg/charts` by the release workflow.
- **Same stack as the blog:** the mailer is added as **another release in the blog
  stack's helmfile** (`stacks/blog-engine.yaml`), namespace `app-blog-engine-01`,
  with values in `stack-configs/blog-engine/mailer-values.yaml`. No separate
  ArgoCD app — it deploys with the blog stack.
- **AWS creds:** the chart references a pre-created `existingSecret` (SES creds not
  in git). Non-secret config (region, from, owner, list/topic, digest) is chart
  values.
- **Blog wiring:** set `MAILER_URL=http://mailer.app-blog-engine-01.svc:8080` and
  `OWNER_EMAIL` on the blog engine via its chart `secrets.data` in the stack values.
- `imagePullPolicy: Always` on `:latest` (matches the existing deploy convention).

## IAM (least privilege)

A dedicated IAM user (static access key stored in the K8s Secret; no IRSA on k3s).
Sample policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendMail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": "*",
      "Condition": { "StringEquals": { "ses:FromAddress": "noreply@justcallmegreg.io" } }
    },
    {
      "Sid": "ManageContacts",
      "Effect": "Allow",
      "Action": ["ses:CreateContact", "ses:UpdateContact", "ses:GetContact", "ses:ListContacts"],
      "Resource": "arn:aws:ses:<region>:<account-id>:contact-list/<list-name>"
    }
  ]
}
```

Setup guide (in `blog/mailer/README.md`) covers: verify domain + DKIM, request
production access (leave sandbox), create the contact list + topic, create the IAM
user + policy, drop the key into the K8s Secret.

## Security & privacy

- Mailer is `ClusterIP` only — no ingress, no public route; callers are the blog
  pod and the CronJob. (Optional `NetworkPolicy` restricting to the blog namespace
  as defense-in-depth; not required.)
- No app-level auth by decision (internal isolation is the control).
- GDPR: sending is consent-gated upstream (the blog's consent flow); the digest
  carries a working one-click unsubscribe via SES; no PII stored by us beyond the
  SES contact list.

## Testing

- **mailer (pytest):** email-content builders and request validation are pure and
  unit-tested; SES calls are exercised against a stubbed client (botocore Stubber
  or `moto`) — assert the right SES params (from, list-management on digest, none
  on transactional). `/healthz` returns 200 without touching SES.
- **blog (vitest):** the mailer client builds the correct `{to,subject,body,
  replyTo}` per flow; unset `MAILER_URL` → stage-mode (no network).
- Manual: local `docker compose` run of the mailer against SES sandbox to a
  verified address; verify a digest dry-run.

## Open questions / future

- `SendBulkEmail` + an SES template if the subscriber list ever grows large.
- Bounce/complaint handling (SES SNS notifications) — deferred.
- Per-topic newsletters — deferred (single topic for now).
