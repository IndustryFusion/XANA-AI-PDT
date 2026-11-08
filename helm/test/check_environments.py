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
"""Checks the layering of the localAndIonos environment: default.yaml, then production.yaml, then
localAndIonos.yaml, a later file winning. Needs helmfile and helm.

    python helm/test/check_environments.py helm

It renders a copy of helm/ in which production.yaml also sets a marker that localAndIonos.yaml doesn't,
so that production's own part of the layering shows. Then it checks that the check itself fails on a copy
with the order reversed.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

MARKER = "ProductionLayerMarker"


def render(helm_dir: Path) -> list[dict]:
    out = subprocess.run(
        ["helmfile", "-e", "localAndIonos", "template"], cwd=helm_dir, check=True, capture_output=True, text=True
    ).stdout
    return [d for d in yaml.safe_load_all(out) if d]


def problems(docs: list[dict], own: dict) -> list[str]:
    found = []
    config = next(d for d in docs if d["kind"] == "ConfigMap" and d["metadata"]["name"].endswith("-backend"))["data"]
    images = {c["image"] for d in docs if d["kind"] == "Deployment" for c in d["spec"]["template"]["spec"]["containers"]}
    tls = [t["secretName"] for d in docs if d["kind"] == "Ingress" for t in d["spec"].get("tls", [])]
    want = f"{own['imageRegistry']}/xana-ai-pdt-backend:{own['imageTag']}"
    if want not in images:
        found.append(f"imageTag and imageRegistry of localAndIonos.yaml don't win: {sorted(images)}")
    if tls != [own["ingressTlsSecret"]]:
        found.append(f"ingressTlsSecret of localAndIonos.yaml doesn't win over production's: {tls}")
    if config.get("NGSI_URL") != own["ngsiUrl"]:
        found.append(f"ngsiUrl of localAndIonos.yaml doesn't win over default's: {config.get('NGSI_URL')}")
    if config.get("MACHINE_WATCH_TYPE") != MARKER:
        found.append(f"a value set only in production.yaml isn't used: {config.get('MACHINE_WATCH_TYPE')}")
    return found


def prepared_copy(helm_dir: Path, reverse: bool) -> Path:
    copy = Path(tempfile.mkdtemp()) / "helm"
    shutil.copytree(helm_dir, copy)
    with (copy / "environment/production.yaml").open("a") as production:
        production.write(f"\nmachineWatchType: {MARKER}\n")
    if reverse:
        helmfile = copy / "helmfile.yaml.gotmpl"
        text = helmfile.read_text()
        layered = "      - environment/default.yaml\n      - environment/production.yaml\n      - environment/localAndIonos.yaml\n"
        assert layered in text, "the localAndIonos layering isn't in helmfile.yaml.gotmpl"
        reversed_ = "      - environment/localAndIonos.yaml\n      - environment/production.yaml\n      - environment/default.yaml\n"
        helmfile.write_text(text.replace(layered, reversed_))
    return copy


def main() -> None:
    helm_dir = Path(sys.argv[1]).resolve()
    own = yaml.safe_load((helm_dir / "environment/localAndIonos.yaml").read_text())
    assert MARKER != own.get("machineWatchType"), "localAndIonos.yaml must not set the marker"
    copy = prepared_copy(helm_dir, reverse=False)
    try:
        found = problems(render(copy), own)
    finally:
        shutil.rmtree(copy.parent)
    for problem in found:
        print("FAIL:", problem)
    if found:
        sys.exit(1)
    print("localAndIonos layering: ok")
    # The check has to be able to fail: with the order reversed, it must find problems.
    copy = prepared_copy(helm_dir, reverse=True)
    try:
        reversed_found = problems(render(copy), own)
    finally:
        shutil.rmtree(copy.parent)
    if not reversed_found:
        print("FAIL: the layering check found nothing with the order reversed")
        sys.exit(1)
    print(f"reversed order: fails as it should ({len(reversed_found)} problems)")
    # Placeholders only: every value is marked, and none looks like a secret.
    for key, value in own.items():
        text = str(value)
        if not (re.search(r"\.invalid(?:[:/]|$)", text) or "replace-me" in text):
            print(f"FAIL: {key} is not a marked placeholder: {text}")
            sys.exit(1)
        if re.search(r"(?i)secret|password|token|key$", key) and key != "ingressTlsSecret":  # a Secret's name
            print(f"FAIL: {key} looks like a secret and doesn't belong here")
            sys.exit(1)
    print("localAndIonos placeholders: ok")


if __name__ == "__main__":
    main()
