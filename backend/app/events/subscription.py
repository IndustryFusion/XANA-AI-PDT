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
"""The context broker subscription that sends machine events here.

Nothing a broker answers is logged or shown, only its status: an answer may quote the subscription, and so the
secret in it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.config import Settings

log = logging.getLogger(__name__)

SUBSCRIPTION_ID = "urn:ngsi-ld:Subscription:XanaPDT:MachineWatch"
CORE_CONTEXT = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"
TICK_S = 15.0
VERIFY_EVERY_S = 60.0
TIMEOUT_S = 10.0

NOT_CONFIGURED = "not_configured"
WAITING = "waiting_for_identity"
ACTIVE = "active"
DELIVERY_FAILING = "delivery_failing"
FAILED = "failed"
TENANT_LIMIT = "no_delivery_in_tenant"
BROKER_UNREACHABLE = "broker_unreachable"


class MachineWatch:
    def __init__(
        self,
        settings: Settings,
        token: Callable[[], str | None],
        identity_required: bool,
        transport: httpx.AsyncBaseTransport | None = None,
        identity_problem: Callable[[], str | None] = lambda: None,
        clock: Callable[[], float] = time.monotonic,
        tick_s: float = TICK_S,
    ) -> None:
        self._s = settings
        self._token = token
        self._identity_required = identity_required
        self._identity_problem = identity_problem
        self._transport = transport
        self._clock = clock
        self._tick_s = tick_s
        self._url = f"{settings.ngsi_url.rstrip('/')}/ngsi-ld/v1/subscriptions"
        self._ensured = False
        self._verified_at = 0.0
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self.state = WAITING if self.configured else NOT_CONFIGURED
        self.detail = "Waiting for an identity." if self.configured else "CALLBACK_BASE_URL is not set."

    @property
    def configured(self) -> bool:
        return bool(self._s.callback_base_url and self._s.event_webhook_secret)

    def start(self) -> None:
        if self.configured and self._task is None:
            self._task = asyncio.create_task(self._run(), name="machine watch")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.wait({task})

    def wake(self) -> None:
        """An identity may have become available: don't wait for the next try."""
        self._wake.set()

    async def _run(self) -> None:
        while True:
            try:
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - this loop must outlive any failure
                log.warning("Machine watch: a check failed (%s).", type(error).__name__)
                self._set(FAILED, "The subscription could not be checked.")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), self._tick_s)
            self._wake.clear()

    async def check(self) -> None:
        """One step towards a subscription that exists and delivers."""
        token = self._token()
        if self._identity_required and not token:
            if not self._ensured:
                problem = self._identity_problem()
                reason = f" The service identity failed: {problem}" if problem else ""
                self._set(WAITING, f"Waiting for a service identity or a signed-in operator; trying again.{reason}")
            return  # one that exists goes on delivering, and needs no token for that
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                if not self._ensured:
                    await self._ensure(client, token)
                elif self._clock() - self._verified_at >= VERIFY_EVERY_S:
                    await self._verify(client, token)
        except httpx.HTTPError as error:
            self._ensured = False
            # The broker's own check says it is down. This one only follows from that.
            self._set(
                BROKER_UNREACHABLE, f"The context broker could not be reached ({type(error).__name__}); trying again."
            )

    async def _ensure(self, client: httpx.AsyncClient, token: str | None) -> None:
        response = await client.post(self._url, json=self._subscription(), headers=self._headers(token, True))
        if response.status_code == 409:
            body = {k: v for k, v in self._subscription().items() if k not in ("id", "type")}
            response = await client.patch(
                f"{self._url}/{SUBSCRIPTION_ID}", json=body, headers=self._headers(token, True)
            )
        if response.status_code not in (201, 204):
            self._refused(response.status_code)
            return
        self._ensured = True
        self._verified_at = self._clock()
        self._set_delivering()

    async def _verify(self, client: httpx.AsyncClient, token: str | None) -> None:
        response = await client.get(f"{self._url}/{SUBSCRIPTION_ID}", headers=self._headers(token, False))
        self._verified_at = self._clock()
        if response.status_code == 404:
            log.warning("Machine watch: the subscription is gone, creating it again.")
            self._ensured = False
            await self._ensure(client, token)
            return
        if response.status_code != 200:
            self._refused(response.status_code)
            return
        if _notification_status(response) == "failed":
            self._set(
                DELIVERY_FAILING,
                f"The context broker reports that it can't deliver to {self._callback()}. "
                "Check that it can reach this address.",
            )
        else:
            self._set_delivering()

    def _set_delivering(self) -> None:
        if self._s.ngsi_tenant:
            self._set(
                TENANT_LIMIT,
                f"Subscribed in tenant {self._s.ngsi_tenant}, but the context broker delivers nothing there unless the "
                "same context is also subscribed in its default tenant, so machine events may not arrive.",
            )
        else:
            self._set(ACTIVE, f"Subscribed; notifications go to {self._callback()}.")

    def _refused(self, status: int) -> None:
        self._ensured = False
        reason = " The identity lacks access to the context broker." if status in (401, 403) else ""
        self._set(FAILED, f"The context broker answered HTTP {status}; trying again.{reason}")

    def _subscription(self) -> dict[str, Any]:
        return {
            "id": SUBSCRIPTION_ID,
            "type": "Subscription",
            "entities": [{"type": self._s.machine_watch_type}],
            "watchedAttributes": self._s.watched_attributes,
            "notification": {
                "endpoint": {
                    "uri": self._callback(),
                    "accept": "application/json",
                    "receiverInfo": [
                        {"key": "Authorization", "value": f"Bearer {self._s.event_webhook_secret.get_secret_value()}"}
                    ],
                }
            },
            "@context": [self._s.ngsi_context_url or CORE_CONTEXT],
        }

    def _callback(self) -> str:
        return f"{self._s.callback_base_url.rstrip('/')}/events/ngsi"

    def _headers(self, token: str | None, sending: bool) -> dict[str, str]:
        headers = {"Content-Type": "application/ld+json"} if sending else {"Accept": "application/json"}
        if self._s.ngsi_tenant:
            headers["NGSILD-Tenant"] = self._s.ngsi_tenant
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _set(self, state: str, detail: str) -> None:
        if state != self.state:
            log.info("Machine watch: %s.", state)
        self.state, self.detail = state, detail


def _notification_status(response: httpx.Response) -> str | None:
    try:
        return response.json()["notification"]["status"]
    except (ValueError, KeyError, TypeError):
        return None
