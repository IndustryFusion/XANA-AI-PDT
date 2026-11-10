#!/usr/bin/env bash
#
# Copyright (c) 2026 IndustryFusion Foundation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Checks, on the local test cluster, that the backend in XANA's namespace gets its secrets from that namespace
# only: its Deployment names no Secret but the chart's own two; the database URLs are built from the chart's
# Secret, with the credentials read when deploying from the operator's Secret in iff; and the secretLookups
# variables arrive, read when deploying from a Secret in xana-pdt and one in iff.
# Prints no secret. Needs kubectl pointed at the cluster.
#
#   helm/test/check_cluster_secrets.sh xana-pdt
set -euo pipefail

namespace="${1:-xana-pdt}"
deployment=deploy/xana-pdt-backend
failed=0
fail() { failed=1; echo "FAIL: $1"; }

# Every Secret the Deployment names: secretKeyRef, envFrom and volumes.
names="$(kubectl -n "$namespace" get "$deployment" -o json | python3 -c '
import json, sys
spec = json.load(sys.stdin)["spec"]["template"]["spec"]
names = {v["secret"]["secretName"] for v in spec.get("volumes", []) if "secret" in v}
for c in spec["containers"]:
    names |= {e["secretRef"]["name"] for e in c.get("envFrom", []) if "secretRef" in e}
    names |= {e["valueFrom"]["secretKeyRef"]["name"] for e in c.get("env", []) if "secretKeyRef" in e.get("valueFrom", {})}
print(" ".join(sorted(names)))')"
echo "Secrets the backend names: $names"
[[ "$names" == "xana-pdt-backend xana-pdt-database" ]] ||
  fail "the backend names a Secret other than the chart's own two"
for name in $names; do
  kubectl -n "$namespace" get secret "$name" -o name >/dev/null || fail "Secret $name is not in $namespace"
done

# shellcheck disable=SC2016 # expanded in the Pod
kubectl -n "$namespace" exec "$deployment" -- sh -c '
  case "$TIMESCALE_DB_URL" in postgresql://xana:p%40ss%3Aw%2Frd%20%25%2Bx@acid-cluster.iff.svc.cluster.local:5432/tsdb) ;; *) exit 1;; esac
  case "$POSTGRES_MEMORY_URL" in postgresql://xana:p%40ss%3Aw%2Frd%20%25%2Bx@acid-cluster.iff.svc.cluster.local:5432/memory) ;; *) exit 1;; esac' ||
  fail "the database URLs aren't built from the chart's Secret, percent-encoded, for acid-cluster.iff.svc.cluster.local"

[[ "$(kubectl -n "$namespace" exec "$deployment" -- printenv EVENT_WEBHOOK_SECRET)" == local-test-webhook-secret ]] ||
  fail "the secretLookups variable from xana-pdt didn't arrive"
[[ "$(kubectl -n "$namespace" exec "$deployment" -- printenv ALERTA_API_KEY)" == local-test-alerta-key ]] ||
  fail "the secretLookups variable from iff didn't arrive"

# The backend reaches both databases, and the stand-in context broker in iff: its health report says so.
kubectl -n "$namespace" exec "$deployment" -- python -c '
import httpx, sys
checks = {c["id"]: c["status"] for c in httpx.get("http://localhost:8000/api/diagnostics?fresh=true").json()["checks"]}
wanted = {k: checks.get(k) for k in ("memory", "timeseries", "broker")}
print("health:", wanted)
sys.exit(any(v != "ok" for v in wanted.values()))' || fail "the backend doesn't reach both databases and the broker"

[[ $failed == 0 ]] && echo "secrets from the release's namespace only: ok"
[[ $failed == 0 ]]
