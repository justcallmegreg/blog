# Helm chart (blog-engine + optional Matomo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic, adoptable Helm umbrella chart `helm/blog-engine` that deploys the stateless blog engine (HA-ready, hardened, `/version` probes) and, when `matomo.enabled=true`, a hand-rolled Matomo + MariaDB subchart using official images.

**Architecture:** Umbrella chart with blog templates at top level + a local `charts/matomo` subchart (toggled by a `condition`). Config is rendered verbatim from a `config:` values subtree into a ConfigMap; secrets come from values or an `existingSecret`. The blog runs non-root with a read-only root FS and ClientIP service affinity; Matomo/MariaDB use the official images' default (root-entrypoint) security since they step down internally.

**Tech Stack:** Helm 3 (Go templates), Kubernetes, official `matomo:5` / `mariadb:11` images, the project's ghcr image.

---

## File Structure & Responsibilities

```
helm/blog-engine/
  Chart.yaml                 # umbrella; dependency → ./charts/matomo (condition: matomo.enabled)
  values.yaml                # blog values + matomo: subtree
  README.md
  templates/
    _helpers.tpl             # name/labels/selectorLabels/image/secretName/serviceAccountName
    serviceaccount.yaml
    configmap.yaml           # config.yaml from .Values.config (+ analytics.matomoUrl auto-default)
    secret.yaml              # created unless secrets.existingSecret
    deployment.yaml          # blog Deployment (hardened, /version probes, config+cache volumes)
    service.yaml             # ClusterIP + sessionAffinity
    ingress.yaml             # optional
    pdb.yaml                 # when replicaCount > 1
    NOTES.txt
  charts/matomo/
    Chart.yaml
    values.yaml
    templates/
      _helpers.tpl
      secret.yaml            # MariaDB creds (unless existingSecret)
      mariadb-statefulset.yaml
      mariadb-service.yaml
      pvc.yaml               # matomo /var/www/html
      deployment.yaml        # matomo:5, Recreate, 1 replica
      service.yaml
      ingress.yaml
      NOTES.txt
scripts/helm-verify.sh       # helm lint + 3 template renders with assertions (+ kubeconform if present)
```

**Notes:** The blog hardened securityContext (non-root, read-only root FS) is correct because the
engine image runs as the non-root `app` user. **Matomo/MariaDB official images need a root
entrypoint** (they chown then step down), so their pods use image defaults — do NOT force
`runAsNonRoot` there. `helm`/`kubeconform` may be absent locally; the verify script degrades to a
YAML-parse + skip-with-message (mirroring how CI/cluster will validate).

---

## Task 1: Matomo subchart (`helm/blog-engine/charts/matomo`)

**Files:** all under `helm/blog-engine/charts/matomo/`.

- [ ] **Step 1: `Chart.yaml`**

```yaml
apiVersion: v2
name: matomo
description: Self-hosted Matomo + MariaDB analytics for the blog engine
type: application
version: 0.1.0
appVersion: "5"
```

- [ ] **Step 2: `values.yaml`**

```yaml
# Defaults for the Matomo subchart. Overridden under `matomo:` in the umbrella values.
enabled: false

image:
  repository: matomo
  tag: "5"
  pullPolicy: IfNotPresent

service:
  port: 80

persistence:
  size: 5Gi
  storageClass: ""

resources: {}

ingress:
  enabled: false
  className: ""
  host: analytics.example.com
  annotations: {}
  tls:
    enabled: false
    secretName: ""

mariadb:
  image:
    repository: mariadb
    tag: "11"
    pullPolicy: IfNotPresent
  persistence:
    size: 8Gi
    storageClass: ""
  resources: {}
  auth:
    existingSecret: ""
    rootPassword: "change-me-root"
    database: matomo
    username: matomo
    password: "change-me"
```

- [ ] **Step 3: `templates/_helpers.tpl`**

