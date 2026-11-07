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
"""Names, builders and factory details from the IFRIC registry."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.ifric import RegistryClient

router = APIRouter(prefix="/api/ifric", tags=["registry"])


class Ids(BaseModel):
    ids: list[str]


class Machines(BaseModel):
    machine_ids: list[str]


def registry(request: Request) -> RegistryClient:
    return request.app.state.ifric


def _factory_id(request: Request) -> str | None:
    return request.app.state.session.status().get("factory_id") or request.app.state.settings.factory_id


@router.get("/config")
async def config(request: Request) -> dict[str, Any]:
    return {"configured": registry(request).configured, "factory_id": _factory_id(request)}


@router.get("/status")
async def status(request: Request) -> dict[str, Any]:
    return await registry(request).status(request.app.state.gateway_connection.participant_id)


@router.get("/factory")
async def factory(request: Request) -> dict[str, Any]:
    return await registry(request).factory(_factory_id(request))


@router.post("/resolve")
async def resolve(body: Ids, request: Request) -> dict[str, str]:
    return await registry(request).names(body.ids)


@router.post("/resolve-machines")
async def resolve_machines(body: Machines, request: Request) -> dict[str, str]:
    return await registry(request).machine_names(body.machine_ids)


@router.post("/resolve-builders")
async def resolve_builders(body: Machines, request: Request) -> dict[str, str]:
    return await registry(request).builders(body.machine_ids)
