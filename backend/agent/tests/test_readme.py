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
import re
import subprocess
import sys
from pathlib import Path

README = Path(__file__).parents[1] / "README.md"


def test_readme_example_runs():
    example = re.findall(r"```python\n(.*?)```", README.read_text(encoding="utf-8"), re.DOTALL)[0]
    result = subprocess.run([sys.executable, "-c", example], capture_output=True, text=True, timeout=60)  # noqa: S603
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert [line.split()[0] for line in lines[:4]] == ["observe", "hypothesize", "validate", "decide"]
    assert lines[4].startswith("awaiting_confirmation")
    assert lines[5] == "completed incident-1"
