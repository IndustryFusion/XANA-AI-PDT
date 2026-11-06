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
import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import auth, errors, ngsi
from app.auth import KeycloakSession
from app.main import configure_logging
from app.ngsi.broker import ContextBroker
from app.ngsi.live import QUEUE_SIZE, RENEW_BEFORE_S, SUBSCRIPTION_NAME, LiveUpdates, Refusal, parse_notification
from app.redact import Redactor
from tests.conftest import make_settings

TOKEN_A = "eyJhbGciOiJSUzI1NiJ9.token-a-payload.token-a-signature"
TOKEN_B = "eyJhbGciOiJSUzI1NiJ9.token-b-payload.token-b-signature"


def notification(entity_id="urn:m:1", entity_type="Machine", **attributes):
    data = {"id": entity_id, "type": entity_type, **attributes}
    return json.dumps({"metadata": [], "body": {"type": "Notification", "data": [data]}}).encode()


class FakeBroker:
    """A context broker's subscriptions, as the real one was measured to handle them."""

    def __init__(self) -> None:
        self.subscriptions: dict[str, dict] = {}
        self.requests: list[httpx.Request] = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("no route", request=request)
        path = request.url.path.removeprefix("/ngsi-ld/v1/subscriptions").strip("/")
        if not path and request.method == "POST":
            body = json.loads(request.content)
            self.subscriptions[body["id"]] = body
            return httpx.Response(201)
        if not path:
            return httpx.Response(200, json=list(self.subscriptions.values()))
        current = self.subscriptions.get(path)
        if current is None:
            return httpx.Response(404, json={"detail": "subscription not found"})
        if request.method == "PATCH":
            current.update(json.loads(request.content))
            return httpx.Response(204)
        if request.method == "DELETE":
            del self.subscriptions[path]
            return httpx.Response(204)
        return httpx.Response(200, json=current)

    def uris(self) -> list[str]:
        return [s["notification"]["endpoint"]["uri"] for s in self.subscriptions.values()]


class FakeMqtt:
    """Connections on demand: messages are put in, and it can be taken down."""

    def __init__(self) -> None:
        self.passwords: list[str | None] = []
        self.queue: asyncio.Queue = asyncio.Queue()
        self.failure: Exception | None = None

    async def __call__(self, url, password, client_id, topic, on_ready):
        self.passwords.append(password)
        if self.failure:
            raise self.failure
        on_ready()
        while True:
            item = await self.queue.get()
            if isinstance(item, Exception):
                raise item
            yield item


class Clock:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


class World:
    def __init__(self, token=TOKEN_A, sign_in=True, **settings) -> None:
        self.token = token
        self.broker = FakeBroker()
        self.mqtt = FakeMqtt()
        self.clock = Clock()
        values = {"ngsi_url": "http://broker.test", "mqtt_mgmt_url": "http://mgmt.test", **settings}
        self.settings = make_settings(**values)
        broker = ContextBroker(self.settings, lambda: self.token, transport=httpx.MockTransport(self.broker))
        self.live = LiveUpdates(
            self.settings,
            lambda: self.token,
            sign_in,
            broker,
            connect=self.mqtt,
            clock=self.clock,
            tick_s=0.01,
            reconnect_s=(0.01,),
            transport=httpx.MockTransport(lambda request: httpx.Response(503)),
        )

    async def settled(self, state="active"):
        for _ in range(300):
            if self.live.health()["state"] == state:
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"state {self.live.health()} never became {state}")


@pytest.fixture
async def world():
    made = World()
    yield made
    await made.live.stop()


async def test_subscription_is_made_with_a_24_hour_life_and_an_mqtt_endpoint(world):
    world.live.start()
    await world.settled()
    [subscription] = world.broker.subscriptions.values()
    uri = subscription["notification"]["endpoint"]["uri"]
    assert uri.startswith(f"mqtt://xana-explorer:{TOKEN_A}@emqx-listeners:1883/xana/explorer/")
    assert subscription["subscriptionName"] == SUBSCRIPTION_NAME
    assert subscription["entities"] == [{"type": "*"}]
    assert subscription["notification"]["endpoint"]["receiverInfo"]
    assert world.mqtt.passwords[0] == TOKEN_A
    assert world.live.health()["status"] == "ok"
    assert world.live.health()["expires_at"]


