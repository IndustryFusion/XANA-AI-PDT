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
"""Active alerts from Alerta, for the workflow. Only GET requests are sent: actions are for operators.

The platform's rules set an alert's `resource` to the full entity ID, and `resource` matches exactly,
so entities are asked for by their full IDs.
"""

from __future__ import annotations

from typing import Any

import httpx

from xana_agent.sources.base import SourceUnavailable

ACTIVE = ("open", "ack")
PAGE_SIZE = 100


class AlertaAlertSource:
    def __init__(
        self,
        url: str,
        api_key: str | None = None,
        timeout_s: float = 5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = url.rstrip("/")
        self._headers = {"Accept": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Key {api_key}"
        self._timeout = timeout_s
        self._transport = transport

    async def active(self, entity_id: str) -> list[dict[str, Any]]:
        params = [("resource", entity_id), *(("status", status) for status in ACTIVE), ("page-size", PAGE_SIZE)]
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(f"{self._url}/alerts", params=params, headers=self._headers)
        except httpx.HTTPError as exc:
            raise SourceUnavailable(f"Alerta not reachable ({type(exc).__name__}).") from None
        if response.status_code in (401, 403):
            raise SourceUnavailable("Alerta refused the API key.")
        if response.status_code >= 400:
            raise SourceUnavailable(f"Alerta answered HTTP {response.status_code}.")
        try:
            alerts = response.json().get("alerts", [])
        except (ValueError, AttributeError):
            raise SourceUnavailable("Alerta answered with something other than JSON.") from None
        return [alert for alert in alerts if isinstance(alert, dict)]
