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
"""A token of the backend's own, for what runs with nobody signed in.

Only the subscription and triggered runs use it. Nothing under `/api` does, as until sign-in protects those
routes, nothing there says who is calling. See `gh-30-machine-event-runs`'s design.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

import httpx

from app.config import Settings

log = logging.getLogger(__name__)

RENEW_BEFORE_S = 60
RETRY_S = 12
TIMEOUT_S = 10


class ServiceIdentity:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        retry_s: float = RETRY_S,
    ) -> None:
        self._url = None
        if settings.keycloak_url and settings.keycloak_service_client_id and settings.keycloak_service_client_secret:
            base = settings.keycloak_url.rstrip("/")
            self._url = f"{base}/realms/{settings.keycloak_realm}/protocol/openid-connect/token"
            self._form = {
                "grant_type": "client_credentials",
                "client_id": settings.keycloak_service_client_id,
                "client_secret": settings.keycloak_service_client_secret.get_secret_value(),
            }
        self._transport = transport
        self._clock = clock
        self._retry_s = retry_s
        self._access: str | None = None
        self._expires_at = 0.0
        self._task: asyncio.Task[None] | None = None
        self.problem: str | None = None

    @property
    def configured(self) -> bool:
        return self._url is not None

    def token(self) -> str | None:
        """The current token, or None if there is none, or it has run out."""
        return self._access if self._access and self._expires_at > self._clock() else None

    def start(self) -> None:
        if self.configured and self._task is None:
            self._task = asyncio.create_task(self._keep_fresh(), name="service identity")

    async def close(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.wait({task})

    async def _keep_fresh(self) -> None:
        while True:
            lifetime = await self.renew()
            await asyncio.sleep(max(1.0, lifetime - RENEW_BEFORE_S) if lifetime else self._retry_s)

    async def renew(self) -> float | None:
        """Requests a token. The seconds it lasts, or None after saying why, naming no value."""
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.post(self._url, data=self._form)
            if response.status_code != 200:
                return self._failed(f"The identity provider answered HTTP {response.status_code}.")
            answer = response.json()
            access, lifetime = answer["access_token"], answer["expires_in"]
            if not isinstance(access, str) or isinstance(lifetime, bool) or not isinstance(lifetime, int | float):
                return self._failed("The identity provider sent an unexpected answer.")
        except httpx.HTTPError as error:
            return self._failed(f"The identity provider could not be reached ({type(error).__name__}).")
        except (ValueError, KeyError, TypeError):
            return self._failed("The identity provider sent an unexpected answer.")
        self._access, self._expires_at = access, self._clock() + lifetime
        self.problem = None
        return lifetime

    def _failed(self, problem: str) -> None:
        if problem != self.problem:
            log.warning("Service identity: %s", problem)
        self.problem = problem
