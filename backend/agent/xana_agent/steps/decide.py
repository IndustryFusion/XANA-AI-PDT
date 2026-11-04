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
"""DECIDE: the confidence gate. Proposes a root cause, or asks the operator for what is missing."""

from __future__ import annotations

from typing import Any

from xana_agent.schemas import Decision, Outcome, Question
from xana_agent.state import AgentState
from xana_agent.steps import Deps, ask, normalised, source_error, step

PAST_INCIDENTS = 3
MEMORY = "Incident memory"


async def decide(state: AgentState, deps: Deps) -> dict[str, Any]:
    run = state["input"]
    threshold = state["threshold"]
    validated = state["validated"]

    try:
        past = await deps.memory.similar(run.machine_id, state.get("machine_type"), PAST_INCIDENTS)
        n = len(past)
        memory = {"source": MEMORY, "status": "ok", "detail": f"{n} similar incident{'' if n == 1 else 's'} found."}
    except Exception as exc:
        past = []
        detail = f"{source_error(exc, MEMORY)} Decided without past incidents."
        memory = {"source": MEMORY, "status": "unavailable", "detail": detail}
    past_incidents = [
        {
            "incident_id": p.incident_id,
            "machine_id": p.machine_id,
            "issue": p.issue,
            "root_cause": p.root_cause,
            "resolution": p.resolution,
            "resolved_at": p.resolved_at.isoformat() if p.resolved_at else None,
        }
        for p in past[:PAST_INCIDENTS]
    ]

    # Rejected root causes and refuted hypotheses cannot become the decision. The highest
    # remaining confidence is both the number shown and the number the gate compares.
    rejected = {normalised(r.root_cause) for r in run.rejected}
    eligible = [h for h in validated if h["verdict"] != "refuted" and normalised(h["title"]) not in rejected]
    confidence = eligible[0]["confidence"] if eligible else 0.0

    output: dict[str, Any] = {
        "root_cause": None,
        "recommended_action": None,
        "confidence": confidence,
        "threshold": threshold,
        "question": None,
        "past_incidents": past_incidents,
        "sources": [memory],
    }
    if confidence < threshold:
        answer = await ask(
            deps, "decide", Question, "question", machine=state["machine"], issue=run.issue, hypotheses=validated
        )
        output["question"] = answer.question
        outcome = Outcome("awaiting_input", confidence=confidence, threshold=threshold, question=answer.question)
    else:
        answer = await ask(
            deps,
            "decide",
            Decision,
            "decide",
            machine=state["machine"],
            issue=run.issue,
            hypotheses=eligible,
            past_incidents=past_incidents,
        )
        # The model's choice counts only among the hypotheses that share the highest confidence.
        top = [h for h in eligible if h["confidence"] == confidence]
        chosen = next((h for h in top if h["id"] == answer.hypothesis_id), top[0])
        output |= {
            "root_cause": chosen["title"],
            "recommended_action": answer.recommended_action,
            "reasoning": answer.reasoning,
            "hypothesis_id": chosen["id"],
            "machine_type": state.get("machine_type"),
        }
        outcome = Outcome(
            "awaiting_confirmation",
            confidence=confidence,
            threshold=threshold,
            root_cause=chosen["title"],
            recommended_action=answer.recommended_action,
            decision=output,
        )
    return {"decision": output, "outcome": outcome, "step": step("decide", {"threshold": threshold}, output)}
