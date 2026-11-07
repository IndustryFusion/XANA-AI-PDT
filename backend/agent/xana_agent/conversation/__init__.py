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
"""The agent that helps an operator answer a machine builder.

Apart from the diagnostic workflow. It reads and it answers: it holds no way of reaching the dataspace, and
its protocol tools only prepare a suggestion for the operator. It keeps nothing between turns: each starts
from what the caller stored, so a restart loses nothing.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from xana_agent.sources.base import AlertSource, ContextSource, HistorySource, IncidentMemory
from xana_agent.steps import Deps, StepFailed, ask, source_error

log = logging.getLogger(__name__)

MAX_TOOL_CALLS = 6
MAX_RESULT = 4000
HISTORY_WINDOW = timedelta(hours=24)
BUCKET = timedelta(hours=1)

DATA_TOOLS = ("read_entity", "read_related", "read_history", "similar_incidents", "active_alerts")
ONTOLOGY_TOOLS = ("ontology_query", "ontology_shapes", "ontology_knowledge")
PROTOCOL_TOOLS = {
    "send_inform": "inform",
    "send_request": "request",
    "send_escalate": "escalate",
    "send_deescalate": "deescalate",
    "send_close": "close",
}
UI_TOOLS = ("open_inbox", "open_outbox", "set_response")
ToolName = Literal[
    "read_entity",
    "read_related",
    "read_history",
    "similar_incidents",
    "active_alerts",
    "ontology_query",
    "ontology_shapes",
    "ontology_knowledge",
    "send_inform",
    "send_request",
    "send_escalate",
    "send_deescalate",
    "send_close",
    "open_inbox",
    "open_outbox",
    "set_response",
]


class AgentAction(BaseModel):
    """One action of a turn: a tool with its arguments, or `set_response` with the reply."""

    tool: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class ConversationInput:
    machine_id: str
    issue: str
    question: str
    messages: list[dict[str, Any]]
    allowed_entities: list[str]
    tier: str | None = None
    builder: str | None = None
    machine_type: str | None = None
    # What XANA diagnosed in this run: root cause, confidence, top hypotheses, the machine's active alerts.
    diagnosis: dict[str, Any] | None = None


@dataclass
class ConversationReply:
    reply: str
    suggestions: list[dict[str, Any]] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)


class _State(TypedDict, total=False):
    actions: list[dict[str, Any]]
    action: dict[str, Any]
    reply: str
    suggestions: list[dict[str, Any]]
    tools: list[str]


OntologyCall = Callable[[str], Awaitable[dict[str, Any]]]


def _bounded(value: Any) -> Any:
    text = str(value)
    return value if len(text) <= MAX_RESULT else {"truncated": text[:MAX_RESULT]}


class ConversationAgent:
    def __init__(
        self,
        llm: BaseChatModel,
        context: ContextSource,
        history: HistorySource,
        memory: IncidentMemory,
        alerts: AlertSource | None = None,
        ontology: Any = None,
        llm_timeout_s: float = 120,
        callbacks: Sequence[Any] = (),
    ) -> None:
        self._deps = Deps(llm, context, history, memory, llm_timeout_s, HISTORY_WINDOW, alerts)
        self._ontology = ontology
        self._callbacks = list(callbacks)

    async def answer(self, turn: ConversationInput) -> ConversationReply:
        """One turn. `StepFailed` if the model can't be used. Sends nothing, and can't."""
        graph = self._graph(turn)
        state = await graph.ainvoke(
            {"actions": [], "suggestions": [], "tools": []},
            {"callbacks": self._callbacks, "recursion_limit": 3 * MAX_TOOL_CALLS + 6},
        )
        reply = state.get("reply") or "I could not finish that within the calls I have. Please ask a narrower question."
        return ConversationReply(reply, state.get("suggestions", []), state.get("tools", []))

    def _graph(self, turn: ConversationInput):
        graph = StateGraph(_State)

        async def think(state: _State) -> dict[str, Any]:
            if len(state["actions"]) >= MAX_TOOL_CALLS:
                return {"action": {}, "reply": None}
            action = await ask(
                self._deps,
                "conversation",
                AgentAction,
                "conversation",
                machine={"machine_id": turn.machine_id, "machine_type": turn.machine_type, "issue": turn.issue},
                builder={"name": turn.builder, "sharing_tier": turn.tier},
                diagnosis=turn.diagnosis or {"none": "This run has no diagnosis yet."},
                conversation=turn.messages,
                question=turn.question,
                earlier_actions=state["actions"],
            )
            return {"action": action.model_dump()}

        async def tool(state: _State) -> dict[str, Any]:
            action = state["action"]
            name, arguments = action["tool"], action.get("arguments") or {}
            used = [*state["tools"], name]
            if name == "set_response":
                return {"reply": str(arguments.get("text") or ""), "tools": used}
            suggestions = list(state["suggestions"])
            result = await self._run_tool(turn, name, arguments, suggestions)
            actions = [*state["actions"], {"tool": name, "arguments": arguments, "result": _bounded(result)}]
            return {"actions": actions, "suggestions": suggestions, "tools": used}

        def after_think(state: _State) -> str:
            return "tool" if state.get("action") else END

        def after_tool(state: _State) -> str:
            return END if state.get("reply") else "think"

        graph.add_node("think", think)
        graph.add_node("tool", tool)
        graph.add_edge(START, "think")
        graph.add_conditional_edges("think", after_think)
        graph.add_conditional_edges("tool", after_tool)
        return graph.compile()

    async def _run_tool(
        self, turn: ConversationInput, name: str, arguments: dict[str, Any], suggestions: list[dict[str, Any]]
    ) -> Any:
        if name in PROTOCOL_TOOLS:
            suggestion = {"act": PROTOCOL_TOOLS[name], "text": str(arguments.get("text") or "")}
            if name == "send_close":
                suggestion["outcome"] = str(arguments.get("outcome") or "resolved")
            suggestions.append(suggestion)
            return {"prepared": True, "note": "Prepared for the operator, who decides. Nothing was sent."}
        if name == "open_inbox":
            return [m for m in turn.messages if m.get("sender") == "machine_builder"]
        if name == "open_outbox":
            return [m for m in turn.messages if m.get("sender") == "operator" and not m.get("internal")]
        try:
            return await self._read(turn, name, arguments)
        except StepFailed:
            raise
        except Exception as error:  # noqa: BLE001 - a source failing is an answer the model can work with
            return {"ok": False, "error": source_error(error, name)}

    async def _read(self, turn: ConversationInput, name: str, arguments: dict[str, Any]) -> Any:
        deps = self._deps
        if name in ONTOLOGY_TOOLS:
            return await self._read_ontology(name, arguments)
        if name == "similar_incidents":
            found = await deps.memory.similar(turn.machine_id, turn.machine_type, 3)
            return [item.model_dump(mode="json") for item in found]
        entity_id = str(arguments.get("entity_id") or turn.machine_id)
        if entity_id not in turn.allowed_entities:
            return {"ok": False, "error": f"{entity_id} isn't among the entities of this run, so it isn't read."}
        if name == "active_alerts":
            return await deps.alerts.active(entity_id) if deps.alerts else []
        if name == "read_entity":
            return await deps.context.get(entity_id)
        if name == "read_related":
            entity = await deps.context.get(entity_id)
            related = await deps.context.related(entity, 20) if entity else []
            return [item for item in related if item.get("id") in turn.allowed_entities]
        if name == "read_history":
            return await self._read_history(entity_id, arguments.get("attribute"))
        return {"ok": False, "error": f"There is no tool {name}."}

    async def _read_history(self, entity_id: str, attribute: Any) -> Any:
        history = self._deps.history
        if attribute:
            buckets = await history.metrics(entity_id, str(attribute), HISTORY_WINDOW, BUCKET)
            return [bucket.model_dump(mode="json") for bucket in buckets]
        return [signal.model_dump(mode="json") for signal in await history.recent([entity_id], HISTORY_WINDOW)]

    async def _read_ontology(self, name: str, arguments: dict[str, Any]) -> Any:
        if self._ontology is None:
            return {"ok": False, "error": "No ontology is available."}
        if name == "ontology_query":
            return await self._call(self._ontology.query, str(arguments.get("sparql") or ""))
        function = self._ontology.shapes if name == "ontology_shapes" else self._ontology.knowledge
        return await self._call(function, str(arguments.get("entity_type") or ""))

    @staticmethod
    async def _call(function: Callable[[str], Any], value: str) -> Any:
        answer = function(value)
        return await answer if inspect.isawaitable(answer) else answer
