# Helm chart for the blog engine (+ optional Matomo) — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

A Helm umbrella chart, `helm/blog-engine`, that deploys the stateless blog engine
(Deployment + Service + optional Ingress, config via ConfigMap, secrets via Secret) and,
optionally (`matomo.enabled`), a **hand-rolled local Matomo + MariaDB subchart** using the same
official images as the project's `docker-compose.matomo.example.yml`. Probes use the engine's
`GET /version`. The blog is HA-ready (multiple replicas + `sessionAffinity: ClientIP` + a
PodDisruptionBudget), with a documented caveat that the in-memory captcha/rate-limit state needs
sticky routing (ingress cookie affinity) when running more than one replica.

## Goals

- One `helm install` deploys the blog; `matomo.enabled=true` adds Matomo + MariaDB.
- Config is a `config:` subtree rendered verbatim into `config.yaml`; secrets created from values
  or referenced via `existingSecret`.
- Secure, production-leaning defaults (non-root, read-only root FS, dropped caps, PDB, probes).
- No third-party chart dependency; Matomo uses official `matomo:5` + `mariadb:11`.

## Non-goals

- No HPA in v1 (documented as future work; the blog is light and captcha state complicates it).
- No automated Matomo install wizard / superuser Job (the one-time web wizard stays, as today).
- No shared/Redis-backed captcha store (in-memory remains; addressed via affinity + docs).
- No cluster provisioning, cert-manager/ingress-controller install, or GHCR setup.

## Key decisions

| Decision | Choice |
|---|---|
| Scope | Umbrella chart: blog + optional Matomo subchart. |
| Matomo subchart | Hand-rolled, official images (`matomo:5`, `mariadb:11`); no external chart. |
| Replicas/HA | `replicaCount: 2`, Service `sessionAffinity: ClientIP`, PDB `minAvailable: 1`. |
| Config | `config:` subtree → ConfigMap `config.yaml` (verbatim `toYaml`). |
| Secrets | Created from `secrets.data`, or `secrets.existingSecret`. |
| Probes | `GET /version` for readiness/liveness/startup. |
| Captcha at scale | Documented: enable ingress cookie affinity, or run 1 replica. |

## Chart layout

```
helm/blog-engine/
  Chart.yaml                 # type: application; appVersion tracks the app; dep → matomo (condition)
  values.yaml
  templates/
    _helpers.tpl             # name/labels/selectorLabels/image/secretName helpers
    serviceaccount.yaml
    configmap.yaml           # config.yaml from .Values.config | toYaml
    secret.yaml              # created unless .Values.secrets.existingSecret
    deployment.yaml
    service.yaml
    ingress.yaml             # if .Values.ingress.enabled
    pdb.yaml                 # if replicaCount > 1
    NOTES.txt
  charts/matomo/
    Chart.yaml
    values.yaml
    templates/
      _helpers.tpl
      secret.yaml            # MariaDB creds (unless existingSecret)
      mariadb-statefulset.yaml   # volumeClaimTemplate PVC
      mariadb-service.yaml       # ClusterIP :3306
      deployment.yaml            # matomo:5, 1 replica
      pvc.yaml                   # RWO PVC for /var/www/html
      service.yaml               # ClusterIP :80
      ingress.yaml               # optional analytics host
      NOTES.txt
```

`Chart.yaml` lists the local subchart as a dependency:
`dependencies: [{ name: matomo, version: <x>, repository: "file://./charts/matomo", condition: matomo.enabled }]`.

## Blog engine resources

**Deployment**
- Image `{{ image.repository }}:{{ image.tag | default .Chart.AppVersion }}`, `replicaCount`.
- `config.yaml` mounted from the ConfigMap at `/config/config.yaml` (`subPath: config.yaml`,
  read-only). The image's default `CONFIG_PATH=/config/config.yaml` already matches.