async def test_notify_address_is_the_one_scorpio_gets(world):
    made = World(mqtt_broker_notify_url="notify-host:2883", mqtt_broker_url="own-host:1883")
    made.live.start()
    await made.settled()
    assert "@notify-host:2883/" in made.broker.uris()[0]
    await made.live.stop()


async def test_no_subscription_before_sign_in():
    made = World(token=None)
    made.live.start()
    await asyncio.sleep(0.05)
    assert made.broker.requests == []
    assert made.mqtt.passwords == []
    assert made.live.health()["state"] == "waiting_for_sign_in"
    assert made.live.health()["status"] == "unavailable"
    await made.live.stop()


async def test_without_sign_in_nothing_carries_a_token():
    made = World(token=None, sign_in=False)
    made.live.start()
    await made.settled()
    assert made.mqtt.passwords[0] is None
    uri = made.broker.uris()[0]
    assert uri.startswith("mqtt://emqx-listeners:1883/")
    await made.live.stop()


async def test_no_subscription_while_the_mqtt_broker_is_down():
    made = World()
    made.mqtt.failure = OSError("refused")
    made.live.start()
    await made.settled("broker_unavailable")
    await asyncio.sleep(0.05)
    assert made.broker.subscriptions == {}
    assert made.live.health()["status"] == "unavailable"
    assert "cannot be reached" in made.live.health()["detail"]
    await made.live.stop()


async def test_token_rotation_updates_the_subscription_in_place(world):
    world.live.start()
    await world.settled()
    world.token = TOKEN_B
    for _ in range(300):
        if TOKEN_B in world.broker.uris()[0]:
            break
        await asyncio.sleep(0.01)
    [uri] = world.broker.uris()
    assert TOKEN_B in uri and TOKEN_A not in uri
    assert sum(r.method == "POST" for r in world.broker.requests) == 1
    assert world.mqtt.passwords == [TOKEN_A]  # the connection stays


async def test_reconnect_uses_the_newest_token(world):
    world.live.start()
    await world.settled()
    world.token = TOKEN_B
    await world.mqtt.queue.put(OSError("dropped"))
    for _ in range(300):
        if len(world.mqtt.passwords) > 1:
            break
        await asyncio.sleep(0.01)
    assert world.mqtt.passwords[-1] == TOKEN_B
    await world.settled()


async def test_renewal_before_expiry_and_not_too_early(world):
    world.live.start()
    await world.settled()
    patches = lambda: [r for r in world.broker.requests if r.method == "PATCH"]  # noqa: E731
    world.clock.now += 3600
    await asyncio.sleep(0.05)
    assert patches() == []
    before = next(iter(world.broker.subscriptions.values()))["expiresAt"]
    world.clock.now += 24 * 3600 - RENEW_BEFORE_S
    for _ in range(300):
        if patches():
            break
        await asyncio.sleep(0.01)
    assert next(iter(world.broker.subscriptions.values()))["expiresAt"] > before


async def test_a_subscription_removed_in_the_broker_comes_back(world):
    world.live.start()
    await world.settled()
    world.broker.subscriptions.clear()
    world.clock.now += 61
    for _ in range(300):
        if world.broker.subscriptions:
            break
        await asyncio.sleep(0.01)
    assert len(world.broker.subscriptions) == 1


async def test_context_broker_down_says_so_and_recovers():
    made = World()
    made.broker.down = True
    made.live.start()
    await made.settled("subscription_failed")
    assert made.live.health()["status"] == "unavailable"
    made.broker.down = False
    await made.settled()
    await made.live.stop()


async def test_refused_token_names_the_role():
    made = World()
    made.mqtt.failure = Refusal()
    made.live.start()
    await made.settled("refused")
    assert "Factory-Reader" in made.live.health()["detail"]
    assert made.broker.subscriptions == {}
    await made.live.stop()


async def test_lost_broker_returns_by_itself_and_keeps_the_subscription(world):
    world.live.start()
    await world.settled()
    world.mqtt.failure = OSError("down")
    await world.mqtt.queue.put(OSError("dropped"))
    await world.settled("broker_unavailable")
    assert world.live.health()["status"] == "unavailable"
    assert len(world.broker.subscriptions) == 1
    world.mqtt.failure = None
    await world.settled()
    watcher = world.live.watch(ids=["urn:m:1"])
    await world.mqtt.queue.put(notification())
    assert (await asyncio.wait_for(watcher.queue.get(), 1))["entity_id"] == "urn:m:1"


