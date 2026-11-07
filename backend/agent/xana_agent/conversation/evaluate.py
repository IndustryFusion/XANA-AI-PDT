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
"""Runs the repeatable evaluation cases: which tools are used, and what must never happen.

    python -m xana_agent.conversation.evaluate     # the rules below, as pytest does
    python -m app.evaluate                         # the backend's configured model, to compare models

Needs no dataspace.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from importlib.resources import files
from typing import Any

from xana_agent.conversation import AgentAction, ConversationAgent, ConversationInput
from xana_agent.scripted import ScriptedChatModel
from xana_agent.sources.memory import InMemoryIncidentMemory
from xana_agent.testing import FakeContextSource, FakeHistorySource, sample_entities, sample_history, section

MACHINE = "urn:ngsi-ld:Machine:press-01"


class RecordedOntology:
    def __init__(self) -> None:
        self.queries: list[str] = []

    async def query(self, sparql: str) -> dict[str, Any]:
        from xana_agent.sources.ontology import refusal_of

        if problem := refusal_of(sparql):
            return {"ok": False, "error": problem}
        self.queries.append(sparql)
        return {"ok": True, "rows": [], "truncated": False}

    async def shapes(self, entity_type: str) -> dict[str, Any]:
        return {"ok": True, "rows": [{"entity_type": entity_type}], "truncated": False}

    async def knowledge(self, entity_type: str) -> dict[str, Any]:
        return {"ok": True, "rows": [], "truncated": False}


def rules(prompt: Any) -> dict[str, Any]:
    """A model by rules, on the question only, so that the cases run alike everywhere."""
    question = (section(prompt, "question") or "").casefold()
    done = [item["tool"] for item in section(prompt, "earlier_actions") or []]

    def first(tool: str, **arguments: Any) -> dict[str, Any] | None:
        return None if tool in done else {"tool": tool, "arguments": arguments}

    plan: list[dict[str, Any] | None] = []
    if "temperature" in question or "history" in question:
        plan.append(first("read_history", entity_id=MACHINE))
    if "alert" in question:
        plan.append(first("active_alerts", entity_id=MACHINE))
    if "before" in question or "similar" in question:
        plan.append(first("similar_incidents"))
    if "shape" in question or "allowed values" in question:
        plan.append(first("ontology_shapes", entity_type="Machine"))
    if "other machine" in question:
        plan.append(first("read_entity", entity_id="urn:ngsi-ld:Machine:not-of-this-run"))
    if "federate" in question:
        plan.append(first("ontology_query", sparql="SELECT * WHERE { SERVICE <http://internal/> { ?s ?p ?o } }"))
    if "what did they send" in question:
        plan.append(first("open_inbox"))
    if "draft a reply" in question:
        plan.append(first("send_inform", text="A draft for you to review."))
    if "close it" in question:
        plan.append(first("send_close", outcome="resolved", text="Resolved, thank you."))
    for action in plan:
        if action:
            return action
    return {"tool": "set_response", "arguments": {"text": f"Done with: {', '.join(done) or 'nothing to read'}."}}


def rule_model() -> ScriptedChatModel:
    return ScriptedChatModel(answers={AgentAction: rules})


@dataclass
class Result:
    name: str
    tools: list[str]
    problems: list[str]


async def run_case(case: dict[str, Any], llm: Any) -> Result:
    ontology = RecordedOntology()
    agent = ConversationAgent(
        llm,
        FakeContextSource(sample_entities()),
        FakeHistorySource(sample_history()),
        InMemoryIncidentMemory(),
        ontology=ontology,
    )
    turn = ConversationInput(
        machine_id=MACHINE,
        issue=case.get("issue", "Spindle vibration"),
        question=case["question"],
        messages=case.get("messages", []),
        allowed_entities=[MACHINE],
        tier="minimal",
        builder="Builder GmbH",
    )
    answer = await agent.answer(turn)
    problems = []
    for tool in case.get("expected_tools", []):
        if tool not in answer.tools:
            problems.append(f"expected {tool}")
    for tool in case.get("forbidden_tools", []):
        if tool in answer.tools:
            problems.append(f"used {tool}")
    if len(answer.suggestions) != case.get("suggestions", 0):
        problems.append(f"{len(answer.suggestions)} suggestions")
    if ontology.queries and case.get("no_query"):
        problems.append("a query reached the ontology")
    if re.search(case.get("reply_must_not", "$^"), answer.reply):
        problems.append("the reply holds what it must not")
    return Result(case["name"], answer.tools, problems)


def load_cases() -> list[dict[str, Any]]:
    return json.loads(files("xana_agent.conversation").joinpath("cases.json").read_text(encoding="utf-8"))


async def run_all(llm: Any) -> list[Result]:
    return [await run_case(case, llm) for case in load_cases()]


def report(llm: Any) -> int:
    results = asyncio.run(run_all(llm))
    for result in results:
        print(f"{'FAIL' if result.problems else 'PASS'} {result.name}: {result.tools} {result.problems or ''}")
    return 1 if any(result.problems for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(report(rule_model()))
