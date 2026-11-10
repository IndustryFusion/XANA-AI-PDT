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
"""Checks the two environments: production is default.yaml, then production.yaml, a later file winning, and
production.yaml holds only its overrides; and the removed localAndIonos stops with a message naming the two.
Renders offline (KUBECONFIG=/dev/null), with test database credentials. Needs helm, and helm/helmfile
(./bootstrap.sh) or helmfile on PATH.

    python helm/test/check_environments.py helm

The layering check is also run on a copy with the order reversed, where it has to find problems.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

OVERRIDES = {"imageTag", "imagePullPolicy", "ingressTlsSecret"}
ENV = os.environ | {"KUBECONFIG": os.devnull, "DATABASE_USERNAME": "check", "DATABASE_PASSWORD": "check"}


def helmfile(helm_dir: Path, environment: str) -> subprocess.CompletedProcess:
    binary = str(helm_dir / "helmfile") if (helm_dir / "helmfile").exists() else "helmfile"
    return subprocess.run([binary, "-e", environment, "template"], cwd=helm_dir, capture_output=True, text=True, env=ENV)


def render(helm_dir: Path, environment: str) -> list[dict]:
    result = helmfile(helm_dir, environment)
    if result.returncode:
        raise AssertionError(result.stderr[-2000:])
    return [d for d in yaml.safe_load_all(result.stdout) if d]


def problems(docs: list[dict], default: dict, production: dict) -> list[str]:
    found = []
    config = next(d for d in docs if d["kind"] == "ConfigMap" and d["metadata"]["name"].endswith("-backend"))["data"]
    images = {c["image"] for d in docs if d["kind"] == "Deployment" for c in d["spec"]["template"]["spec"]["containers"]}
    tls = [t["secretName"] for d in docs if d["kind"] == "Ingress" for t in d["spec"].get("tls", [])]
    if f"{default['imageRegistry']}/xana-ai-pdt-backend:{production['imageTag']}" not in images:
        found.append(f"production's imageTag doesn't win over default's: {sorted(images)}")
    if tls != [production["ingressTlsSecret"]]:
        found.append(f"production's ingressTlsSecret doesn't win over default's: {tls}")
    if config.get("NGSI_URL") != default["ngsiUrl"]:
        found.append(f"a value only default.yaml sets isn't used: {config.get('NGSI_URL')}")
    return found


def main() -> None:
    helm_dir = Path(sys.argv[1]).resolve()
    failures = []
    default = yaml.safe_load((helm_dir / "environment/default.yaml").read_text())
    production = yaml.safe_load((helm_dir / "environment/production.yaml").read_text())
    if set(production) != OVERRIDES:
        failures.append(f"production.yaml holds {sorted(production)}, not only {sorted(OVERRIDES)}")
    defined = re.findall(r"^  (\w+):\n    values:", (helm_dir / "helmfile.yaml.gotmpl").read_text(), re.M)
    if defined != ["default", "production"]:
        failures.append(f"the environments are {defined}, not default and production")
    if (helm_dir / "environment/localAndIonos.yaml").exists():
        failures.append("environment/localAndIonos.yaml is still there")
    failures += problems(render(helm_dir, "production"), default, production)
    result = helmfile(helm_dir, "localAndIonos")
    if result.returncode == 0 or not all(
        s in result.stderr for s in ("localAndIonos was removed", "-e default", "-e production")
    ):
        failures.append(f"-e localAndIonos doesn't stop with the message naming the two environments: {result.stderr[-500:]}")
    for problem in failures:
        print("FAIL:", problem)
    if failures:
        sys.exit(1)
    print("production layering, its overrides only, and the removed localAndIonos: ok")
    # The check has to be able to fail: with the order reversed, it must find problems.
    copy = Path(tempfile.mkdtemp()) / "helm"
    try:
        shutil.copytree(helm_dir, copy)
        helmfile_file = copy / "helmfile.yaml.gotmpl"
        layered = "      - environment/default.yaml\n      - environment/production.yaml\n"
        text = helmfile_file.read_text()
        assert layered in text, "the production layering isn't in helmfile.yaml.gotmpl"
        helmfile_file.write_text(text.replace(layered, "      - environment/production.yaml\n      - environment/default.yaml\n"))
        found = problems(render(copy, "production"), default, production)
    finally:
        shutil.rmtree(copy.parent)
    if not found:
        print("FAIL: the layering check found nothing with the order reversed")
        sys.exit(1)
    print(f"reversed order: fails as it should ({len(found)} problems)")


if __name__ == "__main__":
    main()