async def test_stop_deletes_the_subscription(world):
    world.live.start()
    await world.settled()
    await world.live.stop()
    assert world.broker.subscriptions == {}
    assert world.live.health()["state"] == "stopped"


async def test_stop_succeeds_when_deleting_fails(world):
    world.live.start()
    await world.settled()
    world.broker.down = True
    await world.live.stop()
    assert world.live.health()["state"] == "stopped"


async def test_session_lost_stops_listening_and_a_new_sign_in_cleans_up(world):
    world.live.start()
    await world.settled()
    world.broker.down = True  # it can't be deleted now
    world.token = None
    await world.settled("waiting_for_sign_in")
    left = dict(world.broker.subscriptions)
    assert len(left) == 1
    world.broker.down = False
    world.token = TOKEN_B
    await world.settled()
    assert len(world.broker.subscriptions) == 1


async def test_start_removes_what_an_earlier_process_left_but_nothing_else(world):
    world.broker.subscriptions["urn:old"] = {"id": "urn:old", "subscriptionName": SUBSCRIPTION_NAME}
    world.broker.subscriptions["urn:other"] = {"id": "urn:other", "subscriptionName": "someone-elses"}
    world.live.start()
    await world.settled()
    assert "urn:old" not in world.broker.subscriptions
    assert "urn:other" in world.broker.subscriptions
    assert len(world.broker.subscriptions) == 2


async def test_two_starts_make_one_subscription(world):
    world.live.start()
    world.live.start()
    await world.settled()
    world.live.start()
    await asyncio.sleep(0.03)
    assert len(world.broker.subscriptions) == 1


# Delivery -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [b"not json", b"[]", b'{"body": 1}', b'{"body": {"data": "x"}}', b'{"body": {"data": [1, {"type": "T"}]}}'],
)
def test_what_is_not_a_notification_gives_no_change(payload):
    assert parse_notification(payload) == []


async def test_bad_message_does_not_stop_the_stream(world):
    world.live.start()
    await world.settled()
    watcher = world.live.watch(ids=["urn:m:1"])
    await world.mqtt.queue.put(b"garbage")
    await world.mqtt.queue.put(notification(status={"type": "Property", "value": "ON"}))
    change = await asyncio.wait_for(watcher.queue.get(), 1)
    assert change["attributes"]["status"]["value"] == "ON"
    assert world.live.health()["status"] == "ok"


def test_filters(world=None):
    live = World().live
    by_id = live.watch(ids=["urn:a"])
    by_type = live.watch(entity_type="T")
    everything = live.watch()
    live.deliver(notification("urn:a", "U"))
    live.deliver(notification("urn:b", "T"))
    live.deliver(notification("urn:c", ["T", "V"]))
    assert by_id.queue.qsize() == 1
    assert by_type.queue.qsize() == 2
    assert everything.queue.qsize() == 3


def test_attribute_names_are_not_changed():
    [change] = parse_notification(notification(max_temp={"type": "Property", "value": 1}, **{"https://x/a_b": {}}))
    assert set(change["attributes"]) == {"max_temp", "https://x/a_b"}


def test_slow_watcher_is_marked_and_others_get_everything():
    live = World().live
    slow = live.watch()
    fast = live.watch()
    for i in range(QUEUE_SIZE + 10):
        live.deliver(notification(f"urn:m:{i}"))
        if not fast.queue.empty():
            fast.queue.get_nowait()
    assert slow.overflowed is True
    assert fast.overflowed is False


async def test_many_watchers_each_get_all_of_their_changes_in_order(world):
    world.live.start()
    await world.settled()
    watchers = {f"urn:m:{i}": world.live.watch(ids=[f"urn:m:{i}"]) for i in range(20)}
    for n in range(100):
        for entity_id in watchers:
            await world.mqtt.queue.put(notification(entity_id, n={"type": "Property", "value": n}))

    async def read(watcher):
        return [(await asyncio.wait_for(watcher.queue.get(), 5))["attributes"]["n"]["value"] for _ in range(100)]

    results = await asyncio.gather(*(read(w) for w in watchers.values()))
    assert all(result == list(range(100)) for result in results)


# Routes ---------------------------------------------------------------------------------------


def app_for(made: World) -> FastAPI:
    app = FastAPI()
    app.state.live = made.live
    app.state.stream_keepalive_s = 0.05
    errors.install(app)
    app.include_router(ngsi.router)
    return app


