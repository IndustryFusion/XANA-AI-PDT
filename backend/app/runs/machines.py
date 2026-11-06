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
"""Turns a machine's short name (`laser-cutter-01`) into its entity identifier."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable

import httpx

from app.errors import invalid
from xana_agent.sources.ngsi import context_link

log = logging.getLogger(__name__)

_URI = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_MAX_MATCHES = 10


class MachineResolver:
    def __init__(
        self,
        url: str,
        tenant: str | None = None,
        timeout_s: float = 3,
        transport: httpx.AsyncBaseTransport | None = None,
        token: Callable[[], str | None] | None = None,
        context_url: str | None = None,
    ) -> None:
        self._token = token
        self._context_url = context_url
        self._url = url.rstrip("/")
        self._tenant = tenant
        self._timeout = timeout_s
        self._transport = transport

    async def resolve(self, machine_id: str) -> str:
        """The identifier for `machine_id`.

        A URI is returned as given. A short name must match exactly one entity whose
        identifier ends in `:<name>`; no match or several are refused as `invalid`. If the
        broker cannot answer, the name is returned as given and the run's observe step
        reports what it could not read.

        An NGSI-LD query by identifier pattern needs entity types, so the broker's type
        list is read first and all types are queried at once.
        """
        if _URI.match(machine_id):
            return machine_id
        headers = {"Accept": "application/json"}
        if self._tenant:
            headers["NGSILD-Tenant"] = self._tenant
        if self._context_url:
            headers["Link"] = context_link(self._context_url)
        if self._token and (token := self._token()):
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(f"{self._url}/ngsi-ld/v1/types", headers=headers)
                response.raise_for_status()
                types = response.json().get("typeList", [])
                ids: list[str] = []
                if types:
                    params = {
                        "type": ",".join(types),
                        "idPattern": f".*:{re.escape(machine_id)}$",
                        "limit": _MAX_MATCHES,
                    }
                    response = await client.get(f"{self._url}/ngsi-ld/v1/entities", params=params, headers=headers)
                    response.raise_for_status()
                    ids = [e["id"] for e in response.json() if isinstance(e, dict) and "id" in e]
        except (httpx.HTTPError, ValueError, TypeError, AttributeError) as error:
            log.warning("Machine name %s not resolved: %s", machine_id, type(error).__name__)
            return machine_id
        if not ids:
            raise invalid(f"No machine is named {machine_id}.")
        if len(ids) > 1:
            raise invalid(f"{machine_id} names several entities ({', '.join(sorted(ids))}); use the full identifier.")
        return ids[0]
