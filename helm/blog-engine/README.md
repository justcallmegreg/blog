# blog-engine Helm chart

Deploys the stateless blog engine, with an optional self-hosted Matomo + MariaDB subchart.

## Install

```bash
helm dependency build helm/blog-engine
helm install blog helm/blog-engine \
  --set image.repository=ghcr.io/OWNER/REPO \
  -f my-values.yaml
```

Provide your engine config under `config:` (rendered verbatim into `/config/config.yaml`) and
your image repo. Secrets go in `secrets.data` (or set `secrets.existingSecret`).

## Key values

| Key | Default | Purpose |
|---|---|---|
| `image.repository` / `image.tag` | `ghcr.io/OWNER/REPO` / chart appVersion | the engine image |
| `replicaCount` | `2` | blog pods (see captcha note) |
| `service.sessionAffinity` | `ClientIP` | keep a visitor on one pod for the captcha |
| `config` | sample | the engine's `config.yaml`, verbatim |
| `secrets.data` / `secrets.existingSecret` | empty | `CONTENT_REPO_TOKEN`, `CONTACT_WEBHOOK_URL`, `CV_WEBHOOK_URL`, `GITHUB_TOKEN` |
| `ingress.*` | disabled | blog ingress + TLS + annotations |
| `matomo.enabled` | `false` | deploy Matomo + MariaDB |

## Captcha + multiple replicas

The slide-puzzle captcha and the contact/CV rate-limiter are **in-memory per pod**. With
`replicaCount > 1`, a captcha issued by one pod may be verified by another and fail. Either run a
single replica, or enable **sticky routing at the ingress** (e.g. nginx:
`nginx.ingress.kubernetes.io/affinity: cookie` via `ingress.annotations`). Service-level
`sessionAffinity: ClientIP` does not help behind an ingress (all traffic comes from the controller).

## Matomo

`matomo.enabled=true` adds MariaDB (StatefulSet + PVC) and Matomo (Deployment + PVC). Complete the
one-time web install wizard, enable IP anonymization, create the site, then set the blog's
`config.analytics.enabled=true` and `config.analytics.siteId`. When `matomo.ingress.host` is set and
`config.analytics.matomoUrl` is empty, the chart points the blog at `https://<that host>`.

## Validate

```bash
./scripts/helm-verify.sh   # helm lint + multi-config render assertions
```
