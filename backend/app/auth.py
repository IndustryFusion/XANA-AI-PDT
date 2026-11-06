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
"""The operator's session with the identity provider.

One session per backend process, held in memory only. See `gh-21-keycloak-sign-in`'s
design for why, and what it means.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.errors import conflict, unauthorized, unavailable

log = logging.getLogger(__name__)

REFRESH_MARGIN_S = 60
REFRESH_RETRY_S = 5
MAX_REFRESH_FAILURES = 5
PROVIDER = "Keycloak"

SignInHook = Callable[[], Awaitable[None]]


@dataclass
class _Tokens:
    access: str
    refresh: str | None
    expires_at: float


def token_claims(token: str) -> dict[str, Any]:
    """The claims of a JWT, unverified: for display only, from a token the provider just sent us."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError, binascii.Error):
        return {}


class KeycloakSession:
    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        retry_s: float = REFRESH_RETRY_S,
    ) -> None:
        self._s = settings
        self._transport = transport
        self._clock = clock
        self._retry_s = retry_s
        self._tokens: _Tokens | None = None
        self._task: asyncio.Task[None] | None = None
        self.on_sign_in: list[SignInHook] = []

    @property
    def enabled(self) -> bool:
        return bool(self._s.keycloak_url)

    def token(self) -> str | None:
        """The current access token, or None when nobody is signed in or it has run out."""
        if self._tokens is None or self._tokens.expires_at <= self._clock():
            return None
        return self._tokens.access

    def config(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "provider": PROVIDER}

    def status(self) -> dict[str, Any]:
        token = self.token()
        if token is None:
            return {"valid": False, "user": None, "factory_id": None, "company_id": None, "token_expires_in_s": None}
        claims = token_claims(token)
        return {
            "valid": True,
            "user": {
                "username": str(claims.get("preferred_username", "")),
                "name": str(claims.get("name") or claims.get("preferred_username", "")),
                "email": str(claims.get("email", "")),
            },
            "factory_id": claims.get("ifric_factory_id") or self._s.factory_id,
            "company_id": claims.get("ifric_company_id"),
            "token_expires_in_s": max(0, round(self._tokens.expires_at - self._clock())),
        }

    async def connect(self, username: str, password: str) -> dict[str, Any]:
        if not self.enabled:
            raise conflict("Sign-in is not enabled on this backend.")
        grant = {"grant_type": "password", "username": username, "password": password}
        try:
            response = await self._post("token", grant)
        except httpx.HTTPError:
            raise unavailable("The identity provider could not be reached.") from None
        if response.status_code in (400, 401):
            raise unauthorized("The username or password is not correct.")
        if response.status_code != 200:
            raise unavailable(f"The identity provider answered HTTP {response.status_code}.")
        await self._stop_refresh()
        self._store(response.json())
        self._task = asyncio.create_task(self._keep_fresh())
        await self._run_hooks()
        return self.status()

    async def logout(self) -> None:
        tokens, self._tokens = self._tokens, None
        await self._stop_refresh()
        if tokens is None or not tokens.refresh:
            return
        try:
            await self._post("logout", {"refresh_token": tokens.refresh})
        except httpx.HTTPError as error:
            log.warning("The identity provider was not told about the sign-out (%s).", type(error).__name__)

    async def close(self) -> None:
        await self._stop_refresh()

    # Internals -------------------------------------------------------------

    async def _post(self, endpoint: str, form: dict[str, str]) -> httpx.Response:
        s = self._s
        url = f"{s.keycloak_url.rstrip('/')}/realms/{s.keycloak_realm}/protocol/openid-connect/{endpoint}"
        async with httpx.AsyncClient(timeout=s.health_timeout_s, transport=self._transport) as client:
            return await client.post(url, data={"client_id": s.keycloak_client_id, **form})

    def _store(self, answer: dict[str, Any]) -> None:
        self._tokens = _Tokens(
            answer["access_token"], answer.get("refresh_token"), self._clock() + answer["expires_in"]
        )

    async def _stop_refresh(self) -> None:
        task, self._task = self._task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _keep_fresh(self) -> None:
        failures = 0
        while self._tokens is not None:
            await asyncio.sleep(
                max(1.0, self._tokens.expires_at - self._clock() - REFRESH_MARGIN_S) if not failures else self._retry_s
            )
            if await self._refresh():
                failures = 0
                continue
            failures += 1
            if failures >= MAX_REFRESH_FAILURES:
                log.warning("The session ended: %d token refreshes failed in a row.", failures)
                self._tokens = None

    async def _refresh(self) -> bool:
        try:
            response = await self._post(
                "token", {"grant_type": "refresh_token", "refresh_token": self._tokens.refresh or ""}
            )
            if response.status_code == 200:
                self._store(response.json())
                return True
            log.warning("Token refresh failed: HTTP %d.", response.status_code)
        except httpx.HTTPError as error:
            log.warning("Token refresh failed: %s.", type(error).__name__)
        return False

    async def _run_hooks(self) -> None:
        for hook in self.on_sign_in:
            try:
                await hook()
            except Exception:
                log.exception("A step after sign-in failed")
