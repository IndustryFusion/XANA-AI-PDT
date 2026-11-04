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
"""The workflow steps and what they share: dependencies, model calls and entity facts."""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, ValidationError

from xana_agent import prompts
from xana_agent.schemas import StepEvent
from xana_agent.sources.base import ContextSource, HistorySource, IncidentMemory, SourceUnavailable

RETRY_HINT = "Your previous answer did not match the requested structure. Answer again, in that structure only."


@dataclass(frozen=True)
class Deps:
    llm: BaseChatModel
    context: ContextSource
    history: HistorySource
    memory: IncidentMemory
    llm_timeout_s: float = 120
    history_window: timedelta = timedelta(hours=24)


class StepFailed(Exception):
    """A step cannot complete. `reason` is shown to the operator."""

    def __init__(self, node: str, reason: str) -> None:
        super().__init__(reason)
        self.node = node
        self.reason = reason


def step(node: str, input: dict[str, Any], output: dict[str, Any]) -> StepEvent:
    return StepEvent(node=node, input=input, output=output, at=datetime.now(UTC))


async def ask[Model: BaseModel](deps: Deps, node: str, schema: type[Model], prompt: str, **sections: Any) -> Model:
    """One structured model answer. Retries once when the answer does not match `schema`."""
    messages = prompts.messages(prompt, **sections)
    runnable = deps.llm.with_structured_output(schema)
    problem = "no answer"
    for _ in range(2):
        try:
            answer = await asyncio.wait_for(runnable.ainvoke(messages), deps.llm_timeout_s)
            if isinstance(answer, dict):
                answer = schema.model_validate(answer)
            if isinstance(answer, schema):
                return answer
        except TimeoutError:
            raise StepFailed(node, f"The language model did not answer within {deps.llm_timeout_s:g} s.") from None
        except ValidationError as exc:
            problem = f"{exc.error_count()} invalid field{'s' if exc.error_count() != 1 else ''}"
        except ValueError as exc:  # includes parser errors
            problem = type(exc).__name__
        except Exception as exc:
            if "timeout" in type(exc).__name__.lower():
                raise StepFailed(
                    node, f"The language model did not answer within its timeout ({type(exc).__name__})."
                ) from None
            raise StepFailed(node, f"The language model call failed ({type(exc).__name__}).") from None
        messages = [*messages, HumanMessage(RETRY_HINT)]
    raise StepFailed(
        node, f"The language model's answer did not match the expected structure twice in a row ({problem})."
    )


def source_error(exc: Exception, name: str) -> str:
    """A message about a failed source that is safe to show."""
    if isinstance(exc, SourceUnavailable):
        return str(exc)
    return f"{name} failed ({type(exc).__name__})."


# ── Entity facts ─────────────────────────────────────────────────────────────

_MAX_TEXT = 300


def attribute_value(attribute: Any) -> Any:
    """The value of an NGSI-LD attribute in compacted form, whatever its kind."""
    if isinstance(attribute, list):
        attribute = attribute[0] if attribute else None
    if not isinstance(attribute, dict):
        return attribute
    for key in ("value", "object", "json", "valueList", "vocab", "objectList"):
        if key in attribute:
            return attribute[key]
    if isinstance(attribute.get("languageMap"), dict):
        languages = attribute["languageMap"]
        return languages.get("en") or next(iter(languages.values()), None)
    return None


def entity_name(entity: dict[str, Any]) -> str:
    name = attribute_value(entity.get("name"))
    return name if isinstance(name, str) and name else re.split(r"[:/]", entity["id"])[-1]


def facts(entity: dict[str, Any]) -> dict[str, Any]:
    """A compact view of an entity for prompts: ID, type, name and attribute values with units."""
    attributes: dict[str, Any] = {}
    for key, attribute in entity.items():
        if key in ("id", "type", "@context", "name", "location"):
            continue
        value = attribute_value(attribute)
        if value is None:
            continue
        text = json.dumps(value, ensure_ascii=False, default=str) if not isinstance(value, str | int | float) else value
        if isinstance(text, str) and len(text) > _MAX_TEXT:
            text = text[:_MAX_TEXT] + "…"
        unit = attribute.get("unitCode") if isinstance(attribute, dict) else None
        attributes[key] = f"{text} {unit}" if unit else text
    return {"id": entity["id"], "type": entity.get("type"), "name": entity_name(entity), "attributes": attributes}


def numeric_attributes(entity: dict[str, Any]) -> list[tuple[str, float, str | None]]:
    """(attribute, value, unit) for every top-level Property with a number."""
    found = []
    for key, attribute in entity.items():
        if isinstance(attribute, dict) and attribute.get("type") == "Property":
            value = attribute.get("value")
            if isinstance(value, int | float) and not isinstance(value, bool):
                found.append((key, float(value), attribute.get("unitCode")))
    return found


def normalised(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()
