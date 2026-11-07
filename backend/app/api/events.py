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
"""Webhooks that start runs. Each is checked for the secret before anything of its body is read."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Request

from app.errors import invalid, unauthorized
from app.events.worker import alert_event, ngsi_events

router = APIRouter(prefix="/events", tags=["events"])

REFUSED = "This call needs the webhook secret."


def _check_secret(request: Request) -> None:
    secret = request.app.state.settings.event_webhook_secret
    presented = request.headers.get("authorization", "")
    expected = f"Bearer {secret.get_secret_value()}" if secret else ""
    if not expected or not hmac.compare_digest(presented.encode(), expected.encode()):
        raise unauthorized(REFUSED)


async def _body(request: Request) -> Any:
    try:
        return await request.json()
    except ValueError:
        raise invalid("The body isn't JSON.") from None


@router.post("/ngsi", status_code=202)
async def ngsi(request: Request) -> dict[str, int]:
    """A notification of the context broker."""
    _check_secret(request)
    events, ignored = ngsi_events(await _body(request), request.app.state.settings.watched_attributes)
    request.app.state.events.add(events)
    return {"accepted": len(events), "ignored": ignored}


@router.post("/alert", status_code=202)
async def alert(request: Request) -> dict[str, int]:
    """An Alerta alert, or `{machine_id, issue}`."""
    _check_secret(request)
    event = alert_event(await _body(request))
    if event is None:
        return {"accepted": 0, "ignored": 1}
    request.app.state.events.add([event])
    return {"accepted": 1, "ignored": 0}
