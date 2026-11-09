#!/usr/bin/env bash
# The checks are evaluated later, with the variables of each run: the single quotes are meant.
# shellcheck disable=SC2016,SC2034
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
# Tests of build.sh with `docker` replaced by a stub that records its calls. Run: helm/test/build_test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/build.sh"
passed=0
failed=0

# A copy of the script in an empty directory, with a docker stub first on PATH. The stub fails
# a call that matches the regular expression in STUB_FAIL.
setup() {
  work="$(mktemp -d)"
  cp "$SCRIPT" "$work/build.sh"
  mkdir -p "$work/backend" "$work/frontend" "$work/bin"
  cat >"$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$CALLS"
if [[ -n "${STUB_FAIL:-}" && "$*" =~ $STUB_FAIL ]]; then exit 1; fi
exit 0
STUB
  chmod +x "$work/bin/docker"
  export CALLS="$work/calls"
  : >"$CALLS"
}

run() {
  (cd "$work" && env -u REGISTRY -u IMAGE_TAG PATH="$work/bin:$PATH" "$@" >"$work/out" 2>&1)
  status=$?
}

check() {
  local name="$1"
  shift
  if "$@"; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    echo "FAIL: $name"
    echo "  output:"
    sed 's/^/    /' "$work/out"
    echo "  docker calls:"
    sed 's/^/    /' "$CALLS"
  fi
  rm -rf "$work"
}

calls_are() { diff <(printf '%s\n' "$@") <(sed "s|$work/||" "$CALLS") >/dev/null; }

setup; run ./build.sh
check "defaults build both images, then push both" eval '[[ $status == 0 ]] && calls_are \
  "build -t k3d-iff.localhost:12345/xana-ai-pdt-backend:latest backend" "build -t k3d-iff.localhost:12345/xana-ai-pdt-frontend:latest frontend" \
  "push k3d-iff.localhost:12345/xana-ai-pdt-backend:latest" "push k3d-iff.localhost:12345/xana-ai-pdt-frontend:latest"'

setup; run ./build.sh
check "registry, tag and names are printed before building" eval 'head -4 "$work/out" | diff - <(printf "%s\n" \
  "Registry: k3d-iff.localhost:12345" "Tag:      latest" \
  "Image:    k3d-iff.localhost:12345/xana-ai-pdt-backend:latest" "Image:    k3d-iff.localhost:12345/xana-ai-pdt-frontend:latest") >/dev/null'

setup; run env REGISTRY=reg.test:5000/team/ IMAGE_TAG=1.2.3 ./build.sh
check "registry and tag from the shell, trailing slash dropped" eval '[[ $status == 0 ]] && calls_are \
  "build -t reg.test:5000/team/xana-ai-pdt-backend:1.2.3 backend" "build -t reg.test:5000/team/xana-ai-pdt-frontend:1.2.3 frontend" \
  "push reg.test:5000/team/xana-ai-pdt-backend:1.2.3" "push reg.test:5000/team/xana-ai-pdt-frontend:1.2.3"'

setup; printf '# mine\n\nREGISTRY=file.test:5000\nIMAGE_TAG="from-file"\n' >"$work/.env"; run ./build.sh --no-push backend
check "values from the .env file" eval '[[ $status == 0 ]] && calls_are "build -t file.test:5000/xana-ai-pdt-backend:from-file backend"'

setup; printf 'REGISTRY=file.test:5000\nIMAGE_TAG=from-file\n' >"$work/.env"; run env IMAGE_TAG=from-shell ./build.sh --no-push backend
check "a shell variable wins over the .env file" eval '[[ $status == 0 ]] && calls_are "build -t file.test:5000/xana-ai-pdt-backend:from-shell backend"'

setup; printf 'REGISTRY=file.test:5000\nIMAGE_TAG=from-file\n' >"$work/.env"; run env REGISTRY=shell.test:5000 ./build.sh --no-push backend
check "a shell registry wins over the .env file" eval '[[ $status == 0 ]] && calls_are "build -t shell.test:5000/xana-ai-pdt-backend:from-file backend"'

setup; printf 'REGISTRY=file.test\nPATH=/nowhere\n' >"$work/.env"; run ./build.sh
check "another key in the .env file stops before building" eval '[[ $status != 0 ]] && grep -q "line 2 sets PATH" "$work/out" && [[ ! -s "$CALLS" ]]'

setup; printf 'REGISTRY=file.test\n$(touch %s/ran)\n' "$work" >"$work/.env"; run ./build.sh
check "a line that isn't KEY=VALUE stops, and nothing in the file runs" eval '[[ $status != 0 ]] && grep -q "line 2 is not KEY=VALUE" "$work/out" && [[ ! -e "$work/ran" && ! -s "$CALLS" ]]'

setup; printf 'export REGISTRY = file.test:5000  \nIMAGE_TAG= "spaced"\n' >"$work/.env"; run ./build.sh --no-push backend
check "a leading export and spaces around = are accepted" eval '[[ $status == 0 ]] && calls_are "build -t file.test:5000/xana-ai-pdt-backend:spaced backend"'

