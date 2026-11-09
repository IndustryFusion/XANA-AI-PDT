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
# shellcheck shell=bash
# Source this from bash before helmfile: it reads the backend's secrets from the IFF cluster's Secrets with kubectl and
# exports them under the backend's variable names, for helm/values.yaml.gotmpl.
#
#   source helm/envs/iff-cluster.sh
#
# A variable already set and non-empty in the shell is kept, and exported so helmfile sees it. Nothing is
# written to disk, and only variable names and the kube context are printed.
# The database URLs aren't exported: the chart builds them in the Pod from the database operator's Secret.
#
# Overrides, all optional: IFF_NAMESPACE (default iff), and the Secrets' names IFF_ALERTA_SECRET (default alerta),
# IFF_KEYCLOAK_CLIENT_SECRET (default keycloak-client-secret-xana) and IFF_XANA_SECRET (default xana-pdt-credentials).
#
# It changes no shell option. A missing Secret or key is reported and skipped, and doesn't count as a failure.
# Sourcing fails (status 1), exporting nothing, when kubectl is missing or the namespace's Secrets can't be read,
# and when the shell isn't bash (zsh and others are refused with a message before anything runs). Under set -e
# that ends the shell that sources it; to go on regardless, use
#   source helm/envs/iff-cluster.sh || true

if [ -z "${BASH_VERSION:-}" ]; then
  echo "iff-cluster.sh: source it from bash; this shell isn't bash. Nothing was exported." >&2
  # shellcheck disable=SC2317 # exit is for a shell that ran the file instead of sourcing it
  return 1 2>/dev/null || exit 1
fi

# Reads one key of one Secret, decoded, into a variable unless that is already set. Prints what it did.
_iff_secret_into() {
  local variable="$1" secret="$2" key="$3" encoded value
  if [[ -n "${!variable:-}" ]]; then
    export "${variable?}"
    echo "  $variable: already set, kept"
    return 0
  fi
  if ! encoded="$(kubectl -n "$_iff_namespace" get secret "$secret" -o "jsonpath={.data.$key}" 2>/dev/null)"; then
    echo "  $variable: Secret $secret not found"
    return 0
  fi
  if [[ -z "$encoded" ]]; then
    echo "  $variable: key $key not in Secret $secret"
    return 0
  fi
  if ! value="$(printf '%s' "$encoded" | base64 -d 2>/dev/null)"; then
    echo "  $variable: key $key of Secret $secret could not be decoded"
    return 0
  fi
  export "$variable=$value"
  echo "  $variable: from Secret $secret"
}

_iff_export_secrets() {
  local _iff_namespace="${IFF_NAMESPACE:-iff}"
  local alerta="${IFF_ALERTA_SECRET:-alerta}"
  local client="${IFF_KEYCLOAK_CLIENT_SECRET:-keycloak-client-secret-xana}"
  local own="${IFF_XANA_SECRET:-xana-pdt-credentials}"
  if ! command -v kubectl >/dev/null; then
    echo "iff-cluster.sh: kubectl is not installed; nothing was exported." >&2
    return 1
  fi
  if ! kubectl -n "$_iff_namespace" get secrets -o name >/dev/null 2>&1; then
    echo "iff-cluster.sh: can't read Secrets in namespace $_iff_namespace (cluster: $(kubectl config current-context 2>/dev/null || echo none)); nothing was exported." >&2
    return 1
  fi
  echo "Secrets of namespace $_iff_namespace, kube context $(kubectl config current-context 2>/dev/null || echo none):"
  _iff_secret_into ALERTA_API_KEY "$alerta" alerta-admin-key
  _iff_secret_into KEYCLOAK_SERVICE_CLIENT_SECRET "$client" CLIENT_SECRET
  local variable
  for variable in GATEWAY_CLIENT_SECRET SETTINGS_ENCRYPTION_KEY EVENT_WEBHOOK_SECRET ANTHROPIC_API_KEY \
    OPENAI_API_KEY LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY; do
    _iff_secret_into "$variable" "$own" "$variable"
  done
}

# Runs, removes its functions, and returns the status, so `source ... || ...` sees a failure.
_iff_main() {
  local status=0
  _iff_export_secrets || status=$?
  unset -f _iff_secret_into _iff_export_secrets _iff_main
  return "$status"
}
_iff_main
