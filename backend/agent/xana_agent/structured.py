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
"""Getting a structured answer from a chat model.

Cloud providers do this well through `with_structured_output`. A local model on Ollama
is given the answer's JSON schema as its `format`, and may answer in its content or as
a tool call. An OpenAI-compatible server does not reliably support structured requests
(OpenVINO Model Server has been seen to crash on them), so it gets the schema in the
prompt. Both cases read the answer the same way.
"""

from __future__ import annotations

import json
import re
from typing import Any, Protocol

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

THINKING = re.compile(r"<think>.*?(</think>|$)", re.DOTALL)
SCHEMA_REQUEST = "Answer with one JSON object only, with no other text, that matches this JSON schema:\n{schema}"


class StructuredModel(Protocol):
    async def ainvoke(self, messages: list[Any]) -> Any: ...


def inline_references(schema: dict[str, Any]) -> dict[str, Any]:
    """The JSON schema with every `$ref` replaced by its definition, for servers that do not follow them."""
    definitions = schema.get("$defs", {})

    def expand(node: Any, seen: tuple[str, ...]) -> Any:
        if isinstance(node, list):
            return [expand(item, seen) for item in node]
        if not isinstance(node, dict):
            return node
        reference = node.get("$ref")
        if isinstance(reference, str):
            name = reference.rsplit("/", 1)[-1]
            if name in seen or name not in definitions:
                return {"type": "object"}  # a recursive model: stop at a plain object
            merged = {**definitions[name], **{k: v for k, v in node.items() if k != "$ref"}}
            return expand(merged, (*seen, name))
        return {key: expand(value, seen) for key, value in node.items() if key != "$defs"}

    return expand(schema, ())


def parse_answer(message: Any) -> dict[str, Any]:
    """The JSON object in a model's content, else the arguments of its first tool call.

    Reasoning in `<think>` tags is not part of the answer, and a broken object in the content
    doesn't hide a valid tool call. Anything else raises a ValueError: a malformed answer.
    """
    content = message.content if isinstance(message.content, str) else ""
    content = THINKING.sub("", content)
    start, end = content.find("{"), content.rfind("}")  # some models wrap the object in text or a code block
    broken: ValueError | None = None
    if start != -1 and end > start:
        try:
            answer = json.loads(content[start : end + 1])
        except ValueError as error:
            broken = error
        else:
            if isinstance(answer, dict):
                return answer
    for call in getattr(message, "tool_calls", None) or []:
        if isinstance(call.get("args"), dict) and call["args"]:
            return call["args"]
    raise broken or ValueError("The answer holds no JSON object")


class _OllamaStructured:
    def __init__(self, llm: BaseChatModel, schema: type[BaseModel]) -> None:
        self._model = llm.bind(format=inline_references(schema.model_json_schema()))

    async def ainvoke(self, messages: list[Any]) -> dict[str, Any]:
        return parse_answer(await self._model.ainvoke(messages))


class _PromptStructured:
    def __init__(self, llm: BaseChatModel, schema: type[BaseModel]) -> None:
        self._model = llm
        text = json.dumps(inline_references(schema.model_json_schema()))
        self._request = HumanMessage(SCHEMA_REQUEST.format(schema=text))

    async def ainvoke(self, messages: list[Any]) -> dict[str, Any]:
        return parse_answer(await self._model.ainvoke([*messages, self._request]))


def structured_model(llm: BaseChatModel, schema: type[BaseModel]) -> StructuredModel:
    """A runnable that answers with `schema`, as an object or a dict the caller validates."""
    if llm._llm_type == "chat-ollama":
        return _OllamaStructured(llm, schema)
    if getattr(llm, "openai_api_base", None):
        return _PromptStructured(llm, schema)
    return llm.with_structured_output(schema)
