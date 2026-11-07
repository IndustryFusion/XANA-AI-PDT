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
"""Live updates against real services: Scorpio (TEST_BROKER_URL), and EMQX as this machine reaches it
(TEST_MQTT_URL) and as Scorpio does (TEST_MQTT_NOTIFY_URL).

With TEST_MQTT_PLATFORM_URL, its notify address and TEST_KEYCLOAK_URL, it also checks tokens, roles and
rotation against EMQX with the platform's kind of check (the `platform-mqtt` profile). TEST_MQTT_CONTAINER
and TEST_MQTT_PLATFORM_CONTAINER name the containers for the tests that restart a broker.
"""

import asyncio
import json
import os
import signal
import socket
import struct
import subprocess
import sys
import time
import uuid
from base64 import b64encode
from pathlib import Path

import aiomqtt
import httpx
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from app.auth import KeycloakSession
from app.ngsi.broker import ContextBroker
from app.ngsi.live import SUBSCRIPTION_NAME, LiveUpdates, Refusal, mqtt_messages
from tests.conftest import make_settings

BROKER = os.environ.get("TEST_BROKER_URL")
MQTT = os.environ.get("TEST_MQTT_URL")
NOTIFY = os.environ.get("TEST_MQTT_NOTIFY_URL")
CONTAINER = os.environ.get("TEST_MQTT_CONTAINER")
PLATFORM = os.environ.get("TEST_MQTT_PLATFORM_URL")
PLATFORM_NOTIFY = os.environ.get("TEST_MQTT_PLATFORM_NOTIFY_URL")
PLATFORM_CONTAINER = os.environ.get("TEST_MQTT_PLATFORM_CONTAINER")
KEYCLOAK = os.environ.get("TEST_KEYCLOAK_URL")

pytestmark = [pytest.mark.services, pytest.mark.skipif(not (BROKER and MQTT and NOTIFY), reason="needs TEST_MQTT_URL")]
needs_platform = pytest.mark.skipif(
    not (PLATFORM and PLATFORM_NOTIFY and KEYCLOAK), reason="needs the platform's check"
)
ENTITIES = f"{BROKER}/ngsi-ld/v1/entities"
SUBSCRIPTIONS = f"{BROKER}/ngsi-ld/v1/subscriptions"
JSON = {"Content-Type": "application/json"}
ACCEPT = {"Accept": "application/json"}


def host_port(url):
    parts = httpx.URL(url)
    return parts.host, parts.port or 1883


async def ours():
    async with httpx.AsyncClient() as client:
        found = (await client.get(SUBSCRIPTIONS, headers=ACCEPT, params={"limit": 1000})).json()
    return [s for s in found if s.get("subscriptionName") == SUBSCRIPTION_NAME]


async def none_left():
    """The broker's listing can lag a moment behind a delete."""

    async def empty():
        return await ours() == []

    await until(empty, 5, "no subscription left")


async def wipe():
    async with httpx.AsyncClient() as client:
        for item in await ours():
            await client.delete(f"{SUBSCRIPTIONS}/{item['id']}")


async def until(condition, seconds=30, what="condition"):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if await condition():
            return
        await asyncio.sleep(0.2)
    raise AssertionError(f"{what} didn't happen within {seconds} s")


def live_updates(token=lambda: None, sign_in=False, url=None, notify=None, transport=None, **extra):
    settings = make_settings(
        ngsi_url=BROKER,
        mqtt_broker_url=url or MQTT,
        mqtt_broker_notify_url=notify or NOTIFY,
        mqtt_mgmt_url="http://127.0.0.1:1",
        **extra,
    )
    broker = ContextBroker(settings, token, transport=transport)
    live = LiveUpdates(settings, token, sign_in, broker, tick_s=0.2, reconnect_s=(0.2, 0.5, 1.0))
    broker.on_write = live.expect_delivery
    return live, broker


async def state_is(live, state, seconds=30):
    async def check():
        return live.health()["state"] == state

    await until(check, seconds, f"state {state}, it is {live.health()}")


@pytest.fixture
async def clean():
    await wipe()
    yield
    await wipe()


@pytest.fixture
async def entity():
    entity_id = f"urn:test:live:{uuid.uuid4().hex[:10]}"
    async with httpx.AsyncClient() as client:
        body = {"id": entity_id, "type": "LiveTest", "n": {"type": "Property", "value": 0}}
        assert (await client.post(ENTITIES, json=body, headers=JSON)).status_code == 201
    yield entity_id
    async with httpx.AsyncClient() as client:
        await client.delete(f"{ENTITIES}/{entity_id}")


