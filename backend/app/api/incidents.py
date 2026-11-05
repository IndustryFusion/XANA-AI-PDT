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
"""Incident history under `/api/incidents`."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request

from app.errors import invalid, not_found, unavailable
from app.memory.store import OUTCOMES, IncidentStore, StoreUnavailable

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


async def incidents(request: Request) -> IncidentStore:
    await request.app.state.runs.ready()
    return request.app.state.incidents


def _incident_id(value: str) -> int:
    if not value.isdigit() or len(value) > 9:
        raise not_found(f"Incident {value} does not exist.")
    return int(value)


@router.get("")
async def list_incidents(
    request: Request,
    machine_id: str | None = None,
    status: Annotated[str | None, Query(description="Outcomes, comma-separated")] = None,
    closed_from: Annotated[date | None, Query(alias="from")] = None,
    closed_to: Annotated[date | None, Query(alias="to")] = None,
) -> list[dict[str, Any]]:
    """History records newest first; `from` and `to` are inclusive closing dates (UTC)."""
    outcomes = [s.strip() for s in status.split(",") if s.strip()] if status else None
    unknown = [o for o in outcomes or [] if o not in OUTCOMES]
    if unknown:
        raise invalid(f"Unknown outcome {', '.join(unknown)}; use {', '.join(OUTCOMES)}.")
    if closed_from and closed_to and closed_from > closed_to:
        raise invalid("The start date is after the end date.")
    store = await incidents(request)
    try:
        return await store.list(machine_id or None, outcomes, closed_from, closed_to)
    except StoreUnavailable as error:
        raise unavailable(str(error)) from None


@router.get("/{incident_id}")
async def get_incident(incident_id: str, request: Request) -> dict[str, Any]:
    """A history record with its decision, resolution and every step of every round."""
    number = _incident_id(incident_id)
    store = await incidents(request)
    try:
        incident = await store.get(number)
    except StoreUnavailable as error:
        raise unavailable(str(error)) from None
    if incident is None:
        raise not_found(f"Incident {incident_id} does not exist.")
    return incident


@router.post("/{incident_id}/reopen", status_code=202)
async def reopen_incident(incident_id: str, request: Request) -> dict[str, str]:
    """Starts a new run with the incident's machine and issue."""
    return {"run_id": await request.app.state.runs.reopen_incident(_incident_id(incident_id))}
