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
# Checks envs/iff-cluster.sh against the local test cluster, whose Secrets helm/test/stand-ins.yaml makes. Needs
# kubectl pointed at that cluster; IFF_NAMESPACE names the namespace the stand-ins are in (default iff).
#
#   helm/test/iff_cluster_test.sh
set -uo pipefail

HELM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
passed=0
failed=0
ok() { passed=$((passed + 1)); }
fail() { failed=$((failed + 1)); echo "FAIL: $1"; }
has() { [[ "$out" == *"$1"* ]]; }

# Sources the helper in a clean shell, in an empty directory with an empty home, so that a file it wrote would
# show. Prints the helper's output, its status and then each variable as name=value.
run_sourced() {
  # shellcheck disable=SC2016 # expanded by the inner shell
  (cd "$dir" && env -i PATH="$PATH" HOME="$home" KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}" \
    IFF_NAMESPACE="${IFF_NAMESPACE:-iff}" "$@" bash -c '
    source "$1/envs/iff-cluster.sh" 2>&1
    echo "status:$?"
    for v in ALERTA_API_KEY KEYCLOAK_SERVICE_CLIENT_SECRET OPENAI_API_KEY GATEWAY_CLIENT_SECRET; do
      echo "value:$v=${!v:-}"
    done
    echo end' _ "$HELM")
}

dir="$(mktemp -d)"
home="$(mktemp -d)"
out="$(run_sourced)"
if has "value:ALERTA_API_KEY=local-test-alerta-key"; then ok; else fail "exports the alerta key"; fi
if has "value:KEYCLOAK_SERVICE_CLIENT_SECRET=local-test-client-secret"; then ok; else fail "exports the client secret"; fi
if has "value:OPENAI_API_KEY=local-test-openai-key"; then ok; else fail "exports a key of the backend's Secret"; fi
if has "GATEWAY_CLIENT_SECRET: key GATEWAY_CLIENT_SECRET not in Secret xana-pdt-credentials" &&
  has "value:GATEWAY_CLIENT_SECRET="$'\n'; then ok; else fail "reports a missing key by name and exports nothing for it"; fi
if [[ "$(grep -v '^value:' <<<"$out")" != *local-test-* ]]; then ok; else fail "prints no secret value"; fi
# kubectl keeps its own cache under the home directory; no file anywhere holds a secret.
if [[ -z "$(ls -A "$dir")" ]] && ! grep -rq local-test- "$home"; then ok; else fail "writes no file"; fi
rm -rf "$dir" "$home"

dir="$(mktemp -d)"
home="$(mktemp -d)"
out="$(run_sourced ALERTA_API_KEY=mine)"
if has "value:ALERTA_API_KEY=mine" && has "ALERTA_API_KEY: already set, kept"; then ok; else fail "keeps a variable already set"; fi
rm -rf "$dir" "$home"

dir="$(mktemp -d)"
home="$(mktemp -d)"
out="$(run_sourced IFF_ALERTA_SECRET=no-such-secret)"
if has "ALERTA_API_KEY: Secret no-such-secret not found" && has "value:ALERTA_API_KEY="$'\n' &&
  has "value:KEYCLOAK_SERVICE_CLIENT_SECRET=local-test-client-secret"; then ok
else fail "reports a missing Secret and goes on"; fi
rm -rf "$dir" "$home"

dir="$(mktemp -d)"
home="$(mktemp -d)"
out="$(run_sourced KUBECONFIG="$dir/missing")"
if has "nothing was exported" && has "status:" && has "value:ALERTA_API_KEY="$'\n'; then ok
else fail "a cluster it can't reach exports nothing, and the shell goes on"; fi
rm -rf "$dir" "$home"

echo "$passed passed, $failed failed"
[[ $failed == 0 ]]