def test_stream_route_filters_and_passes_names_unchanged():
    made = World()
    with TestClient(app_for(made)) as client, client.websocket_connect("/api/ngsi/ws?ids=urn:a,urn:b") as socket:
        made.live.deliver(notification("urn:other"))
        made.live.deliver(notification("urn:a", "T", max_temp={"type": "Property", "value": 1}))
        message = _next_change(socket)
    assert message["entity_id"] == "urn:a"
    assert message["attributes"]["max_temp"]["value"] == 1
    assert made.live._watchers == set()


def _next_change(socket):
    while True:
        message = socket.receive_json()
        if message["type"] != "keepalive":
            return message


def test_stream_route_sends_keepalives():
    made = World()
    with TestClient(app_for(made)) as client, client.websocket_connect("/api/ngsi/ws") as socket:
        assert socket.receive_json() == {"type": "keepalive"}


def test_slow_client_is_closed_after_what_it_had():
    made = World()
    with TestClient(app_for(made)) as client, client.websocket_connect("/api/ngsi/ws") as socket:
        watcher = next(iter(made.live._watchers))
        watcher.overflowed = True
        with pytest.raises(WebSocketDisconnect) as closed:
            while True:  # a keepalive may already be on its way
                socket.receive_json()
    assert closed.value.code == 1013


def test_health_route_never_holds_the_endpoint():
    async def scenario():
        made = World()
        made.live.start()
        await made.settled()
        answer = made.live.health()
        await made.live.stop()
        return answer

    answer = asyncio.run(scenario())
    assert set(answer) == {"status", "state", "detail", "expires_at"}
    assert "mqtt://" not in json.dumps(answer)
    assert "token" not in json.dumps(answer)


def test_sign_out_deletes_the_subscription_first():
    order = []

    class Live:
        async def stop(self):
            order.append("live")

    class Session:
        async def logout(self):
            order.append("session")

    app = FastAPI()
    app.state.live = Live()
    app.state.session = Session()
    app.include_router(auth.router)
    assert TestClient(app).post("/api/auth/logout").status_code == 204
    assert order == ["live", "session"]


async def test_sign_in_starts_live_updates():
    from app.main import create_app

    settings = make_settings(keycloak_url="http://keycloak.test")
    app = create_app(settings, session=KeycloakSession(settings))
    assert app.state.live._task is None
    assert len(app.state.session.on_sign_in) == 1
    await app.state.session.on_sign_in[0]()
    assert app.state.live._task is not None
    await app.state.live.stop()


# Tokens in logs -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "secret"),
    [
        (f"connect to mqtt://user:{TOKEN_A}@emqx:1883/t failed", TOKEN_A),
        (f"token {TOKEN_A} rejected", TOKEN_A),
        (f"Authorization: Bearer {TOKEN_A}", TOKEN_A),
        ("Authorization: Bearer plain-opaque-token-value", "plain-opaque-token-value"),
        ("Authorization: Key the-alert-manager-key", "the-alert-manager-key"),
        ("mqtt://u:short@h/t", "short"),
    ],
)
def test_filter_masks_tokens_it_was_never_told_about(text, secret):
    assert secret not in Redactor()(text)


def test_filter_leaves_ordinary_addresses_and_words():
    plain = "Reached http://broker:9090/path, Key points and urn:x:y at 12:30"
    assert Redactor()(plain) == plain


async def test_no_log_line_at_any_level_holds_the_token(caplog):
    caplog.set_level(logging.DEBUG)
    made = World()
    made.live.start()
    await made.settled()
    made.token = TOKEN_B
    await asyncio.sleep(0.05)
    made.broker.down = True
    made.clock.now += 3600
    await asyncio.sleep(0.05)
    await made.live.stop()
    text = caplog.text
    assert "token-a" not in text and "token-b" not in text
    assert "mqtt://" not in text


def test_configured_logging_masks_a_librarys_line(capfd):
    settings = make_settings()
    configure_logging(settings, settings.redactor())
    logging.getLogger("some.library").warning("POST mqtt://u:%s@emqx/t", TOKEN_A)
    logging.getLogger("some.library").error("failed", exc_info=(ValueError, ValueError(f"bad {TOKEN_B}"), None))
    captured = capfd.readouterr().err
    assert "token-a" not in captured and "token-b" not in captured