async def change(entity_id, value):
    async with httpx.AsyncClient() as client:
        body = {"n": {"type": "Property", "value": value}}
        answer = await client.post(f"{ENTITIES}/{entity_id}/attrs", json=body, headers=JSON)
        assert answer.status_code == 204


async def arrives(live, entity_id, value, seconds=20):
    """Changes the entity until that value comes through: a change before everything is up isn't replayed."""
    watcher = live.watch(ids=[entity_id])
    try:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            await change(entity_id, value)
            try:
                got = await asyncio.wait_for(watcher.queue.get(), 2)
            except TimeoutError:
                continue
            if got["attributes"]["n"]["value"] == value:
                return got
        raise AssertionError(f"{value} never arrived: {live.health()}")
    finally:
        live.unwatch(watcher)


async def test_messages_on_the_topic_arrive_and_on_other_topics_do_not():
    topic = f"xana/test/{uuid.uuid4().hex}"
    ready = asyncio.Event()
    received = []

    async def listen():
        async for payload in mqtt_messages(MQTT, None, f"t-{uuid.uuid4().hex[:8]}", topic, ready.set):
            received.append(payload)

    task = asyncio.create_task(listen())
    await asyncio.wait_for(ready.wait(), 10)
    host, port = host_port(MQTT)
    async with aiomqtt.Client(host, port) as publisher:
        await publisher.publish(f"{topic}/other", b"no")
        await publisher.publish(topic, b"yes", qos=1)
    await until(lambda: asyncio.sleep(0, bool(received)), 5, "a message")
    task.cancel()
    assert received == [b"yes"]


async def test_a_change_in_the_broker_reaches_a_watcher_and_nothing_is_left(clean, entity):
    live, _ = live_updates()
    live.start()
    await state_is(live, "active")
    assert len(await ours()) == 1
    got = await arrives(live, entity, 5)
    assert got["entity_id"] == entity
    assert live.health()["delivery"] == "confirmed"
    await live.stop()
    await none_left()


async def test_a_wrong_notify_address_shows_after_a_change_here(clean, entity):
    live, broker = live_updates(notify="mqtt://no-such-host-here:1883")
    live.start()
    await state_is(live, "active")
    assert live.health()["delivery"] == "unconfirmed"
    await broker.send("POST", f"/entities/{entity}/attrs", body={"n": {"type": "Property", "value": 1}})
    assert live._expected_by is not None
    live._expected_by = time.time()  # not waiting out the 15 s
    await state_is(live, "delivery_failed", 5)
    assert live.health()["status"] == "unavailable"
    await live.stop()
    await none_left()


async def test_a_leftover_goes_even_if_the_first_listing_fails(clean):
    leftover = {
        "id": f"urn:ngsi-ld:Subscription:xana-explorer:{uuid.uuid4().hex}",
        "type": "Subscription",
        "subscriptionName": SUBSCRIPTION_NAME,
        "entities": [{"type": "*"}],
        "notification": {
            "endpoint": {
                "uri": f"{NOTIFY}/xana/explorer/old",
                "accept": "application/json",
                "receiverInfo": [{"key": "a", "value": "b"}],
            }
        },
    }
    async with httpx.AsyncClient() as client:
        assert (await client.post(SUBSCRIPTIONS, json=leftover, headers=JSON)).status_code == 201

    class FailsOnce(httpx.AsyncHTTPTransport):
        failed = False

        async def handle_async_request(self, request):
            if request.method == "GET" and not self.failed:
                self.failed = True
                raise httpx.ConnectError("down", request=request)
            return await super().handle_async_request(request)

    live, _ = live_updates(transport=FailsOnce())
    live.start()
    await state_is(live, "active")

    async def only_ours():
        return [s["id"] for s in await ours()] == [live._id]

    await until(only_ours, 5, "only this process's subscription")
    await live.stop()


async def test_stop_during_a_slow_create_leaves_nothing(clean):
    posted = asyncio.Event()

    class SlowAnswer(httpx.AsyncHTTPTransport):
        async def handle_async_request(self, request):
            answer = await super().handle_async_request(request)
            if request.method == "POST":
                posted.set()
                await asyncio.sleep(1)
            return answer

    live, _ = live_updates(transport=SlowAnswer())
    live.start()
    await asyncio.wait_for(posted.wait(), 15)
    assert live._exists is False
    await live.stop()
    await none_left()


