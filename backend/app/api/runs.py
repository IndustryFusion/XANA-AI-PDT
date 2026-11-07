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
from fastapi.responses import StreamingResponse
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


class ActRequest(BaseModel):
    act: str
    text: str = ""
    outcome: str | None = None
    in_reply_to: str | None = None


class AskRequest(BaseModel):
    message: str


class DecisionRequest(BaseModel):
    approved: bool
    note: str = ""


class RecommendationRequest(BaseModel):
    action: str
    message: str = ""


class CloseRecord(BaseModel):
    outcome: str
    reason: str = ""


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
    """Whether escalation is possible, why not, and what would be sent. Sends nothing."""
    return await runs(request).escalation_preflight(run_id)


@router.post("/escalate/{run_id}")
async def escalate(run_id: str, request: Request) -> dict[str, str]:
    return await runs(request).escalate(run_id)


@router.get("/outbox-status/{run_id}")
async def outbox_status(run_id: str, request: Request) -> list[dict[str, Any]]:
    return await runs(request).outbox_status(run_id)


@router.post("/reopen/{run_id}")
async def reopen(run_id: str, request: Request) -> dict[str, str]:
    """Goes on with a run's conversation with the machine builder."""
    return await runs(request).reopen(run_id)


@router.post("/conversation-act/{run_id}")
async def conversation_act(run_id: str, body: ActRequest, request: Request) -> dict[str, str]:
    """The operator sends to the machine builder. Nothing else sends."""
    return await runs(request).desk.send_act(run_id, body.act, body.text, body.outcome, body.in_reply_to)


@router.post("/ask/{run_id}")
async def ask(run_id: str, body: AskRequest, request: Request) -> dict[str, str]:
    """A question to the incident agent. Nothing goes to the machine builder."""
    return await runs(request).desk.ask(run_id, body.message)


@router.post("/approve-data-request/{run_id}")
async def approve_data_request(run_id: str, body: DecisionRequest, request: Request) -> dict[str, str]:
    return await runs(request).desk.decide(run_id, body.approved, body.note)


@router.post("/recommendation-reply/{run_id}")
async def recommendation_reply(run_id: str, body: RecommendationRequest, request: Request) -> dict[str, str]:
    return await runs(request).desk.answer_recommendation(run_id, body.action, body.message)


@router.post("/refresh-conversation/{run_id}")
async def refresh_conversation(run_id: str, request: Request) -> dict[str, str]:
    return await runs(request).desk.refresh(run_id)


@router.post("/record-close/{run_id}")
async def record_close(run_id: str, body: CloseRecord, request: Request) -> dict[str, str]:
    return await runs(request).desk.record_close(run_id, body.outcome, body.reason)


@router.get("/message-files/{run_id}/{message_id}")
async def message_files(run_id: str, message_id: str, request: Request) -> StreamingResponse:
    """The files of a received message, as the ZIP the dataspace delivered."""
    content = await runs(request).desk.read_file(run_id, message_id)
    headers = {"Content-Disposition": f'attachment; filename="{message_id}.zip"'}
    return StreamingResponse(content, media_type="application/zip", headers=headers)
