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
"""Fake data sources and scripted step answers, for tests, demos and standalone use.

Scripted answers read the data sections of the prompt (hypotheses, signals,
clarifications, rejected root causes), so a scripted run reacts to the
round's input the way the workflow expects a model to.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from statistics import fmean, pstdev
from typing import Any, Literal

from xana_agent.schemas import (
    Decision,
    HypothesisList,
    Question,
    ValidatedHypothesisList,
    ValidationPlan,
)
from xana_agent.scripted import ScriptedChatModel, register_example
from xana_agent.sources.base import (
    AttributeChange,
    Bucket,
    LifecycleEvent,
    Observation,
    SignalHistory,
    SourceUnavailable,
    trend,
)
from xana_agent.sources.ngsi import relationship_objects
from xana_agent.steps import normalised

# ── Scripted answers ─────────────────────────────────────────────────────────

CANDIDATES = [
    (
        "Wear of a moving component",
        "Inspect the moving components named in the evidence and replace worn parts.",
    ),
    ("Cooling or supply problem", "Check coolant level, flow and filters; clean or replace clogged filters."),
    ("Sensor or calibration fault", "Compare the sensor against a reference measurement and recalibrate it."),
    ("Changed process parameters", "Compare the current program and settings with the last known good ones."),
]
ACTIONS = dict(CANDIDATES)
QUESTION = (
    "When did the issue start, and did anything change on the machine shortly before (maintenance, material, settings)?"
)

Mode = Literal["confident", "low", "clarified"]


def section(prompt: Any, name: str) -> Any:
    """The JSON value of a data section (`<name>…</name>`) in a prompt, or None."""
    messages = prompt if isinstance(prompt, list) else [prompt]
    text = "\n".join(str(getattr(m, "content", m)) for m in messages)
    match = re.search(rf"<{name}>\n(.*?)\n</{name}>", text, re.DOTALL)
    return json.loads(match.group(1)) if match else None


class StepScript:
    """Scripted answers for every step, keyed by schema; pass to `ScriptedChatModel(answers=...)`.

    - `confident`: the leading hypothesis is confirmed with 0.92.
    - `low`: the leading hypothesis stays at 0.6.
    - `clarified`: low until the operator added information, then confident.

    Rejected root causes are never proposed again. `calls` records each answer's schema name.
    """

    def __init__(self, mode: Mode = "confident") -> None:
        self.mode = mode
        self.calls: list[str] = []

    def answers(self) -> dict[type, Any]:
        return {
            HypothesisList: self.hypotheses,
            ValidationPlan: self.plan,
            ValidatedHypothesisList: self.validated,
            Question: self.question,
            Decision: self.decision,
        }

    def model(self) -> ScriptedChatModel:
        return ScriptedChatModel(answers=self.answers())

    def hypotheses(self, prompt: Any) -> dict[str, Any]:
        self.calls.append("HypothesisList")
        rejected = {normalised(r["root_cause"]) for r in section(prompt, "rejected") or []}
        titles = [t for t, _ in CANDIDATES if normalised(t) not in rejected] or [t for t, _ in CANDIDATES]
        signals = (section(prompt, "observations") or {}).get("signals", [])
        evidence = [f"{s['name']}: {s['value']} ({s['assessment']})" for s in signals[:2]] or ["Issue description"]
        return {
            "hypotheses": [
                {"title": title, "confidence": confidence, "evidence": evidence}
                for title, confidence in zip(titles[:3], (0.7, 0.5, 0.3), strict=False)
            ]
        }

    def plan(self, prompt: Any) -> dict[str, Any]:
        self.calls.append("ValidationPlan")
        hypotheses = section(prompt, "hypotheses") or []
        signals = section(prompt, "signals") or []
        entities = section(prompt, "entities") or []
        lead = hypotheses[0]["id"] if hypotheses else "h1-1"
        return {
            "queries": [
                {"hypothesis_id": lead, "entity_id": s["entity_id"], "attribute": s["attribute"]} for s in signals[:3]
            ],
            "lookups": [{"hypothesis_id": lead, "entity_id": e["id"]} for e in entities[:1]],
        }

    def validated(self, prompt: Any) -> dict[str, Any]:
        self.calls.append("ValidatedHypothesisList")
        hypotheses = section(prompt, "hypotheses") or []
        results = section(prompt, "results") or []
        confident = self.mode == "confident" or (self.mode == "clarified" and bool(section(prompt, "clarifications")))
        read = [r for r in results if "error" not in r]
        cited = f"Checked {len(read)} of {len(results)} planned data checks." if results else "No data checks ran."
        leading = (0.92, "confirmed") if confident else (0.6, "plausible")
        others = [(0.4, "plausible"), (0.15, "refuted")]
        return {
            "hypotheses": [
                {"id": h["id"], "confidence": confidence, "verdict": verdict, "validation": cited}
                for h, (confidence, verdict) in zip(hypotheses, [leading, *others], strict=False)
            ]
        }

    def question(self, prompt: Any) -> dict[str, Any]:
        self.calls.append("Question")
        return {"question": QUESTION}

    def decision(self, prompt: Any) -> dict[str, Any]:
        self.calls.append("Decision")
        hypotheses = section(prompt, "hypotheses") or [{"id": "h1-1", "title": CANDIDATES[0][0]}]
        lead = hypotheses[0]
        return {
            "hypothesis_id": lead["id"],
            "recommended_action": ACTIONS.get(lead["title"], CANDIDATES[0][1]),
            "reasoning": f"{lead['title']} has the highest validated confidence.",
        }


def scripted_model(mode: Mode = "confident") -> ScriptedChatModel:
    return StepScript(mode).model()


def register_scripted_answers() -> None:
    """Makes the `confident` script the default answers of every `ScriptedChatModel`."""
    for schema, answer in StepScript("confident").answers().items():
        register_example(schema, answer)


# ── Fake sources ─────────────────────────────────────────────────────────────


class FakeContextSource:
    """Entities held in memory. `fail` makes every call raise `SourceUnavailable`."""

    def __init__(self, entities: list[dict[str, Any]], fail: bool = False) -> None:
        self.entities = {e["id"]: e for e in entities}
        self.fail = fail
        self.calls: list[tuple[str, str]] = []

    def _check(self, method: str, entity_id: str) -> None:
        self.calls.append((method, entity_id))
        if self.fail:
            raise SourceUnavailable("Context broker not reachable (ConnectError).")

    async def get(self, entity_id: str) -> dict[str, Any] | None:
        self._check("get", entity_id)
        return self.entities.get(entity_id)

    async def related(self, entity: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        self._check("related", entity["id"])
        found = [self.entities[t] for t in relationship_objects(entity) if t in self.entities and t != entity["id"]]
        found += [e for e in self.entities.values() if entity["id"] in relationship_objects(e) and e not in found]
        return found[:limit]


class FakeHistorySource:
    """Numeric series held in memory: `{(entity_id, attribute): [(at, value), ...]}`."""

    def __init__(self, series: dict[tuple[str, str], list[tuple[datetime, float]]], fail: bool = False) -> None:
        self.series = series
        self.fail = fail
        self.calls: list[tuple[str, Any]] = []
        self.attribute_changes: list[AttributeChange] = []
        self.lifecycle_events: list[LifecycleEvent] = []
        # Values that aren't numbers, given with the numeric series as observations.
        self.text_values: list[Observation] = []

    def _check(self, method: str, args: Any) -> None:
        self.calls.append((method, args))
        if self.fail:
            raise SourceUnavailable("Time-series store not reachable.")

    async def recent(self, entity_ids: list[str], window: timedelta) -> list[SignalHistory]:
        self._check("recent", tuple(entity_ids))
        since = datetime.now(UTC) - window
        result = []
        for (entity_id, attribute), points in self.series.items():
            points = [(t, v) for t, v in points if t > since]
            if entity_id not in entity_ids or not points:
                continue
            values = [v for _, v in points]
            change = values[-1] - values[0] if len(values) > 1 else 0.0
            result.append(
                SignalHistory(
                    entity_id=entity_id,
                    attribute=attribute,
                    last=values[-1],
                    last_at=points[-1][0],
                    count=len(values),
                    minimum=min(values),
                    maximum=max(values),
                    trend=trend(change, pstdev(values) if len(values) > 1 else 0.0, fmean(values)),
                )
            )
        return result

    async def changes(self, entity_ids: list[str], window: timedelta, limit: int = 50) -> list[AttributeChange]:
        self._check("changes", tuple(entity_ids))
        return self.attribute_changes[:limit]

    async def lifecycle(self, entity_ids: list[str], window: timedelta, limit: int = 50) -> list[LifecycleEvent]:
        self._check("lifecycle", tuple(entity_ids))
        return self.lifecycle_events[:limit]

    async def observations(
        self, entity_id: str, window: timedelta, attributes: list[str] | None = None, limit: int = 500
    ) -> list[Observation]:
        self._check("observations", (entity_id, tuple(attributes) if attributes is not None else None))
        since = datetime.now(UTC) - window
        found = [
            Observation(entity_id=entity, attribute=attribute, at=at, value=str(value), value_type="double")
            for (entity, attribute), points in self.series.items()
            for at, value in points
        ]
        found += self.text_values
        found = [
            o
            for o in found
            if o.entity_id == entity_id and o.at > since and (attributes is None or o.attribute in attributes)
        ]
        return sorted(found, key=lambda o: o.at, reverse=True)[:limit]

    async def metrics(self, entity_id: str, attribute: str, window: timedelta, bucket: timedelta) -> list[Bucket]:
        self._check("metrics", (entity_id, attribute))
        since = datetime.now(UTC) - window
        points = [(t, v) for t, v in self.series.get((entity_id, attribute), []) if t > since]
        if not points:
            return []
        values = [v for _, v in points]
        return [
            Bucket(
                start=points[0][0],
                minimum=min(values),
                maximum=max(values),
                average=fmean(values),
                last=values[-1],
                count=len(values),
            )
        ]


class FailingMemory:
    """Incident memory that cannot be reached."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def similar(self, machine_id: str, machine_type: str | None, limit: int):
        self.calls.append("similar")
        raise SourceUnavailable("Incident memory not reachable.")

    async def store(self, record):
        self.calls.append("store")
        raise SourceUnavailable("Incident memory not reachable.")


