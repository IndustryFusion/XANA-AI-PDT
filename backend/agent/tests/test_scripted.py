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
from typing import Literal

import pytest
from pydantic import BaseModel, Field

from xana_agent import ScriptedChatModel, example_for, register_example


class Item(BaseModel):
    title: str
    score: float


class Answer(BaseModel):
    name: str
    kind: Literal["a", "b"]
    count: int
    items: list[Item]
    note: str | None
    tags: list[str] = Field(default_factory=list)


def test_structured_answer_is_valid_without_registration():
    result = ScriptedChatModel().with_structured_output(Answer).invoke("anything")
    assert isinstance(result, Answer)
    assert result.kind == "a"
    assert result.items[0].score == 0.5
    assert result.note is None


def test_registered_answer_wins():
    register_example(Item, {"title": "Bearing wear", "score": 0.8})
    assert ScriptedChatModel().with_structured_output(Item).invoke("x").title == "Bearing wear"
    register_example(Item, lambda prompt: {"title": str(prompt), "score": 0.1})
    assert ScriptedChatModel().with_structured_output(Item).invoke("echo").title == "echo"


def test_plain_answer():
    assert "Scripted" in ScriptedChatModel().invoke("hello").content


def test_example_for_only_required_fields():
    assert "tags" not in example_for(Answer)


def test_rejects_non_pydantic_schema():
    with pytest.raises(TypeError):
        ScriptedChatModel().with_structured_output({"type": "object"})