```
{{- define "matomo.fullname" -}}
{{- printf "%s-matomo" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "matomo.mariadb.fullname" -}}
{{- printf "%s-matomo-mariadb" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "matomo.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: matomo
{{- end -}}

{{- define "matomo.mariadb.secretName" -}}
{{- if .Values.mariadb.auth.existingSecret -}}{{ .Values.mariadb.auth.existingSecret }}{{- else -}}{{ include "matomo.mariadb.fullname" . }}{{- end -}}
{{- end -}}
```

- [ ] **Step 4: `templates/secret.yaml`**

```yaml
{{- if not .Values.mariadb.auth.existingSecret }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "matomo.mariadb.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo-mariadb
    {{- include "matomo.labels" . | nindent 4 }}
type: Opaque
stringData:
  MARIADB_ROOT_PASSWORD: {{ .Values.mariadb.auth.rootPassword | quote }}
  MARIADB_DATABASE: {{ .Values.mariadb.auth.database | quote }}
  MARIADB_USER: {{ .Values.mariadb.auth.username | quote }}
  MARIADB_PASSWORD: {{ .Values.mariadb.auth.password | quote }}
{{- end }}
```

- [ ] **Step 5: `templates/mariadb-statefulset.yaml`**

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: {{ include "matomo.mariadb.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo-mariadb
    {{- include "matomo.labels" . | nindent 4 }}
spec:
  serviceName: {{ include "matomo.mariadb.fullname" . }}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: matomo-mariadb
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: matomo-mariadb
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: mariadb
          image: "{{ .Values.mariadb.image.repository }}:{{ .Values.mariadb.image.tag }}"
          imagePullPolicy: {{ .Values.mariadb.image.pullPolicy }}
          args: ["--max-allowed-packet=64MB"]
          envFrom:
            - secretRef:
                name: {{ include "matomo.mariadb.secretName" . }}
          ports:
            - name: mysql
              containerPort: 3306
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
          resources:
            {{- toYaml .Values.mariadb.resources | nindent 12 }}
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        {{- if .Values.mariadb.persistence.storageClass }}
        storageClassName: {{ .Values.mariadb.persistence.storageClass | quote }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.mariadb.persistence.size }}
```

- [ ] **Step 6: `templates/mariadb-service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "matomo.mariadb.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo-mariadb
    {{- include "matomo.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: 3306
      targetPort: mysql
      name: mysql
  selector:
    app.kubernetes.io/name: matomo-mariadb
    app.kubernetes.io/instance: {{ .Release.Name }}
```

- [ ] **Step 7: `templates/pvc.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "matomo.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo
    {{- include "matomo.labels" . | nindent 4 }}
spec:
  accessModes: ["ReadWriteOnce"]
  {{- if .Values.persistence.storageClass }}
  storageClassName: {{ .Values.persistence.storageClass | quote }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.persistence.size }}
```

- [ ] **Step 8: `templates/deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "matomo.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo
    {{- include "matomo.labels" . | nindent 4 }}
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: matomo
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: matomo
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: matomo
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          env:
            - name: MATOMO_DATABASE_HOST
              value: {{ include "matomo.mariadb.fullname" . | quote }}
            - name: MATOMO_DATABASE_ADAPTER
              value: "mysql"
            - name: MATOMO_DATABASE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: {{ include "matomo.mariadb.secretName" . }}
                  key: MARIADB_USER
            - name: MATOMO_DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ include "matomo.mariadb.secretName" . }}
                  key: MARIADB_PASSWORD
            - name: MATOMO_DATABASE_DBNAME
              valueFrom:
                secretKeyRef:
                  name: {{ include "matomo.mariadb.secretName" . }}
                  key: MARIADB_DATABASE
          ports:
            - name: http
              containerPort: 80
          volumeMounts:
            - name: data
              mountPath: /var/www/html
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: {{ include "matomo.fullname" . }}
```

- [ ] **Step 9: `templates/service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "matomo.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo
    {{- include "matomo.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      name: http
  selector:
    app.kubernetes.io/name: matomo
    app.kubernetes.io/instance: {{ .Release.Name }}
```

- [ ] **Step 10: `templates/ingress.yaml`**

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "matomo.fullname" . }}
  labels:
    app.kubernetes.io/name: matomo
    {{- include "matomo.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ .Values.ingress.tls.secretName | quote }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "matomo.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

- [ ] **Step 11: `templates/NOTES.txt`**

```
Matomo + MariaDB deployed.

First-run setup (one-time web wizard):
  1. Reach Matomo (port-forward or its ingress host: {{ .Values.ingress.host }}).
     kubectl port-forward svc/{{ include "matomo.fullname" . }} 8080:{{ .Values.service.port }}
  2. Complete the install wizard. Database settings:
       host:     {{ include "matomo.mariadb.fullname" . }}
       database: {{ .Values.mariadb.auth.database }}
       user:     {{ .Values.mariadb.auth.username }}
       password: (from secret {{ include "matomo.mariadb.secretName" . }})
  3. Administration -> Privacy -> Anonymize data: mask IPs (>= 2 bytes).
  4. Add the blog as a website to get its siteId; set blog `config.analytics.siteId`.
```

- [ ] **Step 12: Validate the subchart standalone**

```bash
if command -v helm >/dev/null; then
  helm lint helm/blog-engine/charts/matomo --set enabled=true
  helm template t helm/blog-engine/charts/matomo --set enabled=true >/dev/null && echo "matomo render OK"
else
  echo "helm not installed — skipping (validated in CI/cluster)"
fi
```
Expected: lint passes; render OK (or the skip message).

- [ ] **Step 13: Commit**

```bash
git add helm/blog-engine/charts/matomo
git commit -m "feat(helm): Matomo + MariaDB subchart (official images)"
```

---

## Task 2: Umbrella chart scaffold

**Files:** `helm/blog-engine/Chart.yaml`, `helm/blog-engine/values.yaml`, `helm/blog-engine/templates/_helpers.tpl`

- [ ] **Step 1: `helm/blog-engine/Chart.yaml`**

```yaml
apiVersion: v2
name: blog-engine
description: Stateless containerized Astro SSR blog engine, with optional self-hosted Matomo analytics
type: application
version: 0.1.0
appVersion: "0.1.0"
dependencies:
  - name: matomo
    version: 0.1.0
    repository: "file://./charts/matomo"
    condition: matomo.enabled
```

- [ ] **Step 2: `helm/blog-engine/values.yaml`**

```yaml
# -- Blog engine image (defaults to the chart appVersion when tag is empty).
image:
  repository: ghcr.io/OWNER/REPO
  tag: ""
  pullPolicy: IfNotPresent
imagePullSecrets: []

nameOverride: ""
fullnameOverride: ""

replicaCount: 2

serviceAccount:
  create: true
  name: ""

service:
  type: ClusterIP
  port: 80
  # ClientIP keeps a visitor on the pod that issued their captcha. Behind an
  # ingress this is best-effort — prefer ingress cookie affinity at scale.
  sessionAffinity: ClientIP

ingress:
  enabled: false
  className: ""
  host: blog.example.com
  annotations: {}
  tls:
    enabled: false
    secretName: ""

podDisruptionBudget:
  enabled: true
  minAvailable: 1

resources:
  requests:
    cpu: 50m
    memory: 128Mi
  limits:
    memory: 256Mi

podSecurityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]

nodeSelector: {}
tolerations: []
affinity: {}

# -- Rendered verbatim into /config/config.yaml. This IS the engine config.
config:
  site:
    title: "Blog Engine"
    description: "Personal log"
  content:
    repo: "https://github.com/you/blog-content.git"
    branch: "main"
    syncIntervalSeconds: 300
  analytics:
    enabled: false
    matomoUrl: ""
    siteId: 1

secrets:
  create: true
  existingSecret: ""
  data:
    CONTENT_REPO_TOKEN: ""
    CONTACT_WEBHOOK_URL: ""
    CV_WEBHOOK_URL: ""
    GITHUB_TOKEN: ""

# -- Optional Matomo + MariaDB subchart (see charts/matomo/values.yaml).
matomo:
  enabled: false
  image:
    repository: matomo
    tag: "5"
  persistence:
    size: 5Gi
  ingress:
    enabled: false
    host: analytics.example.com
  mariadb:
    auth:
      rootPassword: "change-me-root"
      database: matomo
      username: matomo
      password: "change-me"
    persistence:
      size: 8Gi
```

- [ ] **Step 3: `helm/blog-engine/templates/_helpers.tpl`**

```
{{- define "blog-engine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "blog-engine.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "blog-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "blog-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "blog-engine.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "blog-engine.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "blog-engine.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "blog-engine.secretName" -}}
{{- if .Values.secrets.existingSecret -}}{{ .Values.secrets.existingSecret }}{{- else -}}{{ include "blog-engine.fullname" . }}{{- end -}}
{{- end -}}

{{- define "blog-engine.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}{{ default (include "blog-engine.fullname" .) .Values.serviceAccount.name }}{{- else -}}{{ default "default" .Values.serviceAccount.name }}{{- end -}}
{{- end -}}
```

- [ ] **Step 4: Commit** (templates render in Task 3; just scaffold here)

```bash
git add helm/blog-engine/Chart.yaml helm/blog-engine/values.yaml helm/blog-engine/templates/_helpers.tpl
git commit -m "feat(helm): umbrella chart scaffold (Chart, values, helpers)"
```

---

## Task 3: Blog engine templates

**Files:** `helm/blog-engine/templates/{serviceaccount,configmap,secret,deployment,service,ingress,pdb}.yaml` + `NOTES.txt`

- [ ] **Step 1: `serviceaccount.yaml`**

```yaml
{{- if .Values.serviceAccount.create }}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "blog-engine.serviceAccountName" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
automountServiceAccountToken: false
{{- end }}
```

- [ ] **Step 2: `configmap.yaml`** (renders config.yaml; auto-defaults analytics.matomoUrl from the Matomo ingress host when both are set and the URL is empty)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
data:
  config.yaml: |
    {{- $config := deepCopy .Values.config -}}
    {{- if and .Values.matomo.enabled .Values.matomo.ingress.host (hasKey $config "analytics") -}}
    {{- if not $config.analytics.matomoUrl -}}
    {{- $_ := set $config.analytics "matomoUrl" (printf "https://%s" .Values.matomo.ingress.host) -}}
    {{- end -}}
    {{- end -}}
    {{ $config | toYaml | nindent 4 }}
```

- [ ] **Step 3: `secret.yaml`**

```yaml
{{- if and .Values.secrets.create (not .Values.secrets.existingSecret) }}
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
type: Opaque
stringData:
  {{- range $k, $v := .Values.secrets.data }}
  {{- if $v }}
  {{ $k }}: {{ $v | quote }}
  {{- end }}
  {{- end }}
{{- end }}
```

- [ ] **Step 4: `deployment.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      {{- include "blog-engine.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ .Values.config | toYaml | sha256sum }}
      labels:
        {{- include "blog-engine.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "blog-engine.serviceAccountName" . }}
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: blog
          image: {{ include "blog-engine.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          ports:
            - name: http
              containerPort: 4321
          envFrom:
            - secretRef:
                name: {{ include "blog-engine.secretName" . }}
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
            httpGet:
              path: /version
              port: http
            periodSeconds: 5
            failureThreshold: 30
          readinessProbe:
            httpGet:
              path: /version
              port: http
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /version
              port: http
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
```

- [ ] **Step 5: `service.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  {{- if .Values.service.sessionAffinity }}
  sessionAffinity: {{ .Values.service.sessionAffinity }}
  {{- end }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "blog-engine.selectorLabels" . | nindent 4 }}
```

- [ ] **Step 6: `ingress.yaml`**

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if .Values.ingress.className }}
  ingressClassName: {{ .Values.ingress.className }}
  {{- end }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ .Values.ingress.host | quote }}
      secretName: {{ .Values.ingress.tls.secretName | quote }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "blog-engine.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}
```

- [ ] **Step 7: `pdb.yaml`**

```yaml
{{- if and .Values.podDisruptionBudget.enabled (gt (int .Values.replicaCount) 1) }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "blog-engine.fullname" . }}
  labels:
    {{- include "blog-engine.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "blog-engine.selectorLabels" . | nindent 6 }}
{{- end }}
```

- [ ] **Step 8: `NOTES.txt`**

```
{{ .Chart.Name }} deployed as release "{{ .Release.Name }}".

Reach the blog:
{{- if .Values.ingress.enabled }}
  http{{ if .Values.ingress.tls.enabled }}s{{ end }}://{{ .Values.ingress.host }}
{{- else }}
  kubectl port-forward svc/{{ include "blog-engine.fullname" . }} 8080:{{ .Values.service.port }}
  then open http://localhost:8080  (version probe: /version)
{{- end }}

Captcha note: the slide-puzzle captcha + rate-limiter are in-memory per pod.
With replicaCount > 1 ({{ .Values.replicaCount }}), enable sticky routing at the
ingress (e.g. nginx: nginx.ingress.kubernetes.io/affinity: cookie) or run a
single replica, or captcha verification may hit a different pod and fail.
{{- if .Values.matomo.enabled }}

Matomo is enabled — see its notes; then set config.analytics.enabled=true and siteId.
{{- end }}
```

- [ ] **Step 9: Commit**

```bash
git add helm/blog-engine/templates
git commit -m "feat(helm): blog engine templates (deployment, service, ingress, config, secret, pdb)"
```

---

## Task 4: Verification script + render checks

**Files:** `scripts/helm-verify.sh`

- [ ] **Step 1: Create `scripts/helm-verify.sh`**

```bash
#!/usr/bin/env bash
# Lints the chart and renders it three ways, asserting key resources. Degrades
# gracefully when helm/kubeconform are not installed (CI/cluster will validate).
set -euo pipefail
CHART="helm/blog-engine"

if ! command -v helm >/dev/null; then
  echo "helm not installed — skipping render checks (validate in CI/cluster)"
  exit 0
fi

echo "== helm dependency build =="
helm dependency build "$CHART" >/dev/null

echo "== helm lint =="
helm lint "$CHART"

pass() { echo "  ok: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }

echo "== render: defaults =="
OUT=$(helm template r "$CHART")
echo "$OUT" | grep -q "kind: Deployment"        && pass "blog Deployment" || fail "blog Deployment"
echo "$OUT" | grep -q "path: /version"          && pass "/version probes" || fail "/version probes"
echo "$OUT" | grep -q "sessionAffinity: ClientIP" && pass "ClientIP affinity" || fail "ClientIP affinity"
echo "$OUT" | grep -q "kind: PodDisruptionBudget" && pass "PDB (replicas>1)" || fail "PDB"
echo "$OUT" | grep -q "config.yaml: |"          && pass "config ConfigMap" || fail "config ConfigMap"
echo "$OUT" | grep -q "kind: StatefulSet"       && fail "matomo present by default" || pass "no matomo by default"

echo "== render: matomo enabled =="
OUT=$(helm template r "$CHART" --set matomo.enabled=true)
echo "$OUT" | grep -q "kind: StatefulSet"           && pass "MariaDB StatefulSet" || fail "MariaDB StatefulSet"
echo "$OUT" | grep -q "image: \"matomo:5\""         && pass "matomo image" || fail "matomo image"
echo "$OUT" | grep -q "MATOMO_DATABASE_HOST"        && pass "matomo DB wiring" || fail "matomo DB wiring"

echo "== render: ingress + existingSecret =="
OUT=$(helm template r "$CHART" --set ingress.enabled=true --set secrets.existingSecret=mysecret)
echo "$OUT" | grep -q "kind: Ingress"   && pass "Ingress" || fail "Ingress"
echo "$OUT" | grep -q "secretRef" && echo "$OUT" | grep -q "name: mysecret" && pass "envFrom existingSecret" || fail "existingSecret ref"
if echo "$OUT" | grep -A3 "kind: Secret" | grep -q "Opaque"; then fail "chart Secret created despite existingSecret"; else pass "no chart Secret with existingSecret"; fi

if command -v kubeconform >/dev/null; then
  echo "== kubeconform =="
  helm template r "$CHART" --set matomo.enabled=true | kubeconform -strict -ignore-missing-schemas -summary
else
  echo "kubeconform not installed — skipping schema validation"
fi

echo "ALL HELM CHECKS PASSED"
```

- [ ] **Step 2: Make it executable + run it**

```bash
chmod +x scripts/helm-verify.sh
./scripts/helm-verify.sh
```
Expected: `ALL HELM CHECKS PASSED` (or the `helm not installed` skip message). If helm IS present and any assertion fails, fix the offending template, then re-run until it passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/helm-verify.sh
git commit -m "test(helm): chart lint + three-config render assertions"
```

---

## Task 5: Chart README + top-level pointer

**Files:** `helm/blog-engine/README.md`, root `README.md`

- [ ] **Step 1: Create `helm/blog-engine/README.md`**

````markdown
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
````

- [ ] **Step 2: Add a pointer to the root `README.md`**

After the "Run with Docker" section's closing paragraph (the line ending
"No volumes are required for content."), insert:

```markdown

## Deploy with Helm

A Helm chart lives in [`helm/blog-engine`](helm/blog-engine/) — a stateless blog Deployment
(HA-ready, `/version` probes, config via ConfigMap, secrets via Secret) with an optional
self-hosted Matomo + MariaDB subchart (`--set matomo.enabled=true`). See its
[README](helm/blog-engine/README.md), including the captcha/affinity note for multi-replica setups.
```

- [ ] **Step 3: Commit**

```bash
git add helm/blog-engine/README.md README.md
git commit -m "docs(helm): chart README + root README pointer"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Re-run the chart checks**

```bash
./scripts/helm-verify.sh
```
Expected: `ALL HELM CHECKS PASSED` (or the documented skip if helm is absent).

- [ ] **Step 2: Confirm the app suite is untouched**

```bash
npx vitest run 2>&1 | grep -E "Tests +[0-9]|FAIL"
```
Expected: the existing 98 tests still pass (this task added no app code).

- [ ] **Step 3: Static YAML sanity for the non-templated chart files** (works even without helm)

```bash
for f in helm/blog-engine/Chart.yaml helm/blog-engine/values.yaml helm/blog-engine/charts/matomo/Chart.yaml helm/blog-engine/charts/matomo/values.yaml; do
  node -e "require('js-yaml').load(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
done
```
Expected: all four print `OK`.

- [ ] **Step 4: Commit any fixes** (skip if none)

```bash
git add -A && git commit -m "fix(helm): address issues found during verification"
```

---

## Notes for the implementer

- **Blog hardening vs Matomo:** only the blog pod gets `runAsNonRoot` + `readOnlyRootFilesystem`
  (its image is built for that). Matomo/MariaDB official images need a root entrypoint — leave
  their security context at image defaults (the plan does).
- **Read-only root FS** needs the `tmp` + `cache` emptyDirs (provided). If a user hits a
  read-only-fs error, they can set `securityContext.readOnlyRootFilesystem=false`.
- **Local subchart + condition:** `charts/matomo` is physically present and also declared as a
  `file://` dependency so `matomo.enabled` toggles it; `helm dependency build` reconciles the lock.
- **No app code changes** — this is pure chart/docs. Don't modify `src/`.
- If `helm` is unavailable in this environment, the verify script and Task 6 Step 1 self-skip;
  rely on Step 3's YAML parse + careful template review, and note that `helm lint/template` must
  run where helm is installed.