setup; printf 'export REGISTRY=$(touch %s/ran)\nIMAGE_TAG=`touch %s/ran`\n' "$work" "$work" >"$work/.env"; run ./build.sh
check "code in an exported value doesn't run" eval '[[ $status != 0 ]] && grep -q "line 1 is not a registry" "$work/out" && [[ ! -e "$work/ran" && ! -s "$CALLS" ]]'

setup; printf 'export PATH=/nowhere\n' >"$work/.env"; run ./build.sh
check "export of another key stops" eval '[[ $status != 0 ]] && grep -q "line 1 sets PATH" "$work/out" && [[ ! -s "$CALLS" ]]'

setup; run ./build.sh --no-push
check "build only pushes nothing" eval '[[ $status == 0 ]] && ! grep -q "^push" "$CALLS" && [[ $(grep -c "^build" "$CALLS") == 2 ]]'

setup; run ./build.sh frontend
check "one image builds only that image" eval '[[ $status == 0 ]] && calls_are \
  "build -t k3d-iff.localhost:12345/xana-ai-pdt-frontend:latest frontend" "push k3d-iff.localhost:12345/xana-ai-pdt-frontend:latest"'

setup; run ./build.sh --push-everything
check "an unknown option exits with 2 and the usage, and nothing runs" eval '[[ $status == 2 ]] && grep -q "unknown option" "$work/out" && grep -q "^Usage" "$work/out" && [[ ! -s "$CALLS" ]]'

setup; run env STUB_FAIL="^build .*/backend$" ./build.sh
check "a failed build stops with non-zero, naming it, before anything else" eval '[[ $status != 0 ]] && grep -q "building k3d-iff.localhost:12345/xana-ai-pdt-backend:latest failed" "$work/out" && (( $(wc -l <"$CALLS") == 1 ))'

setup; run env STUB_FAIL="^build .*/frontend$" ./build.sh
check "a failed build of the second image pushes neither" eval '[[ $status != 0 ]] && grep -q "nothing was pushed" "$work/out" && ! grep -q "^push" "$CALLS"'

setup; run env STUB_FAIL="^push .*xana-ai-pdt-backend" ./build.sh
check "a failed push stops with non-zero, naming it, and pushes nothing more" eval '[[ $status != 0 ]] && grep -q "pushing k3d-iff.localhost:12345/xana-ai-pdt-backend:latest failed" "$work/out" && ! grep -q "^push .*frontend" "$CALLS"'

setup; printf 'REGISTRY=crlf.test:5000\r\nIMAGE_TAG=from-windows\r\n' >"$work/.env"; run ./build.sh --no-push backend
check "a the .env file with Windows line ends is read" eval '[[ $status == 0 ]] && calls_are "build -t crlf.test:5000/xana-ai-pdt-backend:from-windows backend"'

for bad in "reg:5000 # mine" "reg:5000 " "reg//" "reg:5000/a//b" "reg:5000/Team"; do
  setup; run env REGISTRY="$bad" ./build.sh
  check "REGISTRY '$bad' from the shell is refused before building, naming it" eval '[[ $status != 0 ]] && grep -qF "REGISTRY '"'"'${bad%/}'"'"' from the shell (REGISTRY) is not a registry" "$work/out" && [[ ! -s "$CALLS" ]]'
done

setup; printf '# mine\nREGISTRY=reg.test:5000 # mine\n' >"$work/.env"; run ./build.sh
check "a bad REGISTRY in the .env file names its line" eval '[[ $status != 0 ]] && grep -q "from .*/.env line 2 is not a registry" "$work/out" && [[ ! -s "$CALLS" ]]'

setup; run env IMAGE_TAG="bad tag" ./build.sh
check "an invalid tag stops before building" eval '[[ $status != 0 ]] && grep -q "not a valid image tag" "$work/out" && [[ ! -s "$CALLS" ]]'

# The chart, rendered with the same registry and tag, names exactly the images the script makes.
if command -v helm >/dev/null; then
  setup; run env REGISTRY=reg.test:5000/team IMAGE_TAG=1.2.3 ./build.sh --no-push
  chart="$(cd "$(dirname "$SCRIPT")" && pwd)/helm/charts/xana-pdt"
  rendered="$(helm template x "$chart" --set imageRegistry=reg.test:5000/team --set imageTag=1.2.3 \
    --set backend.databaseCredentials.username=check --set backend.databaseCredentials.password=check \
    | sed -n 's/^ *image: //p' | sort -u)"
  check "the chart renders the images the script builds" eval 'diff <(echo "$rendered") \
    <(sed -n "s/^build -t \([^ ]*\) .*/\1/p" "$CALLS" | sort -u) >/dev/null'
else
  echo "SKIP: helm is not installed, so the chart's image names were not compared"
fi

echo "$passed passed, $failed failed"
[[ $failed == 0 ]]
