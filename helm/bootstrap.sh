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
# Downloads the pinned helmfile to helm/helmfile (git-ignored), checking its SHA-256. Does nothing when that
# version is already there. Then run ./helmfile from helm/.
#
#   ./bootstrap.sh
set -euo pipefail

readonly VERSION="1.1.9"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE
readonly TARGET="$HERE/helmfile"
# Where the archives come from; a test can point it at a local copy.
readonly BASE_URL="${HELMFILE_DOWNLOAD_URL:-https://github.com/helmfile/helmfile/releases/download}"

fail() {
  echo "bootstrap.sh: $*" >&2
  exit 1
}

if [[ -x "$TARGET" ]] && "$TARGET" --version 2>/dev/null | grep -q "version v\?$VERSION\b"; then
  echo "helmfile $VERSION is already in $TARGET."
  exit 0
fi

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "no helmfile is pinned for $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "no helmfile is pinned for $(uname -m)" ;;
esac
# The release's own checksum for each archive.
case "${os}_${arch}" in
  linux_amd64) expected="ee71196bb12460905b8cbe0ef67b28db51ef681b777cc212d8c0956475b51905" ;;
  linux_arm64) expected="b74913be4ea86573e791f2f60a94b87e617ba60d51fa1695d8e935c6a56d7e11" ;;
  darwin_amd64) expected="ff16b5a951b93b382aff773e65b3477fd769fee7f67486214389f0f042aa1dea" ;;
  darwin_arm64) expected="b2ea2a12990ff0c0188b0d3fe2db683ef7a8af3c7f89a9f00dc9102421ce3808" ;;
esac

if command -v sha256sum >/dev/null; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "neither sha256sum nor shasum is installed, so the download can't be checked"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="helmfile_${VERSION}_${os}_${arch}.tar.gz"
echo "Downloading helmfile $VERSION for $os/$arch ..."
curl -fsSL -o "$work/$archive" "$BASE_URL/v$VERSION/$archive" || fail "downloading $archive failed"
actual="$(sha "$work/$archive")"
if [[ "$actual" != "$expected" ]]; then
  fail "the SHA-256 of $archive is $actual, not the pinned $expected; nothing was installed"
fi
tar -xzf "$work/$archive" -C "$work" helmfile || fail "$archive has no helmfile"
install -m 0755 "$work/helmfile" "$TARGET"
echo "Installed helmfile $VERSION in $TARGET."
