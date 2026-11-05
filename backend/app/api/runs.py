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
"""Run operations under `/api/agent/`."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.runs.files import Attachment
from app.runs.manager import RunManager

router = APIRouter(prefix="/api/agent", tags=["runs"])


class StartRequest(BaseModel):
    machine_id: str
    issue: str


class ClarifyRequest(BaseModel):
    text: str = ""
    files: list[Attachment] = Field(default_factory=list)


class ConfirmRequest(BaseModel):
    confirmed: bool
    text: str = ""
    files: list[Attachment] = Field(default_factory=list)


class StopRequest(BaseModel):
    reason: str | None = None


def runs(request: Request) -> RunManager:
    return request.app.state.runs


@router.post("/run", status_code=202)
async def start(body: StartRequest, request: Request) -> dict[str, str]:
    """Starts a run; answers before the first step completes."""
    return {"run_id": await runs(request).start(body.machine_id, body.issue)}


@router.get("/runs")
async def active(request: Request) -> list[dict[str, Any]]:
    """Runs that are not archived, newest first."""
    return await runs(request).list()


@router.get("/status/{run_id}")
async def status(run_id: str, request: Request) -> dict[str, Any]:
    return await runs(request).get(run_id)


@router.post("/clarify/{run_id}")
async def clarify(run_id: str, body: ClarifyRequest, request: Request) -> dict[str, str]:
    return await runs(request).clarify(run_id, body.text, body.files)


@router.post("/confirm-resolution/{run_id}")
async def confirm_resolution(run_id: str, body: ConfirmRequest, request: Request) -> dict[str, str]:
    return await runs(request).confirm(run_id, body.confirmed, body.text, body.files)


@router.post("/stop/{run_id}")
async def stop(run_id: str, request: Request, body: StopRequest | None = None) -> dict[str, str]:
    return await runs(request).stop(run_id, body.reason if body else None)


@router.post("/archive/{run_id}", status_code=204)
async def archive(run_id: str, request: Request) -> Response:
    await runs(request).archive(run_id)
    return Response(status_code=204)


@router.get("/escalate-preflight/{run_id}")
async def escalate_preflight(run_id: str, request: Request) -> dict[str, Any]:
    """Escalation is not available in phase 1; the answer says so."""
    return await runs(request).escalation_preflight(run_id)


@router.post("/reopen/{run_id}")
async def reopen(run_id: str, request: Request) -> dict[str, str]:
    """Only runs with a machine-builder conversation can be reopened; phase 1 has none."""
    await runs(request).reopen(run_id)
    return {}
