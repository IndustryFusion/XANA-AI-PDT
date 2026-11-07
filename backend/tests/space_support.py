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
"""A run on a dataspace and registry in-process, for the escalation and conversation tests."""

from __future__ import annotations

from typing import Any

import httpx

from tests.dataspace_support import BUILDER, FACTORY, GATEWAY, KEY, KEYCLOAK, SECRET, Dataspace
from tests.runs_support import MACHINE, make_app

REGISTRY = "http://registry.test:4007"


class Space(Dataspace):
    """The dataspace, with the registry's manufacturer route. `machines` is entity ID → builder's company."""

    def __init__(self) -> None:
        super().__init__()
        self.machines: dict[str, str] = {MACHINE: BUILDER}
        self.registry_status: int | None = None
        self.registry_down = False
        self.access_here[BUILDER] = [
            {"capability": "twin:direct", "status": "auto", "source": "default"},
            {"capability": "twin:adjacents", "status": "approved", "source": "explicit"},
            {"capability": "twin:history", "status": "approved", "source": "explicit"},
        ]

    async def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "registry.test":
            return self._registry(request)
        return await super().handle(request)

    def _registry(self, request: httpx.Request) -> httpx.Response:
        if self.registry_down:
            raise httpx.ConnectError("refused")
        if self.registry_status:
            return httpx.Response(self.registry_status, json={"message": "no"})
        path = request.url.path
        if path.endswith("/manufacturer"):
            machine = path.split("/")[3]
            if machine in self.machines:
                return httpx.Response(
                    200, json={"company_ifric_id": self.machines[machine], "company_name": "Builder GmbH"}
                )
            return httpx.Response(200, json={"company": None, "message": "none"})
        return httpx.Response(200, json=[])


def space_app(url: str, space: Space, **settings: Any):
    values = {
        "gateway_url": GATEWAY,
        "gateway_keycloak_url": KEYCLOAK,
        "gateway_client_id": FACTORY,
        "settings_encryption_key": KEY,
        "ifric_url": REGISTRY,
    }
    return make_app(url, gateway_transport=space.transport(), **(values | settings))


async def connect(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/gateway/connect", json={"secret": SECRET})
    assert response.status_code == 200, response.text
