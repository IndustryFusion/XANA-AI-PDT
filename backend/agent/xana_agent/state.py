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
"""State of one workflow call, shared by the nodes of a graph."""

from __future__ import annotations

from typing import Any, TypedDict

from xana_agent.schemas import Outcome, RoundInput, StepEvent


class AgentState(TypedDict, total=False):
    input: RoundInput
    threshold: float
    # observe
    machine: dict[str, Any]  # compact facts of the machine, or {"id", "found": False}
    machine_type: str | None
    entities: dict[str, dict[str, Any]]  # compact facts by entity ID, machine included
    signals: list[dict[str, Any]]
    observation: dict[str, Any]
    history_missing: str | None  # why history could not be read, if it could not
    # hypothesize, validate, decide
    hypotheses: list[dict[str, Any]]
    validated: list[dict[str, Any]]
    decision: dict[str, Any]
    # act
    approved: dict[str, Any]
    trace: list[dict[str, Any]]
    # every node
    step: StepEvent
    outcome: Outcome
