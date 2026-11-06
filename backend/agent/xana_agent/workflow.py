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
"""The diagnostic workflow: two graphs and the functions that run them.

    analyse: observe → hypothesize → validate → decide
    act:     act

There is no edge from decide into act. The operator's confirmation happens
between the two calls, so an unconfirmed diagnosis cannot be logged. The
workflow keeps nothing between calls; the caller owns the run.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from datetime import timedelta
from typing import Any

from langchain_core.language_models import BaseChatModel
from langgraph.graph import END, START, StateGraph

from xana_agent.schemas import Outcome, RoundInput, StepEvent
from xana_agent.sources.base import ContextSource, HistorySource, IncidentMemory
from xana_agent.state import AgentState
from xana_agent.steps import Deps, StepFailed
from xana_agent.steps.act import act
from xana_agent.steps.decide import decide
from xana_agent.steps.hypothesize import hypothesize
from xana_agent.steps.observe import observe
from xana_agent.steps.validate import validate

log = logging.getLogger(__name__)

ANALYSIS = ("observe", "hypothesize", "validate", "decide")
Node = Callable[[AgentState, Deps], Awaitable[dict[str, Any]]]


def _bind(name: str, node: Node, deps: Deps) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
    async def run(state: AgentState) -> dict[str, Any]:
        try:
            return await node(state, deps)
        except StepFailed:
            raise
        except Exception as exc:
            log.exception("Step %s failed", name)
            raise StepFailed(name, f"Unexpected error in {name} ({type(exc).__name__}).") from None

    return run


def _graph(nodes: dict[str, Node], deps: Deps):
    graph = StateGraph(AgentState)
    previous = START
    for name, node in nodes.items():
        graph.add_node(name, _bind(name, node, deps))
        graph.add_edge(previous, name)
        previous = name
    graph.add_edge(previous, END)
    return graph.compile()


class Workflow:
    """Diagnoses an issue on one machine.

    `analyse` runs one round and `act` logs a confirmed incident. Both yield each
    completed step as a `StepEvent`, then one `Outcome`.
    """

    def __init__(
        self,
        llm: BaseChatModel,
        context: ContextSource,
        history: HistorySource,
        memory: IncidentMemory,
        threshold: float = 0.9,
        llm_timeout_s: float = 120,
        history_window: timedelta = timedelta(hours=24),
        callbacks: Sequence[Any] = (),
    ) -> None:
        if not 0 <= threshold <= 1:
            raise ValueError("threshold must be between 0 and 1")
        self.threshold = threshold
        self._callbacks = list(callbacks)
        deps = Deps(llm, context, history, memory, llm_timeout_s, history_window)
        nodes = {"observe": observe, "hypothesize": hypothesize, "validate": validate, "decide": decide}
        self._analysis = _graph(nodes, deps)
        self._act = _graph({"act": act}, deps)

    async def analyse(
        self, round_input: RoundInput, metadata: dict[str, Any] | None = None
    ) -> AsyncIterator[StepEvent | Outcome]:
        """One analysis round. Ends with `awaiting_input`, `awaiting_confirmation` or `failed`.

        `metadata` goes to the callbacks with every model call of the round.
        """
        state = {"input": round_input, "threshold": self.threshold}
        async for event in self._run(self._analysis, state, metadata):
            yield event

    async def act(
        self, round_input: RoundInput, decision: dict[str, Any], trace: list[dict[str, Any]]
    ) -> AsyncIterator[StepEvent | Outcome]:
        """Logs the incident after the operator confirmed `decision` (the decide step's output).

        `trace` is the run's step list so far, stored with the incident. Ends with
        `completed` or `failed`.
        """
        if not decision.get("root_cause"):
            raise ValueError("The decision has no root cause to confirm")
        state = {"input": round_input, "threshold": self.threshold, "approved": decision, "trace": trace}
        async for event in self._run(self._act, state):
            yield event

    async def _run(
        self, graph, state: dict[str, Any], metadata: dict[str, Any] | None = None
    ) -> AsyncIterator[StepEvent | Outcome]:
        outcome: Outcome | None = None
        config = {"callbacks": self._callbacks, "metadata": metadata or {}}
        try:
            async for chunk in graph.astream(state, config, stream_mode="updates"):
                for update in chunk.values():
                    if not update:
                        continue
                    if "step" in update:
                        yield update["step"]
                    outcome = update.get("outcome", outcome)
        except StepFailed as failure:
            yield Outcome("failed", node=failure.node, error=failure.reason)
            return
        yield outcome or Outcome("failed", error="The workflow ended without an outcome.")
