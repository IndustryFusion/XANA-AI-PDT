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
"""HYPOTHESIZE: two or three ranked hypotheses for the issue."""

from __future__ import annotations

from typing import Any

from xana_agent.schemas import HypothesisList
from xana_agent.state import AgentState
from xana_agent.steps import Deps, ask, step

MAX_HYPOTHESES = 3


async def hypothesize(state: AgentState, deps: Deps) -> dict[str, Any]:
    run = state["input"]
    observation = state["observation"]
    rejected = [r.model_dump() for r in run.rejected]

    step_input: dict[str, Any] = {"observations": len(observation["signals"])}
    if run.clarifications:
        step_input["clarification"] = run.clarifications[-1]
        step_input["clarifications"] = list(run.clarifications)
    if rejected:
        step_input["rejected_root_causes"] = [r["root_cause"] for r in rejected]
        step_input["reason"] = rejected[-1]["reason"]
        step_input["rejected"] = rejected

    answer = await ask(
        deps,
        "hypothesize",
        HypothesisList,
        "hypothesize",
        machine=state["machine"],
        issue=run.issue,
        observations={
            "summary": observation["summary"],
            "entities": list(state["entities"].values()),
            "signals": observation["signals"],
            "alerts": observation.get("alerts", []),
            "changes": observation.get("changes", []),
            "lifecycle": observation.get("lifecycle", []),
            "sources": observation["sources"],
        },
        clarifications=run.clarifications,
        rejected=rejected,
    )
    ranked = sorted(answer.hypotheses, key=lambda h: h.confidence, reverse=True)[:MAX_HYPOTHESES]
    hypotheses = [
        {"id": f"h{run.round}-{n}", "title": h.title, "confidence": h.confidence, "evidence": h.evidence}
        for n, h in enumerate(ranked, start=1)
    ]
    return {"hypotheses": hypotheses, "step": step("hypothesize", step_input, {"hypotheses": hypotheses})}
