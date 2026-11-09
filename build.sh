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
# Builds the XANA images and pushes them to a registry, under the names the chart renders from
# imageRegistry and imageTag: <REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>.
#
#   ./build.sh [--no-push] [all|backend|frontend]
#
# REGISTRY (default k3d-iff.localhost:12345) and IMAGE_TAG (default latest) come from the shell,
# else from .env next to this script, at the repository root (see .env.example). Log in to the registry first.
set -euo pipefail

readonly DEFAULT_REGISTRY="k3d-iff.localhost:12345"
readonly DEFAULT_TAG="latest"
readonly CONFIG_KEYS="REGISTRY IMAGE_TAG"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
CONFIG="$HERE/.env"
readonly CONFIG

usage() {
  cat <<'TEXT'
Usage: ./build.sh [--no-push] [all|backend|frontend]

Builds the backend and frontend images (or the one named) and pushes them as
<REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>.

  --no-push   build only
  -h, --help  this text

REGISTRY defaults to k3d-iff.localhost:12345 and IMAGE_TAG to latest. Shell variables
win over .env next to this script, which holds KEY=VALUE lines for those two keys.
TEXT
}

fail() {
  echo "build.sh: $*" >&2
  exit 1
}

# Reads .env as data, never as shell code: KEY=VALUE lines for the known keys, comments and blank lines.
# Sets file_REGISTRY and file_IMAGE_TAG, and the line of each in line_REGISTRY and line_IMAGE_TAG;
# anything else stops the script, naming the line.
file_REGISTRY=""
file_IMAGE_TAG=""
# shellcheck disable=SC2034 # read by name in source_of
line_REGISTRY=""
# shellcheck disable=SC2034
line_IMAGE_TAG=""
read_config() {
  [[ -f "$CONFIG" ]] || return 0
  local number=0 line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    number=$((number + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*([A-Z_]+)=(.*)$ ]]; then
      fail "$CONFIG line $number is not KEY=VALUE: $line"
    fi
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [[ " $CONFIG_KEYS " != *" $key "* ]]; then
      fail "$CONFIG line $number sets $key; only $CONFIG_KEYS are read"
    fi
    # One pair of surrounding quotes is allowed, as an editor might add them.
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    printf -v "file_$key" '%s' "$value"
    printf -v "line_$key" '%s' "$number"
  done <"$CONFIG"
}

push=true
target=all
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-push) push=false ;;
    -h | --help)
      usage
      exit 0
      ;;
    all | backend | frontend) target="$1" ;;
    *)
      echo "build.sh: unknown option or target: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Where a setting came from, for a message about its value.
source_of() {
  local key="$1" line_var="line_$1" file_var="file_$1"
  if [[ -n "${!key:-}" ]]; then
    echo "from the shell ($key)"
  elif [[ -n "${!file_var}" ]]; then
    echo "from $CONFIG line ${!line_var}"
  else
    echo "the default"
  fi
}

# A registry as the first part of an image reference: host[:port] and optional path parts, as Docker reads
# them. No spaces, no empty path parts; path parts are lower case.
readonly HOST_PART='[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?'
readonly PATH_PART='[a-z0-9]+(([._]|__|-+)[a-z0-9]+)*'
readonly REGISTRY_FORM="^${HOST_PART}(\.${HOST_PART})*(:[0-9]{1,5})?(/${PATH_PART})*$"

read_config
registry="${REGISTRY:-${file_REGISTRY:-$DEFAULT_REGISTRY}}"
registry="${registry%/}"
tag="${IMAGE_TAG:-${file_IMAGE_TAG:-$DEFAULT_TAG}}"
[[ -n "$registry" ]] || fail "REGISTRY is empty"
if [[ ! "$registry" =~ $REGISTRY_FORM ]]; then
  fail "REGISTRY '$registry' $(source_of REGISTRY) is not a registry: use host[:port] with optional path parts, no spaces"
fi
if [[ ! "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  fail "IMAGE_TAG '$tag' $(source_of IMAGE_TAG) is not a valid image tag"
fi

case "$target" in
  all) names=(backend frontend) ;;
  *) names=("$target") ;;
esac

echo "Registry: $registry"
echo "Tag:      $tag"
for name in "${names[@]}"; do
  echo "Image:    $registry/xana-ai-pdt-$name:$tag"
done
$push || echo "Build only: nothing is pushed."

# Every image is built before any is pushed, so a failed build leaves the registry as it was.
for name in "${names[@]}"; do
  image="$registry/xana-ai-pdt-$name:$tag"
  echo "==> Building $image"
  docker build -t "$image" "$HERE/$name" || fail "building $image failed; nothing was pushed"
done
if $push; then
  for name in "${names[@]}"; do
    image="$registry/xana-ai-pdt-$name:$tag"
    echo "==> Pushing $image"
    docker push "$image" || fail "pushing $image failed (is the registry reachable, and are you logged in?)"
  done
fi
echo "Done."
