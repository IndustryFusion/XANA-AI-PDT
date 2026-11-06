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
"""Structured answers from a local model: schema as format, answers from content or a tool call."""

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from xana_agent.schemas import HypothesisList
from xana_agent.structured import inline_references, parse_answer, structured_model


class Inner(BaseModel):
    value: int


class Outer(BaseModel):
    inner: Inner
    many: list[Inner]


def test_references_are_inlined():
    schema = inline_references(Outer.model_json_schema())
    assert "$defs" not in schema
    assert "$ref" not in str(schema)
    assert schema["properties"]["inner"]["properties"]["value"]["type"] == "integer"
    assert schema["properties"]["many"]["items"]["properties"]["value"]["type"] == "integer"


def test_a_recursive_schema_stops():
    schema = {"$ref": "#/$defs/N", "$defs": {"N": {"type": "object", "properties": {"next": {"$ref": "#/$defs/N"}}}}}
    assert inline_references(schema) == {"type": "object", "properties": {"next": {"type": "object"}}}


def test_workflow_schemas_have_no_references_left():
    assert "$ref" not in str(inline_references(HypothesisList.model_json_schema()))


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (AIMessage(content='{"value": 1}'), {"value": 1}),
        (AIMessage(content='```json\n{"value": 2}\n```'), {"value": 2}),
        (AIMessage(content="", tool_calls=[{"name": "answer", "args": {"value": 3}, "id": "1"}]), {"value": 3}),
    ],
)
def test_answer_forms(message, expected):
    assert parse_answer(message) == expected


@pytest.mark.parametrize(
    "message",
    [AIMessage(content=""), AIMessage(content="[1, 2]"), AIMessage(content="not json")],
)
def test_malformed_answers_raise_value_error(message):
    with pytest.raises(ValueError):
        parse_answer(message)


class FakeOllama:
    _llm_type = "chat-ollama"

    def __init__(self):
        self.bound = None

    def bind(self, **kwargs):
        self.bound = kwargs
        return self

    async def ainvoke(self, messages):
        return AIMessage(content="", tool_calls=[{"name": "answer", "args": {"value": 7}, "id": "1"}])

    def with_structured_output(self, schema):
        raise AssertionError("not used on Ollama")


async def test_ollama_gets_the_schema_as_format():
    llm = FakeOllama()
    assert await structured_model(llm, Inner).ainvoke([]) == {"value": 7}
    assert llm.bound["format"]["properties"]["value"]["type"] == "integer"


class FakeCompatibleServer:
    _llm_type = "openai-chat"
    openai_api_base = "http://ovms/v3"

    def __init__(self):
        self.messages = None

    async def ainvoke(self, messages):
        self.messages = messages
        return AIMessage(content='Here it is: {"value": 8} I hope that helps.')

    def with_structured_output(self, schema):
        raise AssertionError("a structured request can crash the server")


async def test_compatible_server_gets_the_schema_in_the_prompt():
    llm = FakeCompatibleServer()
    assert await structured_model(llm, Inner).ainvoke([]) == {"value": 8}
    assert '"value"' in llm.messages[-1].content


def test_other_providers_use_structured_output():
    class Other:
        _llm_type = "other"

        def with_structured_output(self, schema):
            return schema

    assert structured_model(Other(), Inner) is Inner