@pytest.mark.skipif(not CONTAINER, reason="needs TEST_MQTT_CONTAINER")
async def test_losing_the_broker_shows_and_updates_resume(clean, entity):
    live, _ = live_updates()
    live.start()
    await state_is(live, "active")
    await arrives(live, entity, 1)
    subprocess.run(["docker", "stop", CONTAINER], check=True, capture_output=True)  # noqa: S603, S607
    try:
        await state_is(live, "broker_unavailable")
        assert live.health()["status"] == "unavailable"
    finally:
        subprocess.run(["docker", "start", CONTAINER], check=True, capture_output=True)  # noqa: S603, S607
    await state_is(live, "active", 60)
    await arrives(live, entity, 2, 40)
    await live.stop()


# A client that stops reading, on a real server ----------------------------------------------------


def _stalled_socket(port):
    connection = socket.socket()
    connection.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    connection.connect(("127.0.0.1", port))
    key = b64encode(os.urandom(16)).decode()
    connection.send(
        f"GET /api/ngsi/ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
    )
    assert b"101" in connection.recv(200)
    return connection


def _tcp_state(connection):
    return struct.unpack("B", connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 1))[0]


ESTABLISHED = 1


@pytest.fixture
def server(tmp_path):
    """The backend itself, started as in production, and its log."""
    with socket.socket() as finder:
        finder.bind(("127.0.0.1", 0))
        port = finder.getsockname()[1]
    env = {
        **os.environ,
        "BACKEND_PORT": str(port),
        "NGSI_URL": BROKER,
        "MQTT_BROKER_URL": MQTT,
        "MQTT_BROKER_NOTIFY_URL": NOTIFY,
        "MQTT_MGMT_URL": "http://127.0.0.1:1",
        "LLM_PROVIDER": "scripted",
        "POSTGRES_MEMORY_URL": "postgresql://nobody@127.0.0.1:1/none",
        "TIMESCALE_DB_URL": "postgresql://nobody@127.0.0.1:1/none",
    }
    env.pop("KEYCLOAK_URL", None)
    log = tmp_path / "backend.log"
    with log.open("w") as out:
        process = subprocess.Popen(  # noqa: S603
            [sys.executable, "-m", "app"],
            cwd=Path(__file__).resolve().parent.parent,
            env=env,
            stdout=out,
            stderr=subprocess.STDOUT,
        )
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.2)
        yield process, port, log
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


async def _flood(port):
    deadline = time.monotonic() + 30
    async with httpx.AsyncClient() as client:
        while time.monotonic() < deadline:
            health = (await client.get(f"http://127.0.0.1:{port}/api/ngsi/subscription-health")).json()
            if health["state"] == "active":
                break
            await asyncio.sleep(0.2)
        assert health["state"] == "active", health
        [subscription] = await ours()
    topic = "xana/explorer/" + subscription["id"].rsplit(":", 1)[-1]
    body = {
        "body": {"data": [{"id": "urn:test:slow", "type": "T", "blob": {"type": "Property", "value": "x" * 50000}}]}
    }
    host, mqtt_port = host_port(MQTT)
    async with aiomqtt.Client(host, mqtt_port) as publisher:
        for _ in range(600):
            await publisher.publish(topic, json.dumps(body))
            await asyncio.sleep(0.005)


async def test_a_client_that_stops_reading_is_closed_and_others_keep_getting_changes(clean, server):
    process, port, _log = server
    await asyncio.sleep(1)
    stalled = _stalled_socket(port)
    received = []

    async def healthy():
        async with connect(f"ws://127.0.0.1:{port}/api/ngsi/ws", max_size=None) as other:
            async for raw in other:
                if json.loads(raw)["type"] == "update":
                    received.append(time.monotonic())

    reader = asyncio.create_task(healthy())
    await asyncio.sleep(0.3)
    await _flood(port)
    await asyncio.sleep(2)
    reader.cancel()
    assert len(received) == 600  # the one that reads gets every change, in spite of the one that doesn't
    started = time.monotonic()
    while time.monotonic() - started < 25 and _tcp_state(stalled) == ESTABLISHED:
        await asyncio.sleep(0.25)
    assert _tcp_state(stalled) != ESTABLISHED, "still open"
    stalled.close()
    process.send_signal(signal.SIGTERM)
    process.wait(timeout=20)
    await none_left()


async def test_a_real_server_refuses_another_origin_and_takes_its_own(server):
    _process, port, _log = server
    address = f"127.0.0.1:{port}"
    with pytest.raises(InvalidStatus):
        async with connect(f"ws://{address}/api/ngsi/ws", origin="https://evil.example"):
            pass
    async with connect(f"ws://{address}/api/ngsi/ws", origin=f"http://{address}"):
        pass


