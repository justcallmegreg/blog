# mailer

A tiny internal service that sends email via **AWS SES** for the blog engine.
FastAPI + boto3, containerized. In-cluster only (ClusterIP, no ingress, no auth) —
the blog engine and the digest CronJob are the only callers.

## Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/send` | `{to, subject, body, replyTo?, html?}` | Send one email (transactional) |
| POST | `/subscribe` | `{email}` | Add/opt-in a newsletter contact |
| POST | `/unsubscribe` | `{email}` | Opt-out a contact |
| GET | `/healthz` | – | Liveness/readiness |

The **weekly digest** is a separate entrypoint (`python -m app.digest`, run by a
K8s CronJob): it reads the blog's `/rss.xml`, keeps posts from the last
`SUMMARY_DAYS`, and emails every opted-in subscriber via SES with list management
(so each gets a one-click unsubscribe).

## Configuration (env; via the K8s Secret)

| Var | Purpose |
|---|---|
| `AWS_REGION` | SES region (the contact list is per-region) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SES credentials |
| `MAIL_FROM` | verified SES sender, e.g. `GregCo <noreply@justcallmegreg.io>` |
| `MAIL_OWNER` | where owner notifications go |
| `SES_CONTACT_LIST` | SES v2 contact list name |
| `SES_TOPIC` | contact-list topic (the digest), e.g. `weekly-digest` |
| `PORT` | default `8080` |
| `SUMMARY_DAYS`, `SITE_TITLE`, `BLOG_RSS_URL` | digest job only |

## Local development

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                                  # run the tests
uvicorn app.main:app --reload --port 8080  # run the server
```

## AWS SES setup

1. **Verify the sending domain** (`justcallmegreg.io`) in SES and enable **DKIM**
   (add the CNAME records SES gives you). A verified identity is required to send.
2. **Leave the sandbox.** New SES accounts are sandboxed and can only send to
   *verified* addresses. Request production access (SES console → Account
   dashboard → Request production access) before real newsletter sends.
3. **Create the contact list + topic** (SES v2 → Contact lists):
   ```bash
   aws sesv2 create-contact-list --region eu-central-1 \
     --contact-list-name blog-subscribers \
     --topics 'TopicName=weekly-digest,DisplayName=Weekly digest,DefaultSubscriptionStatus=OPT_IN'
   ```
4. **Create the IAM user + policy** (below), generate an access key, and put it in
   the K8s Secret (`deploy/secret.example.yaml`).

### Sample IAM policy (least privilege)

Replace `<region>`, `<account-id>`, and the from-address/list-name as needed.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendMail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "ses:FromAddress": "noreply@justcallmegreg.io" }
      }
    },
    {
      "Sid": "ManageContacts",
      "Effect": "Allow",
      "Action": ["ses:CreateContact", "ses:UpdateContact", "ses:GetContact", "ses:ListContacts"],
      "Resource": "arn:aws:ses:<region>:<account-id>:contact-list/blog-subscribers"
    }
  ]
}
```

## Deploy

The **image** is built + pushed to `ghcr.io/justcallmegreg/blog-mailer` by
`.github/workflows/mailer.yml` on changes under `mailer/**`. The **Helm chart**
lives at `../helm/mailer` and is published to `oci://ghcr.io/justcallmegreg/charts`
alongside the blog-engine chart by the release workflow.

The mailer runs in the **same stack as the blog engine** (namespace
`app-blog-engine-01`), added as another release in the blog stack's helmfile
(`stacks/blog-engine.yaml` in the GitOps repo) with a values file in the same
stack. It reads AWS credentials from a pre-created Secret (see
`secret.existingSecret`) — SES creds must not live in git; create that Secret
out-of-band (SealedSecret / external-secret / manual). Once deployed it's
reachable in-cluster as `http://mailer.app-blog-engine-01.svc:8080`.

## Wiring the blog engine

Point the blog at the mailer with `MAILER_URL=http://mailer.app-mailer.svc:8080`.
The blog builds each email's content and calls `/send` (contact, CV, newsletter
notices + confirmations) and `/subscribe` / `/unsubscribe` for the newsletter
form. With `MAILER_URL` unset the blog stays in stage-mode (logs, sends nothing),
so local dev is unaffected.
