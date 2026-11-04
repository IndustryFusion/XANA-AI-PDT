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
"""OBSERVE: the machine, its related entities and their recent history. No model call."""

from __future__ import annotations

from typing import Any

from xana_agent.sources.base import SignalHistory
from xana_agent.state import AgentState
from xana_agent.steps import Deps, entity_name, facts, numeric_attributes, source_error, step

MAX_ENTITIES = 20
MAX_SIGNALS = 30
BROKER = "Context broker"
TIMESERIES = "Time-series database"


async def observe(state: AgentState, deps: Deps) -> dict[str, Any]:
    run = state["input"]
    sources: list[dict[str, Any]] = []
    partial = False
    machine: dict[str, Any] | None = None
    related: list[dict[str, Any]] = []

    try:
        machine = await deps.context.get(run.machine_id)
    except Exception as exc:
        sources.append({"source": BROKER, "status": "unavailable", "detail": source_error(exc, BROKER)})
        partial = True
    else:
        if machine is None:
            sources.append({"source": BROKER, "status": "ok", "detail": f"Machine {run.machine_id} not found."})
            partial = True
        else:
            try:
                related = await deps.context.related(machine, MAX_ENTITIES - 1)
                detail = f"Machine and {_count(len(related), 'related entity', 'related entities')} read."
                sources.append({"source": BROKER, "status": "ok", "detail": detail})
            except Exception as exc:
                detail = f"Machine read; related entities could not be read: {source_error(exc, BROKER)}"
                sources.append({"source": BROKER, "status": "unavailable", "detail": detail})
                partial = True

    entities = [machine, *related][:MAX_ENTITIES] if machine else []
    entity_ids = [e["id"] for e in entities] or [run.machine_id]

    window_h = deps.history_window.total_seconds() / 3600
    history: list[SignalHistory] = []
    history_missing = None
    try:
        history = await deps.history.recent(entity_ids, deps.history_window)
        detail = (
            f"{window_h:g} h of history read for {_count(len(history), 'signal', 'signals')}."
            if history
            else f"No history in the last {window_h:g} h."
        )
        sources.append({"source": TIMESERIES, "status": "ok", "detail": detail})
    except Exception as exc:
        history_missing = source_error(exc, TIMESERIES)
        sources.append({"source": TIMESERIES, "status": "unavailable", "detail": history_missing})
        partial = True

    signals = _signals(entities, history)
    machine_type = _machine_type(machine)
    output = {
        "summary": _summary(run.machine_id, machine, related, signals, history, history_missing, sources, window_h),
        "signals": signals,
        "sources": sources,
        "partial_data": partial,
        "entities": [e["id"] for e in entities],
        "machine_found": machine is not None,
        "machine_type": machine_type,
    }
    return {
        "machine": facts(machine) if machine else {"id": run.machine_id, "found": False},
        "machine_type": machine_type,
        "entities": {e["id"]: facts(e) for e in entities},
        "signals": signals,
        "observation": output,
        "history_missing": history_missing,
        "step": step("observe", {"machine_id": run.machine_id, "issue": run.issue}, output),
    }


def _signals(entities: list[dict[str, Any]], history: list[SignalHistory]) -> list[dict[str, Any]]:
    by_key = {(h.entity_id, h.attribute): h for h in history}
    names = {e["id"]: entity_name(e) for e in entities}
    signals: list[dict[str, Any]] = []

    def add(entity_id: str, attribute: str, value: float, unit: str | None) -> None:
        past = by_key.pop((entity_id, attribute), None)
        name = names.get(entity_id, entity_id)
        signals.append(
            {
                "name": name if attribute == "value" else f"{name} {attribute}",
                "value": value,
                "unit": unit,
                "assessment": past.trend if past else "no history",
                "entity_id": entity_id,
                "attribute": attribute,
            }
        )

    for entity in entities:
        for attribute, value, unit in numeric_attributes(entity):
            add(entity["id"], attribute, value, unit)
    for (entity_id, attribute), past in list(by_key.items()):
        add(entity_id, attribute, past.last, None)
    return signals[:MAX_SIGNALS]


def _machine_type(machine: dict[str, Any] | None) -> str | None:
    if not machine:
        return None
    declared = machine.get("machineType")
    value = declared.get("value") if isinstance(declared, dict) else declared
    return value if isinstance(value, str) and value else machine.get("type")


def _summary(
    machine_id: str,
    machine: dict[str, Any] | None,
    related: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    history: list[SignalHistory],
    history_missing: str | None,
    sources: list[dict[str, Any]],
    window_h: float,
) -> str:
    if machine:
        parts = [f"Read {entity_name(machine)} and {_count(len(related), 'related entity', 'related entities')}"]
    elif sources[0]["status"] == "ok":
        parts = [f"Machine {machine_id} not found in the context broker; continuing with the issue text"]
    else:
        parts = ["Context broker unavailable; continuing with the issue text"]
    if history_missing:
        parts.append("history unavailable, continuing with partial data")
    elif history:
        parts.append(f"{_count(len(signals), 'signal', 'signals')} with up to {window_h:g} h of history")
    else:
        parts.append(f"no history in the last {window_h:g} h")
    return "; ".join(parts) + "."


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"
