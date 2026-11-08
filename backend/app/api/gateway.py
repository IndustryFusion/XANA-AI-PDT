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
"""The dataspace connection and what it reads. Responses never hold a token or a secret."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.dataspace.connection import GatewayConnection
from app.dataspace.gateway import GatewayClient

router = APIRouter(prefix="/api/gateway", tags=["dataspace"])


class Connect(BaseModel):
    secret: str | None = None


class Decision(BaseModel):
    action: str
    note: str | None = None


class NewRequest(BaseModel):
    provider_participant: str
    capability: str
    conversation_id: str | None = None
    purpose: str | None = None
    note: str | None = None


class Policy(BaseModel):
    consumer_id: str
    capability: str
    action: str


def connection(request: Request) -> GatewayConnection:
    return request.app.state.gateway_connection


def gateway(request: Request) -> GatewayClient:
    return request.app.state.gateway


@router.get("/config")
async def config(request: Request) -> dict[str, Any]:
    return connection(request).config()


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    return await connection(request).status()


@router.post("/connect")
async def connect(request: Request, body: Connect | None = None) -> dict[str, Any]:
    return await connection(request).connect(body.secret if body else None)


@router.post("/disconnect", status_code=204)
async def disconnect(request: Request) -> Response:
    await connection(request).disconnect()
    return Response(status_code=204)


@router.get("/token-claims")
async def token_claims(request: Request) -> dict[str, Any]:
    return connection(request).claims()


@router.get("/peers")
async def peers(request: Request) -> list[dict[str, Any]]:
    return await gateway(request).peers()


@router.get("/peers/{peer_id:path}/capabilities")
async def peer_capabilities(peer_id: str, request: Request) -> dict[str, Any]:
    return await gateway(request).peer_capabilities(peer_id)


@router.get("/access-levels")
async def access_levels(request: Request) -> dict[str, Any]:
    return await gateway(request).access_levels()


@router.get("/policies")
async def policies(request: Request) -> list[dict[str, Any]]:
    return await gateway(request).policies()


@router.get("/capabilities/requests")
async def capability_requests(request: Request, status: str | None = None) -> list[dict[str, Any]]:
    return await gateway(request).capability_requests(status)


@router.post("/capabilities/requests", status_code=202)
async def new_capability_request(body: NewRequest, request: Request) -> dict[str, Any]:
    optional = {"conversation_id": body.conversation_id, "purpose": body.purpose, "note": body.note}
    return await gateway(request).request_capability(body.provider_participant, body.capability, **optional)


@router.patch("/capabilities/requests/{request_id}")
async def decide(request_id: str, body: Decision, request: Request) -> dict[str, Any]:
    return await gateway(request).decide_request(request_id, body.action, body.note)


@router.post("/capabilities/policy")
async def set_policy(body: Policy, request: Request) -> dict[str, Any]:
    return await gateway(request).set_policy(body.consumer_id, body.capability, body.action)
