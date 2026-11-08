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
"""The backend's connection to the dataspace: a client credentials token, kept fresh, in memory only.

This token is separate from the operator's. See the `gh-26-dataspace-connection` design.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.auth import token_claims
from app.config import Settings
from app.dataspace.credentials import CredentialStore, StoredCredential
from app.errors import Refused, conflict, invalid, unauthorized, unavailable
from app.memory.store import StoreUnavailable

log = logging.getLogger(__name__)

CHECK_EVERY_S = 60
RENEW_MARGIN_S = 120
MAX_RENEW_FAILURES = 3
PROVIDER_TIMEOUT_S = 10
HEALTH_TIMEOUT_S = 5


@dataclass(frozen=True)
class _Token:
    access: str
    expires_at: float


class GatewayConnection:
    def __init__(
        self,
        settings: Settings,
        store: CredentialStore,
        company_id: Callable[[], str | None] = lambda: None,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        check_every_s: float = CHECK_EVERY_S,
    ) -> None:
        self._s = settings
        self._store = store
        self._company_id = company_id
        self._transport = transport
        self._clock = clock
        self._check_every = check_every_s
        self._token: _Token | None = None
        self._secret: str | None = None
        self._client_id: str | None = None
        self._failures = 0
        self._stopped = False
        self._last_problem: str | None = None
        self._changing = asyncio.Lock()  # connecting, disconnecting and renewing happen one at a time
        self._renewal: asyncio.Task[None] | None = None
        self._starting: asyncio.Task[None] | None = None
        self._retrying = False  # connecting by itself failed because the dataspace can't be reached, and goes on

    # ── State ────────────────────────────────────────────────────────────────

    @property
    def gateway_url(self) -> str | None:
        return self._s.gateway_url and self._s.gateway_url.rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self._s.gateway_url and self._s.gateway_keycloak_url and self.client_id())

    def client_id(self) -> str | None:
        return self._company_id() or self._s.gateway_client_id

    def token(self) -> str | None:
        """The current token, or None when not connected or it has run out."""
        if self._token is None or self._token.expires_at <= self._clock():
            return None
        return self._token.access

    @property
    def participant_id(self) -> str | None:
        token = self.token()
        return token_claims(token).get("participant_id") if token else None

    def claims(self) -> dict[str, Any]:
        token = self.token()
        if token is None:
            raise unavailable("Not connected to the dataspace.")
        claims = token_claims(token)
        roles = claims.get("realm_access", {}).get("roles", []) if isinstance(claims.get("realm_access"), dict) else []
        return {
            "participant_id": claims.get("participant_id"),
            "issuer": claims.get("iss"),
            "client_id": claims.get("azp") or claims.get("client_id"),
            "roles": [role for role in roles if isinstance(role, str)],
            "expires_at": claims.get("exp"),
        }

    def has_expired(self) -> bool:
        """Connected earlier, and the token has run out."""
        return self._token is not None and self.token() is None

    def _state(self) -> str:
        if not self.configured:
            return "not_configured"
        if self.token():
            return "connected"
        return "expired" if self._token else "disconnected"

    async def status(self) -> dict[str, Any]:
        state = self._state()
        stored = await self._stored_or_none() if state != "connected" else None
        credential = state == "connected" or bool(self._env_secret() or (stored and stored.secret))
        return {
            "state": state,
            "participant_id": self._token_participant() if state in ("connected", "expired") else None,
            "expires_at": _iso(self._token.expires_at) if state == "connected" and self._token else None,
            "credential_configured": state != "not_configured" and credential,
            "sharing_tier": None if state == "not_configured" else self._s.data_sharing_policy,
            "detail": self._detail(stored),
            "renewal_failures": self._failures,
            "client_id": None if state == "not_configured" else self.client_in_use(),
            "connecting": self._retrying and (state != "connected" or self._stopped),
        }

    def client_in_use(self) -> str | None:
        """The client of the connection while connected, else the one a connection would use now."""
        return self._client_id if self.token() and self._client_id else self.client_id()

    def not_connected_reason(self) -> tuple[str | None, bool]:
        """Why connecting by itself failed last, and whether it is still being tried."""
        if self.token():
            return None, False
        return self._last_problem, self._retrying

    def config(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "realm": self._s.gateway_keycloak_realm,
            "client_id": self.client_in_use(),
            "sharing_tier": self._s.data_sharing_policy,
        }

    def _token_participant(self) -> str | None:
        return token_claims(self._token.access).get("participant_id") if self._token else None

    def _detail(self, stored: StoredCredential | None) -> str | None:
        if self._stopped:
            if self._retrying or (self._starting is not None and not self._starting.done()):
                return (
                    f"Renewing the dataspace token failed {self._failures} times in a row, so renewal stopped "
                    f"({self._last_problem}). Connecting again is tried every minute."
                )
            return (
                f"Renewing the dataspace token failed {self._failures} times in a row ({self._last_problem}), "
                "so it is no longer tried. Connect again."
            )
        if self._failures:
            return (
                f"Renewing the dataspace token failed {self._failures} times ({self._last_problem}). It is tried again."
            )
        if stored and stored.unreadable and not self._env_secret():
            return "The stored secret can't be read with the configured key. Enter the secret again."
        return self._last_problem

    def _env_secret(self) -> str | None:
        secret = self._s.gateway_client_secret
        return secret.get_secret_value() if secret else None

    async def _stored_or_none(self) -> StoredCredential | None:
        try:
            return await self._store.read()
        except StoreUnavailable as error:
            log.warning("The stored dataspace secret could not be read: %s", error)
            return None

    # ── Connecting ───────────────────────────────────────────────────────────

    async def connect(
        self, secret: str | None = None, *, unless_connected: bool = False, only_if_wanted: bool = False
    ) -> dict[str, Any]:
        """Connects. `unless_connected` keeps a working connection; `only_if_wanted` connects only while the
        operator hasn't disconnected, checked here under the lock, as a disconnect may have landed meanwhile."""
        secret = secret or None
        async with self._changing:
            if unless_connected and self.token() and not self._stopped:
                return await self.status()
            if only_if_wanted:
                wanted = await self._stored_or_none()
                if wanted is None:
                    raise unavailable("The memory database is not reachable.")
                if not wanted.connect_wanted:
                    return await self.status()
            if not self.configured:
                raise conflict("No dataspace connection is configured.")
            client_id = self.client_id()
            chosen = secret or self._env_secret()
            if chosen is None:
                stored = await self._stored_or_none()
                if stored is None:
                    raise unavailable("The memory database is not reachable, so the stored secret can't be read.")
                if stored.unreadable:
                    raise conflict("The stored secret can't be read with the configured key. Enter the secret again.")
                chosen = stored.secret
            if chosen is None:
                raise invalid("Enter the dataspace credential.")
            token = await self._grant(client_id, chosen)
            if not token_claims(token.access).get("participant_id"):
                raise conflict("This client's token has no participant_id claim, so the gateway would refuse it.")
            await self._require_gateway()
            await self._remember(client_id, chosen, typed=secret is not None)
            await self._stop_renewal()
            self._token, self._secret, self._client_id = token, chosen, client_id
            self._failures, self._stopped, self._last_problem = 0, False, None
            self._retrying = False
            self._renewal = asyncio.create_task(self._keep_fresh())
        return await self.status()

    async def disconnect(self) -> None:
        if not self.configured:
            raise conflict("No dataspace connection is configured.")
        await self._stop_starting()
        async with self._changing:
            await self._stop_renewal()
            self._forget()
            try:
                await self._store.set_connect_wanted(False)
            except StoreUnavailable as error:
                log.warning("The disconnect was not stored, so a restart connects again: %s", error)

    def _forget(self) -> None:
        self._token = self._secret = self._client_id = None
        self._failures, self._stopped, self._last_problem = 0, False, None
        self._retrying = False

    async def _remember(self, client_id: str, secret: str, typed: bool) -> None:
        try:
            await self._store.save_secret(client_id, secret)
        except StoreUnavailable as error:
            if typed:
                raise unavailable(f"{error} The secret was not stored, so nothing changed.") from None
            log.warning("The dataspace secret was not stored: %s", error)

    async def _require_gateway(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT_S, transport=self._transport) as client:
                response = await client.get(f"{self.gateway_url}/health")
        except httpx.HTTPError:
            raise unavailable("The dataspace gateway can't be reached.") from None
        if response.status_code != 200:
            raise unavailable(f"The dataspace gateway answered HTTP {response.status_code}.")

    async def _grant(self, client_id: str, secret: str) -> _Token:
        s = self._s
        url = f"{s.gateway_keycloak_url.rstrip('/')}/realms/{s.gateway_keycloak_realm}/protocol/openid-connect/token"
        form = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": secret}
        try:
            async with httpx.AsyncClient(timeout=PROVIDER_TIMEOUT_S, transport=self._transport) as client:
                response = await client.post(url, data=form)
        except httpx.HTTPError:
            raise unavailable("The dataspace's identity provider can't be reached.") from None
        if response.status_code in (400, 401):
            raise unauthorized("The dataspace rejected the credential.")
        if response.status_code != 200:
            raise unavailable(f"The dataspace's identity provider answered HTTP {response.status_code}.")
        try:
            answer = response.json()
            access, expires_in = answer["access_token"], answer["expires_in"]
        except (ValueError, KeyError, TypeError):
            raise unavailable("The dataspace's identity provider sent an unexpected answer.") from None
        if not isinstance(access, str) or isinstance(expires_in, bool) or not isinstance(expires_in, int | float):
            raise unavailable("The dataspace's identity provider sent an unexpected answer.")
        return _Token(access, self._clock() + expires_in)

    # ── Connecting by itself ─────────────────────────────────────────────────

    async def connect_if_wanted(self) -> bool:
        """Connects unless already connected, or the operator disconnected, or there's no secret. Raises a refusal."""
        if (self.token() and not self._stopped) or not self.configured:
            return bool(self.token())
        stored = await self._stored_or_none()
        if stored is None:
            raise unavailable("The memory database is not reachable.")
        if not stored.connect_wanted or not (self._env_secret() or stored.secret):
            return False
        await self.connect(unless_connected=True, only_if_wanted=True)
        return self.token() is not None and not self._stopped

    def start(self) -> None:
        """Connects in the background. While the dataspace can't be reached, it tries again every check."""
        if self._starting is None or self._starting.done():
            self._starting = asyncio.create_task(self._start_up())

    async def on_sign_in(self) -> None:
        self.start()

    async def _start_up(self) -> None:
        while True:
            try:
                await self.connect_if_wanted()
                self._retrying = False
                return
            except Refused as refused:
                self._last_problem = refused.message
                if refused.kind != "unavailable":
                    log.warning("The dataspace connection was refused, and is not tried again: %s", refused.message)
                    self._retrying = False
                    return
                log.warning("The dataspace connection was not made, and is tried again: %s", refused.message)
                self._retrying = True
            await asyncio.sleep(self._check_every)

    async def _stop_starting(self) -> None:
        task, self._starting = self._starting, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._retrying = False

    # ── Renewing ─────────────────────────────────────────────────────────────

    async def _keep_fresh(self) -> None:
        while self._token is not None and not self._stopped:
            await asyncio.sleep(self._check_every)
            await self.check()

    async def check(self) -> None:
        """One check: renews when the token has the margin or less left."""
        async with self._changing:
            if self._token is None or self._stopped:
                return
            if self._token.expires_at - self._clock() > RENEW_MARGIN_S:
                return
            await self._renew()

    async def renew_refused(self, refused_token: str) -> str | None:
        """The gateway refused this token. Renews once however many requests had it refused."""
        async with self._changing:
            if self._token is None:
                return None
            if self._token.access != refused_token:
                return self.token()
            if not self._stopped:
                await self._renew()
            return self.token() if self._token.access != refused_token else None

    async def _renew(self) -> None:
        try:
            self._token = await self._grant(self._client_id, self._secret)
        except Refused as refused:
            self._failures += 1
            self._last_problem = refused.message
            log.warning("Renewing the dataspace token failed (%d): %s", self._failures, refused.message)
            if self._failures >= MAX_RENEW_FAILURES:
                self._stopped = True
                # Renewal stops here. Connecting again goes on as at startup, every minute while the
                # dataspace can't be reached, so the inbox resumes by itself once it can.
                self.start()
            return
        self._failures, self._last_problem = 0, None

    async def _stop_renewal(self) -> None:
        task, self._renewal = self._renewal, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.wait({task})

    async def close(self) -> None:
        await self._stop_renewal()
        await self._stop_starting()


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat()
