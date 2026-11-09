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
# shellcheck disable=SC2016 # the inner shells expand $HELPER and the rest
set -uo pipefail

HELM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${KUBECONFIG:-$HOME/.kube/config}"
passed=0
failed=0
ok() { passed=$((passed + 1)); }
fail() { failed=$((failed + 1)); echo "FAIL: $1"; }
has() { [[ "$out" == *"$1"* ]]; }

# Runs a shell script in a clean environment, in an empty directory with an empty home, so that a file the
# helper wrote would show. $HELPER in the script is the helper's path. Extra arguments are NAME=value settings.
in_clean_shell() {
  local script="$1"
  shift
  (cd "$dir" && env -i PATH="$PATH" HOME="$home" KUBECONFIG="$CONFIG" IFF_NAMESPACE="${IFF_NAMESPACE:-iff}" \
    HELPER="$HELM/envs/iff-cluster.sh" "$@" bash -c "$script" 2>&1)
}

# Sources the helper, then prints its status and each variable as name=value, as a child process sees it.
SOURCED='source "$HELPER"
echo "status:$?"
for v in ALERTA_API_KEY KEYCLOAK_SERVICE_CLIENT_SECRET OPENAI_API_KEY GATEWAY_CLIENT_SECRET; do
  echo "value:$v=$(printenv "$v")"
done
echo end'

fresh() { dir="$(mktemp -d)"; home="$(mktemp -d)"; }
clean() { rm -rf "$dir" "$home"; }

fresh
out="$(in_clean_shell "$SOURCED")"
if has "value:ALERTA_API_KEY=local-test-alerta-key"; then ok; else fail "exports the alerta key"; fi
if has "value:KEYCLOAK_SERVICE_CLIENT_SECRET=local-test-client-secret"; then ok; else fail "exports the client secret"; fi
if has "value:OPENAI_API_KEY=local-test-openai-key"; then ok; else fail "exports a key of the backend's Secret"; fi
if has "GATEWAY_CLIENT_SECRET: key GATEWAY_CLIENT_SECRET not in Secret xana-pdt-credentials" &&
  has "value:GATEWAY_CLIENT_SECRET="$'\n'; then ok; else fail "reports a missing key by name and exports nothing for it"; fi
if has "status:0"; then ok; else fail "a missing key isn't a failure"; fi
if has "kube context "; then ok; else fail "names the kube context it reads from"; fi
if [[ "$(grep -v '^value:' <<<"$out")" != *local-test-* ]]; then ok; else fail "prints no secret value"; fi
# kubectl keeps its own cache under the home directory; no file anywhere holds a secret.
if [[ -z "$(ls -A "$dir")" ]] && ! grep -rq local-test- "$home"; then ok; else fail "writes no file"; fi
clean

fresh
out="$(in_clean_shell "$SOURCED" ALERTA_API_KEY=mine)"
if has "value:ALERTA_API_KEY=mine" && has "ALERTA_API_KEY: already set, kept"; then ok; else fail "keeps a variable already set"; fi
clean

fresh
out="$(in_clean_shell "ALERTA_API_KEY=mine-not-exported
$SOURCED")"
if has "value:ALERTA_API_KEY=mine-not-exported"; then ok; else fail "exports a variable set but not exported"; fi
clean

fresh
out="$(in_clean_shell "$SOURCED" IFF_ALERTA_SECRET=no-such-secret)"
if has "ALERTA_API_KEY: Secret no-such-secret not found" && has "value:ALERTA_API_KEY="$'\n' &&
  has "value:KEYCLOAK_SERVICE_CLIENT_SECRET=local-test-client-secret"; then ok
else fail "reports a missing Secret and goes on"; fi
clean

fresh
out="$(in_clean_shell "$SOURCED" KUBECONFIG="$dir/missing")"
if has "nothing was exported" && has "status:1" && has "value:ALERTA_API_KEY="$'\n'; then ok
else fail "a cluster it can't reach exports nothing and fails"; fi
out="$(in_clean_shell 'set -e; source "$HELPER"; echo after' KUBECONFIG="$dir/missing")"
if ! has "after"; then ok; else fail "under set -e, a failure ends the shell"; fi
out="$(in_clean_shell 'set -e; source "$HELPER" || echo went-on' KUBECONFIG="$dir/missing")"
if has "went-on"; then ok; else fail "source ... || sees the failure"; fi
clean

fresh
out="$(cd "$dir" && env -i PATH="$PATH" HOME="$home" KUBECONFIG="$CONFIG" sh -c \
  ". '$HELM/envs/iff-cluster.sh'; echo status:\$?; echo value:\$(printenv ALERTA_API_KEY)" 2>&1)"
if has "isn't bash" && has "status:1" && [[ "$out" == *"value:" ]]; then ok; else fail "another shell is refused, exporting nothing"; fi
clean

echo "$passed passed, $failed failed"
[[ $failed == 0 ]]
