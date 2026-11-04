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
import ast
import subprocess
import sys
from pathlib import Path

import xana_agent

PACKAGE = Path(xana_agent.__file__).parent


def _imports(path: Path) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module.split(".")[0])
    return names


def test_package_never_imports_the_service():
    offenders = [str(p.relative_to(PACKAGE)) for p in PACKAGE.rglob("*.py") if {"app", "fastapi"} & _imports(p)]
    assert offenders == []


def test_importing_the_package_loads_no_service_module():
    code = "import sys, xana_agent; print(sorted(m for m in sys.modules if m == 'app' or m.startswith('app.')))"
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)  # noqa: S603
    assert result.stdout.strip() == "[]"


def test_prompts_are_installed_with_the_package():
    names = {p.stem for p in (PACKAGE / "prompts").glob("*.md")}
    assert {"system", "hypothesize", "validate_plan", "validate", "question", "decide"} <= names
