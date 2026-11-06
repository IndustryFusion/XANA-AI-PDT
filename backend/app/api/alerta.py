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
"""The Alerts area's routes. They reach only the configured Alerta. Actions are operator actions."""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/alerta", tags=["alerts"])


class Action(BaseModel):
    action: str
    text: str | None = None


def _statuses(status: str | None) -> list[str] | None:
    return [item for item in (status or "").split(",") if item] or None


@router.get("/config")
async def config(request: Request) -> dict:
    return {"refresh_interval_s": request.app.state.alerta.refresh_interval_s}


@router.get("/alerts")
async def alerts(
    request: Request,
    status: str | None = None,
    severity: str | None = None,
    environment: str | None = None,
    service: str | None = None,
    text: str | None = None,
    sort: str = "severity",
    page: int = 1,
    page_size: Annotated[int, Query()] = 50,
) -> dict:
    return await request.app.state.alerta.list_alerts(
        status=_statuses(status),
        severity=severity,
        environment=environment,
        service=service,
        text=text,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/alerts/count")
async def count(request: Request, status: str | None = None) -> dict:
    return await request.app.state.alerta.count(_statuses(status))


@router.get("/alert/{alert_id}")
async def alert(alert_id: str, request: Request) -> dict:
    return await request.app.state.alerta.alert(alert_id)


@router.put("/alert/{alert_id}/action")
async def action(alert_id: str, body: Action, request: Request) -> dict:
    return await request.app.state.alerta.apply_action(alert_id, body.action, body.text)


@router.get("/environments")
async def environments(request: Request) -> list[str]:
    return await request.app.state.alerta.environments()


@router.get("/services")
async def services(request: Request) -> list[str]:
    return await request.app.state.alerta.services()
