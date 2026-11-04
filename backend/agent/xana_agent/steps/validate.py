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
"""VALIDATE: check every hypothesis against the machine's data with a bounded plan."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from xana_agent.schemas import PlannedLookup, PlannedQuery, ValidatedHypothesisList, ValidationPlan
from xana_agent.state import AgentState
from xana_agent.steps import Deps, ask, facts, source_error, step

MAX_QUERIES = 6
MAX_LOOKUPS = 3
MAX_WINDOW_H = 168
MAX_BUCKETS = 96


def trim(plan: ValidationPlan, observed: set[str]) -> tuple[list[PlannedQuery], list[PlannedLookup]]:
    """Keeps checks of observed entities only, without duplicates, within the per-round limits."""
    queries: dict[tuple[str, str], PlannedQuery] = {}
    for query in plan.queries:
        if query.entity_id in observed and query.attribute:
            queries.setdefault((query.entity_id, query.attribute), query)
    lookups: dict[str, PlannedLookup] = {}
    for lookup in plan.lookups:
        if lookup.entity_id in observed:
            lookups.setdefault(lookup.entity_id, lookup)
    return list(queries.values())[:MAX_QUERIES], list(lookups.values())[:MAX_LOOKUPS]


def _window(query: PlannedQuery) -> tuple[timedelta, timedelta]:
    window_h = min(max(query.window_hours, 0.25), MAX_WINDOW_H)
    bucket_min = max(query.bucket_minutes, 1, window_h * 60 / MAX_BUCKETS)
    return timedelta(hours=window_h), timedelta(minutes=round(bucket_min))


async def validate(state: AgentState, deps: Deps) -> dict[str, Any]:
    run = state["input"]
    hypotheses = state["hypotheses"]
    entities = state["entities"]
    machine_id = state["machine"]["id"]
    observed = set(entities) or {machine_id}

    plan = await ask(
        deps,
        "validate",
        ValidationPlan,
        "validate_plan",
        machine=state["machine"],
        issue=run.issue,
        hypotheses=hypotheses,
        entities=[{"id": e["id"], "type": e["type"], "name": e["name"]} for e in entities.values()]
        or [{"id": machine_id}],
        signals=[{k: s[k] for k in ("entity_id", "attribute", "name")} for s in state["signals"]],
        max_queries=MAX_QUERIES,
        max_lookups=MAX_LOOKUPS,
    )
    queries, lookups = trim(plan, observed)

    checks: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    missing = [f"attribute history: {state['history_missing']}"] if state.get("history_missing") else []
    for query in queries:
        window, bucket = _window(query)
        check = {
            "hypothesis_id": query.hypothesis_id,
            "kind": "history",
            "entity_id": query.entity_id,
            "attribute": query.attribute,
            "window_hours": window.total_seconds() / 3600,
            "bucket_minutes": bucket.total_seconds() / 60,
        }
        checks.append(check)
        try:
            buckets = await deps.history.metrics(query.entity_id, query.attribute, window, bucket)
            rows = [
                {
                    "start": b.start.isoformat(),
                    "min": round(b.minimum, 4),
                    "max": round(b.maximum, 4),
                    "avg": round(b.average, 4),
                    "last": round(b.last, 4),
                    "n": b.count,
                }
                for b in buckets
            ]
            results.append({**check, "buckets": rows} if rows else {**check, "error": "No data in the window."})
        except Exception as exc:
            error = source_error(exc, "Time-series database")
            results.append({**check, "error": error})
            note = f"history of {query.entity_id} {query.attribute}: {error}"
            if not state.get("history_missing"):
                missing.append(note)
    for lookup in lookups:
        check = {"hypothesis_id": lookup.hypothesis_id, "kind": "lookup", "entity_id": lookup.entity_id}
        checks.append(check)
        try:
            entity = await deps.context.get(lookup.entity_id)
            results.append({**check, "entity": facts(entity)} if entity else {**check, "error": "Entity not found."})
        except Exception as exc:
            error = source_error(exc, "Context broker")
            results.append({**check, "error": error})
            missing.append(f"current values of {lookup.entity_id}: {error}")

    answer = await ask(
        deps,
        "validate",
        ValidatedHypothesisList,
        "validate",
        machine=state["machine"],
        issue=run.issue,
        clarifications=run.clarifications,
        hypotheses=hypotheses,
        results=results,
        missing=missing,
    )
    verdicts = {v.id: v for v in answer.hypotheses}
    suffix = f" Not available: {'; '.join(missing)}" if missing else ""
    validated = []
    for h in hypotheses:
        verdict = verdicts.get(h["id"])
        if verdict:
            entry = {
                **h,
                "confidence": verdict.confidence,
                "verdict": verdict.verdict,
                "validation": verdict.validation,
            }
        else:
            entry = {**h, "verdict": "inconclusive", "validation": "Not assessed by the validation."}
        entry["validation"] += suffix
        validated.append(entry)
    validated.sort(key=lambda h: h["confidence"], reverse=True)

    step_input = {"hypotheses": [h["id"] for h in hypotheses], "checks": checks}
    return {"validated": validated, "step": step("validate", step_input, {"hypotheses": validated})}