- `emptyDir` mounted at `/tmp/content-cache` (the image's `CACHE_DIR`) so `readOnlyRootFilesystem`
  can be `true`; plus an `emptyDir` at `/tmp` if needed for buildless writes.
- `envFrom: [secretRef: <secret>]` for `CONTENT_REPO_TOKEN`, `CONTACT_WEBHOOK_URL`,
  `CV_WEBHOOK_URL`, `GITHUB_TOKEN` (only the keys that are set / the whole referenced Secret).
- A checksum annotation of the ConfigMap (`checksum/config`) so config changes roll pods.
- Probes (all `httpGet /version` on the container port):
  - `startupProbe`: failureThreshold ~30 × periodSeconds 5 (covers initial content clone).
  - `readinessProbe` + `livenessProbe`: modest periods.
- `podSecurityContext`: `runAsNonRoot: true`, `seccompProfile: RuntimeDefault`.
  `containerSecurityContext`: `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`,
  `capabilities: { drop: [ALL] }`.
- `resources`, `nodeSelector`, `tolerations`, `affinity`, `imagePullSecrets` — all from values.

**Service** — ClusterIP; `port` (default 80) → `targetPort` 4321; `sessionAffinity: ClientIP`
(configurable; the captcha-stickiness knob).

**Ingress** (optional) — `className`, `host`, `annotations` (for cookie affinity / cert-manager),
TLS (`secretName`).

**PodDisruptionBudget** — rendered when `replicaCount > 1`; `minAvailable` (default 1).

**ServiceAccount** — created (configurable name); `automountServiceAccountToken: false`.

**ConfigMap** — `data.config.yaml: {{ .Values.config | toYaml | nindent }}`.

**Secret** — when `secrets.create` and no `existingSecret`: a Secret with the non-empty keys from
`secrets.data`. The Deployment references `secrets.existingSecret` if set, else the created one.

## Matomo subchart

- **MariaDB**: StatefulSet (`mariadb:11`, 1 replica) with a `volumeClaimTemplate`
  (`persistence.size`, `storageClass`); `MARIADB_*`/`MYSQL_*` env from a Secret (root + app
  creds); ClusterIP Service `:3306`.
- **Matomo**: Deployment (`matomo:5`, **1 replica**; RWO PVC at `/var/www/html`),
  `MATOMO_DATABASE_HOST/ADAPTER/USERNAME/PASSWORD/DBNAME` env → MariaDB Service + Secret;
  ClusterIP Service `:80`; optional Ingress (`matomo.ingress.host`).
- **Secret**: MariaDB credentials from values or `existingSecret`.
- First run: the **web install wizard** (point at the `mariadb` service + creds), then
  **Administration → Privacy → Anonymize data**, then create the site to get the `siteId`.
  NOTES.txt covers this.
- **Analytics URL wiring:** when `matomo.enabled` and `matomo.ingress.host` are set and the blog's
  `config.analytics.matomoUrl` is empty, the chart defaults it to `https://<matomo.ingress.host>`
  (the browser-facing URL). The operator still flips `config.analytics.enabled` and sets `siteId`
  after the wizard.

## Values (high level)

```yaml
image: { repository: "ghcr.io/OWNER/REPO", tag: "", pullPolicy: IfNotPresent }
imagePullSecrets: []
replicaCount: 2
service: { type: ClusterIP, port: 80, sessionAffinity: ClientIP }
ingress: { enabled: false, className: "", host: blog.example.com, annotations: {}, tls: { enabled: false, secretName: "" } }
podDisruptionBudget: { enabled: true, minAvailable: 1 }
resources: { requests: { cpu: 50m, memory: 128Mi }, limits: { memory: 256Mi } }
serviceAccount: { create: true, name: "" }
podSecurityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
config:                       # rendered verbatim into config.yaml (the engine's config)
  site: { ... }
  content: { repo: "...", branch: main, syncIntervalSeconds: 300 }
  # effects / github / contact / social / about / privacy / analytics ...
secrets:
  create: true
  existingSecret: ""
  data: { CONTENT_REPO_TOKEN: "", CONTACT_WEBHOOK_URL: "", CV_WEBHOOK_URL: "", GITHUB_TOKEN: "" }
matomo:
  enabled: false
  image: { repository: matomo, tag: "5" }
  persistence: { size: 5Gi, storageClass: "" }
  mariadb:
    image: { repository: mariadb, tag: "11" }
    persistence: { size: 8Gi, storageClass: "" }
    auth: { existingSecret: "", rootPassword: "", database: matomo, username: matomo, password: "" }
  ingress: { enabled: false, className: "", host: analytics.example.com, annotations: {}, tls: { enabled: false, secretName: "" } }
  resources: { ... }
```

## Testing

- **`helm lint helm/blog-engine`** — passes (umbrella + subchart).
- **`helm template`** rendered in three configurations, each asserted with `grep`/`yaml` checks:
  1. defaults → blog Deployment/Service/ConfigMap/Secret/PDB present; **no** Matomo resources;
     probes hit `/version`; Service has `sessionAffinity: ClientIP`.
  2. `--set matomo.enabled=true` → MariaDB StatefulSet + Matomo Deployment/Service/PVCs render;
     `MATOMO_DATABASE_HOST` points at the MariaDB service.
  3. `--set ingress.enabled=true --set secrets.existingSecret=mysecret` → Ingress renders with the
     host; **no** chart-managed Secret; Deployment `envFrom` references `mysecret`.
- **`kubeconform`** (if installed) over the rendered manifests for schema validity; otherwise note
  it as a CI/cluster-side check.
- A `helm/blog-engine/README.md` with install/usage + the captcha-affinity caveat; a documented
  `helm install --dry-run` walkthrough. (No live cluster in this environment.)

## Files

- Create: the chart tree above under `helm/blog-engine/` (umbrella templates + `charts/matomo/`),
  `helm/blog-engine/README.md`, and `test/helm/render.test.ts` (or a bash script run from CI)
  that shells out to `helm template`/`helm lint` and asserts the three render configurations.
- Modify: top-level `README.md` (a short "Deploy with Helm" pointer).

## Open questions / future work

- HPA + a Redis-backed captcha/rate-limit store to make the blog horizontally scalable without
  sticky routing.
- An optional Helm hook Job to automate Matomo's install (superuser + site) for zero-touch.
- Publishing the chart to an OCI registry (ghcr) via CI alongside the image.
