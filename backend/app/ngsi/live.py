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
"""Live updates for the Data Explorer: one broker subscription with an MQTT endpoint, and a stream per browser.

The agent doesn't use this. See `gh-23-live-updates`'s design for what the platform needs, and why
the token is in the endpoint: the context broker has no other way to take credentials for MQTT.
So the endpoint is built only where it is sent, and is never kept, logged or returned.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import ssl
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import aiomqtt
import httpx

from app.config import Settings
from app.errors import Refused
from app.ngsi.broker import ContextBroker

log = logging.getLogger(__name__)

SUBSCRIPTION_NAME = "xana-explorer-live"
LIFETIME_S = 24 * 3600
RENEW_BEFORE_S = 3600
TICK_S = 5.0
VERIFY_EVERY_S = 60.0
# The sweep's page. A subscription beyond it reads as gone, and creating it again answers 409 and renews it.
LIST_LIMIT = 1000
RECONNECT_S = (1.0, 2.0, 4.0, 8.0, 15.0)
STOP_TIMEOUT_S = 5.0
LATE_CREATE_S = 1.0
QUEUE_SIZE = 256
# A fixed name: the broker's check goes by the token's roles, and the platform treats `admin` specially.
MQTT_USER = "xana-explorer"
NEEDED_ROLE = "Factory-Admin or Factory-Reader on client scorpio"
NOT_AUTHORISED = {4, 5, 134, 135}
# The explorer's own changes should come back through the broker within this time.
DELIVERY_TIMEOUT_S = 15.0


class Refusal(Exception):
    """The MQTT broker refused the credentials or the topic."""


@dataclass(eq=False)
class Watcher:
    """One browser's stream."""

    entity_type: str | None = None
    ids: frozenset[str] = frozenset()
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(QUEUE_SIZE))
    overflowed: bool = False

    def wants(self, entity_id: str, entity_type: Any) -> bool:
        if self.ids:
            return entity_id in self.ids
        if not self.entity_type:
            return True
        types = entity_type if isinstance(entity_type, list) else [entity_type]
        return self.entity_type in types


def parse_notification(payload: bytes) -> list[dict[str, Any]]:
    """The changes in an MQTT message; an empty list for anything else."""
    try:
        message = json.loads(payload)
    except ValueError:
        return []
    body = message.get("body") if isinstance(message, dict) else None
    data = body.get("data") if isinstance(body, dict) else None
    changes = []
    for entity in data if isinstance(data, list) else []:
        if isinstance(entity, dict) and isinstance(entity.get("id"), str):
            attributes = {k: v for k, v in entity.items() if k not in ("id", "type", "@context")}
            changes.append(
                {
                    "type": "update",
                    "entity_id": entity["id"],
                    "entity_type": entity.get("type"),
                    "attributes": attributes,
                }
            )
    return changes


def _failure_reason(refused: Refused) -> str:
    """The status and what it means, never the broker's message: that could quote the endpoint, and its token."""
    status = refused.upstream_status
    if status is None:
        return "The context broker can't keep the live update subscription: it can't be reached."
    reason = f"The context broker can't keep the live update subscription (HTTP {status})."
    if refused.kind == "unauthorized":
        reason += " The operator's token lacks access to it."
    return reason


def _refused_code(code: Any) -> bool:
    """Whether a SUBACK refuses a topic. A broker that does so still accepts the connection."""
    return bool(getattr(code, "is_failure", False)) or (isinstance(code, int) and code >= 128)


async def mqtt_messages(
    url: str, password: str | None, client_id: str, topic: str, on_ready: Callable[[], None]
) -> AsyncIterator[bytes]:
    """Payloads of a topic, until the connection ends. Raises `Refusal` when the credentials are refused."""
    parts = urlsplit(url)
    secure = parts.scheme in ("mqtts", "ssl", "tls")
    try:
        async with aiomqtt.Client(
            hostname=parts.hostname or "localhost",
            port=parts.port or (8883 if secure else 1883),
            username=MQTT_USER if password else None,
            password=password,
            identifier=client_id,
            tls_context=ssl.create_default_context() if secure else None,
            timeout=10,
        ) as client:
            granted = await client.subscribe(topic, qos=1)
            if any(_refused_code(code) for code in granted or ()):
                raise Refusal("subscribe")
            on_ready()
            async for message in client.messages:
                yield bytes(message.payload)
    except aiomqtt.MqttCodeError as error:
        if getattr(error.rc, "value", error.rc) in NOT_AUTHORISED:
            raise Refusal("connect") from None
        raise