# ── A small machine ──────────────────────────────────────────────────────────

MACHINE_ID = "urn:ngsi-ld:Machine:press-01"


def sample_entities() -> list[dict[str, Any]]:
    """A press with two components and a sensor pointing to it, on a line."""
    machine = MACHINE_ID
    return [
        {
            "id": machine,
            "type": "Machine",
            "name": {"type": "Property", "value": "Press 01"},
            "machineType": {"type": "Property", "value": "HydraulicPress"},
            "status": {"type": "Property", "value": "running"},
            "spindleSpeed": {"type": "Property", "value": 1450, "unitCode": "RPM"},
            "partOf": {"type": "Relationship", "object": "urn:ngsi-ld:ProductionLine:line-1"},
        },
        {
            "id": "urn:ngsi-ld:ProductionLine:line-1",
            "type": "ProductionLine",
            "name": {"type": "Property", "value": "Line 1"},
        },
        {
            "id": "urn:ngsi-ld:Component:press-01-pump",
            "type": "Component",
            "name": {"type": "Property", "value": "Hydraulic pump"},
            "partOf": {"type": "Relationship", "object": machine},
        },
        {
            "id": "urn:ngsi-ld:Component:press-01-cylinder",
            "type": "Component",
            "name": {"type": "Property", "value": "Main cylinder"},
            "partOf": {"type": "Relationship", "object": machine},
        },
        {
            "id": "urn:ngsi-ld:Sensor:press-01-oil-temperature",
            "type": "Sensor",
            "name": {"type": "Property", "value": "Press 01 oil temperature"},
            "value": {"type": "Property", "value": 62.5, "unitCode": "CEL"},
            "measures": {"type": "Relationship", "object": machine},
        },
        {
            "id": "urn:ngsi-ld:Machine:press-02",
            "type": "Machine",
            "name": {"type": "Property", "value": "Press 02"},
            "machineType": {"type": "Property", "value": "HydraulicPress"},
        },
    ]


def sample_history(now: datetime | None = None) -> dict[tuple[str, str], list[tuple[datetime, float]]]:
    """24 h of a rising oil temperature and a steady spindle speed, every 30 minutes."""
    now = now or datetime.now(UTC)
    times = [now - timedelta(minutes=30 * i) for i in range(47, -1, -1)]
    return {
        ("urn:ngsi-ld:Sensor:press-01-oil-temperature", "value"): [(t, 50 + i * 0.25) for i, t in enumerate(times)],
        (MACHINE_ID, "spindleSpeed"): [(t, 1450 + (i % 2)) for i, t in enumerate(times)],
        ("urn:ngsi-ld:Machine:press-02", "spindleSpeed"): [(t, 900.0) for t in times],
    }