async def test_shutdown_is_bounded_with_a_stalled_client_and_deletes_the_subscription(clean, server):
    process, port, log = server
    await asyncio.sleep(1)
    stalled = _stalled_socket(port)
    await _flood(port)
    # Straight after the flood, while the send is still waiting.
    started = time.monotonic()
    process.send_signal(signal.SIGTERM)
    await asyncio.to_thread(process.wait, 25)
    assert time.monotonic() - started < 20
    await none_left()
    stalled.close()
    assert "eyJ" not in log.read_text()


# Tokens, roles and rotation, with the platform's kind of check -----------------------------------


def _token(username):
    answer = httpx.post(
        f"{KEYCLOAK}/realms/iff/protocol/openid-connect/token",
        data={"client_id": "scorpio", "grant_type": "password", "username": username, "password": username},
    )
    answer.raise_for_status()
    return answer.json()["access_token"]


@needs_platform
async def test_a_token_with_the_role_may_subscribe_and_one_without_is_refused():
    topic = f"xana/test/{uuid.uuid4().hex}"
    ready = asyncio.Event()

    async def listen(token):
        async for _ in mqtt_messages(PLATFORM, token, f"t-{uuid.uuid4().hex[:8]}", topic, ready.set):
            pass

    task = asyncio.create_task(listen(_token("operator")))
    await asyncio.wait_for(ready.wait(), 10)
    task.cancel()
    for bad in (_token("visitor"), "not-a-token", None):
        with pytest.raises((Refusal, aiomqtt.MqttError)) as caught:
            await asyncio.wait_for(listen(bad), 10)
        assert caught.type is Refusal


@needs_platform
async def test_a_refused_topic_is_refused_and_not_taken_for_a_subscription():
    ready = []

    async def listen():
        async for _ in mqtt_messages(
            PLATFORM,
            _token("operator"),
            f"t-{uuid.uuid4().hex[:8]}",
            "spBv1.0/other/DDATA/g/d",
            lambda: ready.append(1),
        ):
            pass

    with pytest.raises(Refusal):
        await asyncio.wait_for(listen(), 10)
    assert ready == []


@needs_platform
async def test_refused_shows_with_the_role_and_makes_no_subscription(clean):
    token = _token("visitor")
    live, _ = live_updates(token=lambda: token, sign_in=True, url=PLATFORM, notify=PLATFORM_NOTIFY)
    live.start()
    await state_is(live, "refused")
    assert "Factory-Reader" in live.health()["detail"]
    assert live._id not in [item["id"] for item in await ours()]
    await live.stop()


@needs_platform
async def test_updates_go_on_past_the_tokens_life_and_after_the_broker_restarts(clean, entity):
    """With 70-second tokens, refreshed every 10 s. Nothing but the rotation can keep this working."""
    admin = httpx.post(
        f"{KEYCLOAK}/realms/master/protocol/openid-connect/token",
        data={"client_id": "admin-cli", "username": "admin", "password": "admin", "grant_type": "password"},
    ).json()["access_token"]
    realm = f"{KEYCLOAK}/admin/realms/iff"
    headers = {"Authorization": f"Bearer {admin}"}
    before = httpx.get(realm, headers=headers).json()["accessTokenLifespan"]
    assert httpx.put(realm, headers=headers, json={"accessTokenLifespan": 70}).status_code == 204
    settings = make_settings(keycloak_url=KEYCLOAK)
    session = KeycloakSession(settings)
    try:
        await session.connect("operator", "operator")
        first = session.token()
        live, _ = live_updates(token=session.token, sign_in=True, url=PLATFORM, notify=PLATFORM_NOTIFY)
        live.start()
        await state_is(live, "active")
        await arrives(live, entity, 1)
        [created] = await ours()
        assert first in created["notification"]["endpoint"]["uri"]

        await asyncio.sleep(75)  # the first token has run out
        assert session.token() != first
        [renewed] = await ours()
        assert first not in renewed["notification"]["endpoint"]["uri"]
        await arrives(live, entity, 2)

        if PLATFORM_CONTAINER:
            # New connections for both clients, which have to use tokens that are still good.
            subprocess.run(["docker", "restart", PLATFORM_CONTAINER], check=True, capture_output=True)  # noqa: S603, S607
            await state_is(live, "active", 60)
            await arrives(live, entity, 3, 40)

        await live.stop()
        await none_left()
    finally:
        await session.logout()
        await session.close()
        httpx.put(realm, headers=headers, json={"accessTokenLifespan": before})
