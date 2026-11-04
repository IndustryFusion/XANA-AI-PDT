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
"""Prompt templates, one file per model call.

Templates use `str.format` fields. Every value goes in as JSON inside a named
section, so operator text stays data: `<` is escaped, which keeps it from
closing a section.
"""

from __future__ import annotations

import json
from functools import cache
from importlib.resources import files
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage


@cache
def template(name: str) -> str:
    return files(__package__).joinpath(f"{name}.md").read_text(encoding="utf-8")


def data(value: Any) -> str:
    """JSON for a data section."""
    return json.dumps(value, ensure_ascii=False, indent=1, default=str).replace("<", "\\u003c")


def messages(name: str, **sections: Any) -> list[BaseMessage]:
    """The system prompt and the step's prompt with each value rendered as a data section."""
    body = template(name).format(**{key: data(value) for key, value in sections.items()})
    return [SystemMessage(template("system")), HumanMessage(body)]
