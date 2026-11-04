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
"""A chat model that answers with fixed, valid content and never calls a model.

Used by tests, CI and demos without a language model. Structured-output
requests get a registered example answer for the schema, or one derived from
the schema's fields.
"""

from __future__ import annotations

import types
import typing
from collections.abc import Callable
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel

SCRIPTED_TEXT = "Scripted answer: no language model is configured."

Answer = dict[str, Any] | Callable[[Any], dict[str, Any]]
_EXAMPLES: dict[type[BaseModel], Answer] = {}


def register_example(schema: type[BaseModel], answer: Answer) -> None:
    """Sets the answer the scripted model gives for `schema`.

    `answer` is the content as a dict, or a function of the prompt input that returns it.
    """
    _EXAMPLES[schema] = answer


def example_for(schema: type[BaseModel]) -> dict[str, Any]:
    """A minimal valid content for `schema`, derived from its fields."""
    return {
        name: _example_value(name, field.annotation)
        for name, field in schema.model_fields.items()
        if field.is_required()
    }


def _example_value(name: str, annotation: Any) -> Any:
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin is Literal:
        return args[0]
    if origin in (typing.Union, types.UnionType):
        options = [a for a in args if a is not type(None)]
        return None if len(options) < len(args) else _example_value(name, options[0])
    if origin in (list, tuple, set):
        return [_example_value(name, args[0])] if args and _is_model(args[0]) else []
    if origin is dict:
        return {}
    if _is_model(annotation):
        return example_for(annotation)
    if annotation is bool:
        return False
    if annotation is int:
        return 1
    if annotation is float:
        return 0.5
    return f"Scripted {name.replace('_', ' ')}"


def _is_model(annotation: Any) -> bool:
    return isinstance(annotation, type) and issubclass(annotation, BaseModel)


class ScriptedChatModel(BaseChatModel):
    """Chat model with fixed answers; makes no network request."""

    text: str = SCRIPTED_TEXT

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _generate(
        self, messages: list[BaseMessage], stop: list[str] | None = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self.text))])

    def with_structured_output(self, schema: Any, **kwargs: Any) -> RunnableLambda:
        if not _is_model(schema):
            raise TypeError("The scripted model supports Pydantic schemas only")

        def answer(prompt: Any) -> BaseModel:
            content = _EXAMPLES.get(schema)
            if callable(content):
                content = content(prompt)
            return schema.model_validate(content if content is not None else example_for(schema))

        return RunnableLambda(answer)