class LiveUpdates:
    def __init__(
        self,
        settings: Settings,
        token: Callable[[], str | None],
        sign_in_enabled: bool,
        broker: ContextBroker,
        connect: Callable[..., AsyncIterator[bytes]] = mqtt_messages,
        clock: Callable[[], float] = time.time,
        tick_s: float = TICK_S,
        reconnect_s: tuple[float, ...] = RECONNECT_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._broker_url = settings.mqtt_broker_url
        self._notify_url = settings.mqtt_broker_notify_url or settings.mqtt_broker_url
        self._mgmt_url = settings.mqtt_mgmt_url.rstrip("/")
        self._token = token
        self._sign_in = sign_in_enabled
        self._broker = broker
        self._connect = connect
        self._clock = clock
        self._tick_s = tick_s
        self._reconnect_s = reconnect_s
        self._transport = transport
        instance = uuid.uuid4().hex
        self._id = f"urn:ngsi-ld:Subscription:xana-explorer:{instance}"
        self._topic = f"xana/explorer/{instance}"
        self._client_id = f"xana-explorer-{instance[:16]}"
        self._watchers: set[Watcher] = set()
        self._task: asyncio.Task[None] | None = None
        self._listener: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._subscribed_token: str | None = None
        self._exists = False
        self._maybe_exists = False  # a create was sent, whatever came of it
        self._expires_at = 0.0
        self._verified_at = 0.0
        self._failing = False  # the last call about the subscription failed: no delivery state until one succeeds
        self._swept = False
        self._connected = False
        self._stopping = False
        self._wake = asyncio.Event()
        self._last_received: float | None = None
        self._expected_by: float | None = None
        self._state = "waiting_for_sign_in" if sign_in_enabled else "connecting"
        self._detail = "Live updates start after sign-in." if sign_in_enabled else "Connecting."

    # The running part ----------------------------------------------------------------------

    def start(self) -> None:
        """Starts, unless running. Waits for nothing: it may be called on every sign-in."""
        self._stopping = False
        self._wake.clear()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Stops, and deletes the subscription while the token still works. Never raises.

        A create under way is left to finish, as cancelling it could still let it reach the broker
        after the delete. If it takes too long it is cancelled, and the delete is repeated once.
        """
        self._stopping = True
        self._wake.set()
        task, self._task = self._task, None
        finished = True
        if task is not None:
            _, pending = await asyncio.wait({task}, timeout=STOP_TIMEOUT_S)
            finished = not pending
            if pending:
                task.cancel()
                await asyncio.wait({task})
        await self._stop_listening()
        async with self._lock:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._delete(), STOP_TIMEOUT_S)
                if not finished:
                    await asyncio.sleep(LATE_CREATE_S)
                    await asyncio.wait_for(self._delete(), STOP_TIMEOUT_S)
            self._forget()
        if self._sign_in:
            self._set_state("waiting_for_sign_in", "Live updates start after sign-in.")
        else:
            self._set_state("stopped", "Live updates are stopped.")

    async def _run(self) -> None:
        while not self._stopping:
            try:
                async with self._lock:
                    await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - this loop must outlive any failure
                log.warning("Live updates: a check failed (%s).", type(error).__name__)
                self._set_state("subscription_failed", "Live updates could not be set up.")
            # Not a plain sleep: a stop shouldn't have to wait for the next check.
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), self._tick_s)

    async def _tick(self) -> None:
        token = self._token()
        if self._sign_in and not token:
            await self._session_lost()
            return
        if self._listener is None or self._listener.done():
            self._listener = asyncio.create_task(self._listen())
        try:
            if self._exists:
                await self._keep(token)
            elif self._connected:
                await self._sweep()
                await self._create(token)
        except Refused as refused:
            # Only the kind and status: a broker's message about a subscription could quote its endpoint.
            status = refused.upstream_status
            log.warning("Live updates: the subscription failed (%s, HTTP %s).", refused.kind, status or "none")
            self._exists = self._exists and refused.kind != "not_found"
            self._failing = True
            if self._connected:
                self._set_state("subscription_failed", _failure_reason(refused))
            return
        if self._connected and self._exists and not self._failing:
            self._report_delivery()

    def _report_delivery(self) -> None:
        """What is known: the broker reports nothing about MQTT failures, whatever happens to them."""
        if self._expected_by is not None and self._clock() >= self._expected_by:
            self._set_state(
                "delivery_failed",
                "A change made here didn't arrive through the MQTT broker. "
                "Check that the context broker can reach it (MQTT_BROKER_NOTIFY_URL) and accepts the operator's token.",
            )
        elif self._last_received is None:
            self._set_state(
                "active", "Connected and subscribed. No change has arrived yet, so delivery isn't confirmed."
            )
        else:
            self._set_state("active", "Live updates are working.")

    def expect_delivery(self) -> None:
        """A change was just written through this backend, so a notification should follow."""
        if self._exists and self._connected and self._expected_by is None:
            self._expected_by = self._clock() + DELIVERY_TIMEOUT_S

    async def _session_lost(self) -> None:
        """Nobody is signed in any more. Whatever was left expires by itself, and goes at the next start."""
        await self._stop_listening()
        with contextlib.suppress(Exception):
            await self._delete()
        self._forget()
        self._set_state("waiting_for_sign_in", "Live updates start after sign-in.")

    def _forget(self) -> None:
        self._exists = False
        self._failing = False
        self._maybe_exists = False
        self._last_received = None
        self._expected_by = None
        self._subscribed_token = None
        self._swept = False

    def _set_state(self, state: str, detail: str) -> None:
        if state != self._state:
            log.info("Live updates: %s.", state)
        self._state, self._detail = state, detail

    # The subscription ----------------------------------------------------------------------

    def _endpoint(self, token: str | None) -> str:
        """The address with the token. Only for the request that sends it."""
        parts = urlsplit(self._notify_url)
        credentials = f"{MQTT_USER}:{token}@" if token else ""
        return f"{parts.scheme}://{credentials}{parts.netloc}/{self._topic}"

    def _notification(self, token: str | None) -> dict[str, Any]:
        # The broker fails every MQTT notification without `receiverInfo`, while it reads as `ok`.
        return {
            "endpoint": {
                "uri": self._endpoint(token),
                "accept": "application/json",
                "receiverInfo": [{"key": "X-Source", "value": "xana-explorer"}],
            }
        }

    def _expiry(self) -> tuple[float, str]:
        at = self._clock() + LIFETIME_S
        return at, datetime.fromtimestamp(at, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    async def _create(self, token: str | None) -> None:
        at, text = self._expiry()
        body = {
            "id": self._id,
            "type": "Subscription",
            "subscriptionName": SUBSCRIPTION_NAME,
            "expiresAt": text,
            "entities": [{"type": "*"}],
            "notification": self._notification(token),
        }
        self._maybe_exists = True
        try:
            await self._broker.send("POST", "/subscriptions", body=body)
        except Refused as refused:
            if refused.kind != "conflict":
                raise
            await self._renew(token)
            return
        self._note(token, at)

    async def _renew(self, token: str | None) -> None:
        at, text = self._expiry()
        body = {"expiresAt": text, "notification": self._notification(token)}
        await self._broker.send("PATCH", f"/subscriptions/{self._id}", body=body)
        self._note(token, at)

    def _note(self, token: str | None, expires_at: float) -> None:
        self._exists = True
        self._failing = False
        self._subscribed_token = token
        self._expires_at = expires_at
        self._verified_at = self._clock()

    async def _keep(self, token: str | None) -> None:
        now = self._clock()
        if token != self._subscribed_token or self._expires_at - now < RENEW_BEFORE_S:
            await self._renew(token)
        elif now - self._verified_at >= VERIFY_EVERY_S:
            try:
                await self._check(token)
            except Refused as refused:
                if refused.upstream_status is not None:  # the broker answered: the next check is a minute later
                    self._verified_at = now
                raise
            self._verified_at = now
            self._failing = False

    async def _check(self, token: str | None) -> None:
        """Whether the subscription is still in place: by its ID, else in the list, else by renewing it.

        Some brokers refuse reading a subscription by its ID, also one that doesn't exist, while they list and
        renew it, so a refused read says nothing about it.
        """
        try:
            await self._broker.send("GET", f"/subscriptions/{self._id}")
            return
        except Refused as refused:
            if refused.kind == "not_found":
                self._gone()
                return
            if refused.kind != "unauthorized":
                raise
        listed = await self._listed()
        if listed is not None:
            if not listed:
                self._gone()
            return
        try:
            await self._renew(token)
        except Refused as refused:
            if refused.kind != "not_found":
                raise
            self._gone()

    def _gone(self) -> None:
        """The next tick creates it again."""
        log.warning("Live updates: the subscription is gone, creating it again.")
        self._exists = False

    async def _listed(self) -> bool | None:
        """Whether the broker lists the subscription, or None when it refuses the list or answers no list.

        The list holds other subscriptions' endpoints, with their tokens: only the IDs are looked at.
        """
        try:
            response = await self._broker.send("GET", "/subscriptions", params={"limit": LIST_LIMIT})
        except Refused as refused:
            if refused.kind != "unauthorized":
                raise
            return None
        try:
            listed = response.json()
        except ValueError:
            return None
        if not isinstance(listed, list):
            return None
        return any(isinstance(item, dict) and item.get("id") == self._id for item in listed)

    async def _delete(self) -> None:
        if not self._maybe_exists:
            return
        try:
            await self._broker.send("DELETE", f"/subscriptions/{self._id}")
        except Refused as refused:
            if refused.kind != "not_found":
                raise

    async def _sweep(self) -> None:
        """Removes what an earlier process left: once per start, so two backends can't keep at it."""
        if self._swept:
            return
        response = await self._broker.send("GET", "/subscriptions", params={"limit": LIST_LIMIT})
        for item in response.json():
            if item.get("subscriptionName") == SUBSCRIPTION_NAME and item.get("id") != self._id:
                await self._broker.send("DELETE", f"/subscriptions/{item['id']}")
        self._swept = True

    # The MQTT connection -------------------------------------------------------------------

    async def _listen(self) -> None:
        failures = 0
        while True:
            try:
                async for payload in self._connect(
                    self._broker_url, self._token(), self._client_id, self._topic, self._mark_connected
                ):
                    self.deliver(payload)
                    failures = 0
                state, detail = "broker_unavailable", "The connection to the MQTT broker was lost."
            except asyncio.CancelledError:
                raise
            except Refusal:
                state = "refused"
                detail = (
                    f"The MQTT broker refused the operator's token or this topic. The operator needs {NEEDED_ROLE}."
                )
            except Exception as error:  # noqa: BLE001 - every failure means trying again
                log.info("Live updates: no MQTT connection (%s).", type(error).__name__)
                state, detail = "broker_unavailable", await self._unavailable_detail()
            self._connected = False
            self._set_state(state, detail)
            await asyncio.sleep(self._reconnect_s[min(failures, len(self._reconnect_s) - 1)])
            failures += 1

    def _mark_connected(self) -> None:
        self._connected = True
        self._expected_by = None  # what changed during an outage won't come

    async def _stop_listening(self) -> None:
        listener, self._listener = self._listener, None
        if listener is not None:
            listener.cancel()
            await asyncio.wait({listener})
        self._connected = False

    async def _unavailable_detail(self) -> str:
        try:
            async with httpx.AsyncClient(timeout=2, transport=self._transport, trust_env=False) as client:
                status = (await client.get(f"{self._mgmt_url}/status")).status_code
        except httpx.HTTPError:
            return "The MQTT broker cannot be reached."
        if status == 200:
            return "The MQTT broker is running, but its listener can't be reached."
        return "The MQTT broker cannot be reached."

    # To the browsers -----------------------------------------------------------------------

    def deliver(self, payload: bytes) -> None:
        """Never waits. A watcher that has fallen behind is marked, and its stream closes."""
        changes = parse_notification(payload)
        if not changes:
            return  # no notification, so it says nothing about delivery
        self._last_received = self._clock()
        self._expected_by = None
        for change in changes:
            for watcher in list(self._watchers):
                if watcher.overflowed or not watcher.wants(change["entity_id"], change["entity_type"]):
                    continue
                try:
                    watcher.queue.put_nowait(change)
                except asyncio.QueueFull:
                    watcher.overflowed = True

    def watch(self, entity_type: str | None = None, ids: list[str] | None = None) -> Watcher:
        watcher = Watcher(entity_type, frozenset(ids or ()))
        self._watchers.add(watcher)
        return watcher

    def unwatch(self, watcher: Watcher) -> None:
        self._watchers.discard(watcher)

    def health(self) -> dict[str, Any]:
        active = self._state == "active"
        received = self._last_received
        expires = datetime.fromtimestamp(self._expires_at, UTC).isoformat() if active else None
        return {
            "status": "ok" if active else "unavailable",
            "state": self._state,
            "detail": self._detail,
            "expires_at": expires,
            "delivery": "confirmed" if active and received else "unconfirmed" if active else "none",
        }
