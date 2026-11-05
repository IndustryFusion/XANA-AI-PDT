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
"""ACT: logs the confirmed incident. Runs only through Workflow.act, after the operator confirmed."""

from __future__ import annotations

from typing import Any

from xana_agent.schemas import IncidentRecord, Outcome
from xana_agent.state import AgentState
from xana_agent.steps import Deps, StepFailed, source_error, step

ACTION = "Incident logged with the confirmed resolution"


async def act(state: AgentState, deps: Deps) -> dict[str, Any]:
    run = state["input"]
    decision = state["approved"]
    record = IncidentRecord(
        machine_id=run.machine_id,
        machine_type=decision.get("machine_type"),
        issue=run.issue,
        root_cause=decision["root_cause"],
        recommended_action=decision.get("recommended_action") or "",
        confidence=decision.get("confidence"),
        trace=state.get("trace", []),
    )
    try:
        incident_id = await deps.memory.store(record)
    except Exception as exc:
        reason = f"The incident was not logged: {source_error(exc, 'Incident memory')}"
        raise StepFailed("act", reason) from None
    output = {
        "action": ACTION,
        "recommended_action": record.recommended_action,
        "incident_logged": True,
        "incident_id": incident_id,
    }
    outcome = Outcome(
        "completed",
        confidence=record.confidence,
        root_cause=record.root_cause,
        recommended_action=record.recommended_action,
        incident_id=incident_id,
        decision=decision,
    )
    return {"outcome": outcome, "step": step("act", {"decision": record.root_cause}, output)}
