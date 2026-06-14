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
echo "$OUT" | grep -q "kind: Deployment"          && pass "blog Deployment" || fail "blog Deployment"
echo "$OUT" | grep -q "path: /version"            && pass "/version probes" || fail "/version probes"
echo "$OUT" | grep -q "sessionAffinity: ClientIP" && pass "ClientIP affinity" || fail "ClientIP affinity"
echo "$OUT" | grep -q "kind: PodDisruptionBudget" && pass "PDB (replicas>1)" || fail "PDB"
echo "$OUT" | grep -q "config.yaml: |"            && pass "config ConfigMap" || fail "config ConfigMap"
if echo "$OUT" | grep -q "kind: StatefulSet"; then fail "matomo present by default"; else pass "no matomo by default"; fi

echo "== render: replicaCount=1 drops the PDB =="
if helm template r "$CHART" --set replicaCount=1 | grep -q "kind: PodDisruptionBudget"; then
  fail "PDB present at replicaCount=1"
else
  pass "no PDB at replicaCount=1"
fi

echo "== render: matomo enabled =="
OUT=$(helm template r "$CHART" --set matomo.enabled=true)
echo "$OUT" | grep -q "kind: StatefulSet"     && pass "MariaDB StatefulSet" || fail "MariaDB StatefulSet"
echo "$OUT" | grep -q 'image: "matomo:5"'     && pass "matomo image" || fail "matomo image"
echo "$OUT" | grep -q "MATOMO_DATABASE_HOST"  && pass "matomo DB wiring" || fail "matomo DB wiring"

echo "== render: matomo ingress host auto-fills analytics.matomoUrl =="
helm template r "$CHART" --set matomo.enabled=true --set matomo.ingress.host=an.example.com \
  | grep -q "matomoUrl: https://an.example.com" && pass "analytics URL auto-default" || fail "analytics URL auto-default"

echo "== render: ingress + existingSecret =="
OUT=$(helm template r "$CHART" --set ingress.enabled=true --set secrets.existingSecret=mysecret)
echo "$OUT" | grep -q "kind: Ingress" && pass "Ingress" || fail "Ingress"
echo "$OUT" | grep -q "name: mysecret" && pass "envFrom existingSecret" || fail "existingSecret ref"
# A chart-managed blog Secret must NOT be created when existingSecret is set.
# (The blog Secret is named after the release; matomo is disabled here, so any
#  Opaque Secret would be the blog's.)
if echo "$OUT" | grep -q "kind: Secret"; then fail "chart Secret created despite existingSecret"; else pass "no chart Secret with existingSecret"; fi

if command -v kubeconform >/dev/null; then
  echo "== kubeconform =="
  helm template r "$CHART" --set matomo.enabled=true | kubeconform -strict -ignore-missing-schemas -summary
else
  echo "kubeconform not installed — skipping schema validation"
fi

echo "ALL HELM CHECKS PASSED"
