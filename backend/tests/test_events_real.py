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
"""Machine events with real services: a backend started with `CALLBACK_BASE_URL` and `EVENT_WEBHOOK_SECRET`
(TEST_EVENTS_BACKEND_URL), Scorpio (TEST_BROKER_URL), and Alerta sending through its plugin (TEST_ALERTA_URL).

TEST_EVENTS_BACKEND_CONTAINER names the backend's container for the restart. TEST_KEYCLOAK_URL is for the service
identity, and TEST_FUSEKI_CALLBACK_HOST the address at which Scorpio reaches this machine.
"""

import asyncio
import json
import os
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from app.events.identity import ServiceIdentity
from app.events.subscription import ACTIVE, SUBSCRIPTION_ID, MachineWatch
from tests.conftest import make_settings

BACKEND = os.environ.get("TEST_EVENTS_BACKEND_URL")
BROKER = os.environ.get("TEST_BROKER_URL")
ALERTA = os.environ.get("TEST_ALERTA_URL")
ALERTA_KEY = os.environ.get("TEST_ALERTA_KEY")
SECRET = os.environ.get("TEST_EVENT_SECRET")
CONTAINER = os.environ.get("TEST_EVENTS_BACKEND_CONTAINER")
KEYCLOAK = os.environ.get("TEST_KEYCLOAK_URL")
CALLBACK_HOST = os.environ.get("TEST_FUSEKI_CALLBACK_HOST")

pytestmark = [
    pytest.mark.services,
    pytest.mark.skipif(not (BACKEND and BROKER), reason="needs TEST_EVENTS_BACKEND_URL"),
]
ENTITIES = f"{BROKER}/ngsi-ld/v1/entities"
SUBSCRIPTIONS = f"{BROKER}/ngsi-ld/v1/subscriptions"
JSON = {"Content-Type": "application/json"}
ACCEPT = {"Accept": "application/json"}


async def until(check, seconds=45, what="condition"):
    deadline = time.monotonic() + seconds
    while True:
        found = await check()
        if found:
            return found
        if time.monotonic() > deadline:
            raise AssertionError(f"{what} didn't happen within {seconds} s")
        await asyncio.sleep(0.5)


async def runs_of(machine):
    async with httpx.AsyncClient(timeout=10) as client:
        found = (await client.get(f"{BACKEND}/api/agent/runs")).json()
    return [r for r in found if r["machine_id"] == machine]


async def set_status(machine, value):
    async with httpx.AsyncClient(timeout=10) as client:
        body = {"status": {"type": "Property", "value": value}}
        response = await client.post(f"{ENTITIES}/{machine}/attrs", json=body, headers=JSON)
    assert response.status_code in (204, 207), response.text


async def subscribed():
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(f"{SUBSCRIPTIONS}/{SUBSCRIPTION_ID}", headers=ACCEPT)
    return response.status_code == 200


async def machine_subscriptions():
    async with httpx.AsyncClient(timeout=10) as client:
        found = (await client.get(SUBSCRIPTIONS, params={"limit": 1000}, headers=ACCEPT)).json()
    return [s for s in found if s["id"] == SUBSCRIPTION_ID or "/events/ngsi" in str(s.get("notification"))]


async def check_state():
    async with httpx.AsyncClient(timeout=10) as client:
        report = (await client.get(f"{BACKEND}/api/diagnostics", params={"fresh": "true"})).json()
    return next(c for c in report["checks"] if c["id"] == "machine_events")


@pytest.fixture
async def machine():
    machine_id = f"urn:ngsi-ld:Machine:events-{uuid.uuid4().hex[:10]}"
    async with httpx.AsyncClient(timeout=10) as client:
        # Nothing watched yet, as creating a machine with a watched attribute notifies too.
        body = {"id": machine_id, "type": "Machine", "name": {"type": "Property", "value": "Test"}}
        assert (await client.post(ENTITIES, json=body, headers=JSON)).status_code == 201
    yield machine_id
    async with httpx.AsyncClient(timeout=30) as client:
        for run in await runs_of(machine_id):
            await client.post(f"{BACKEND}/api/agent/stop/{run['run_id']}", json={})
            await client.post(f"{BACKEND}/api/agent/archive/{run['run_id']}")
        await client.delete(f"{ENTITIES}/{machine_id}")


@pytest.fixture(scope="module", autouse=True)
def _no_subscription_left():
    """Later tests change machines, and shouldn't start runs by that."""
    yield
    httpx.delete(f"{SUBSCRIPTIONS}/{SUBSCRIPTION_ID}", timeout=10)


async def test_the_subscription_shows_in_health():
    await until(subscribed, what="the subscription")
    state = await until(check_state)
    assert state["status"] == "ok"
    assert "Subscribed" in state["detail"]
    assert SECRET not in state["detail"]


async def test_a_status_change_starts_one_run_and_repeats_start_nothing(machine):
    await until(subscribed, what="the subscription")
    await asyncio.sleep(1)
    assert await runs_of(machine) == []
    await set_status(machine, "fault")

    async def one_run():
        return await runs_of(machine)

    [run] = await until(one_run, what="a run")
    assert run["source"] == "ngsi"
    assert run["machine_id"] == machine
    assert "status=fault" in run["issue"]

    async def paused():
        async with httpx.AsyncClient(timeout=10) as client:
            found = (await client.get(f"{BACKEND}/api/agent/status/{run['run_id']}")).json()
        return found if found["status"] != "running" else None

    stored = await until(paused, what="the run to pause")
    assert stored["incident_id"] is not None

    for value in ("fault", "fault-2", "fault-3"):
        await set_status(machine, value)
    await asyncio.sleep(3)
    assert [r["run_id"] for r in await runs_of(machine)] == [run["run_id"]]


@pytest.mark.skipif(not ALERTA, reason="needs TEST_ALERTA_URL")
async def test_an_alert_in_alerta_starts_a_run(machine):
    alert = {
        "resource": machine,
        "event": f"Overheating-{uuid.uuid4().hex[:6]}",
        "environment": "Production",
        "severity": "major",
        "service": ["xana-test"],
        "text": "Oil at 92 C",
    }
    headers = {"Authorization": f"Key {ALERTA_KEY}"}
    async with httpx.AsyncClient(timeout=15) as client:
        assert (await client.post(f"{ALERTA}/alert", json=alert, headers=headers)).status_code == 201

        async def one_run():
            return await runs_of(machine)

        [run] = await until(one_run, what="a run from the alert")
        assert run["source"] == "alert"
        assert alert["event"] in run["issue"]
        # The same alert again is a repeat, and a healthy one has nothing to diagnose.
        assert (await client.post(f"{ALERTA}/alert", json=alert, headers=headers)).status_code == 201
        healthy = {**alert, "event": "Fine", "severity": "ok"}
        assert (await client.post(f"{ALERTA}/alert", json=healthy, headers=headers)).status_code == 201
    await asyncio.sleep(3)
    assert len(await runs_of(machine)) == 1


async def test_without_the_secret_the_real_route_refuses(machine):
    async with httpx.AsyncClient(timeout=10) as client:
        body = {"machine_id": machine, "issue": "x"}
        assert (await client.post(f"{BACKEND}/events/alert", json=body)).status_code == 401
        wrong = {"Authorization": "Bearer wrong"}
        assert (await client.post(f"{BACKEND}/events/alert", json=body, headers=wrong)).status_code == 401
    await asyncio.sleep(1)
    assert await runs_of(machine) == []


@pytest.mark.skipif(not CONTAINER, reason="needs TEST_EVENTS_BACKEND_CONTAINER")
async def test_a_restart_makes_no_duplicate_and_a_paused_run_still_counts(machine):
    await until(subscribed, what="the subscription")
    await set_status(machine, "fault")

    async def one_run():
        found = await runs_of(machine)
        return found if found and found[0]["status"] != "running" else None

    [run] = await until(one_run, what="a paused run")
    subprocess.run(["docker", "restart", CONTAINER], check=True, capture_output=True)  # noqa: S603, S607

    async def back():
        try:
            return (await check_state())["status"] == "ok"
        except httpx.HTTPError:
            return False

    await until(back, 90, "the backend")
    assert len(await machine_subscriptions()) == 1
    await set_status(machine, "fault-again")
    await asyncio.sleep(3)
    assert [r["run_id"] for r in await runs_of(machine)] == [run["run_id"]]


# On data with full IRIs, under a context ---------------------------------------------------------


class _Listener(BaseHTTPRequestHandler):
    context = {}
    received = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        payload = json.dumps(self.context).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/ld+json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.received.append((self.headers.get("Authorization"), json.loads(body)))
        self.send_response(204)
        self.end_headers()


@pytest.mark.skipif(not CALLBACK_HOST, reason="needs TEST_FUSEKI_CALLBACK_HOST")
async def test_on_data_with_full_iris_the_subscription_matches_under_a_context():
    base = "https://platform.example.org/v0.1/"
    _Listener.context = {
        "@context": [
            "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld",
            {name: f"{base}{name}" for name in ("Machine", "status", "errorCode", "alarmLevel", "faultCode")},
        ]
    }
    _Listener.received = []
    server = ThreadingHTTPServer(("0.0.0.0", 0), _Listener)  # noqa: S104
    threading.Thread(target=server.serve_forever, daemon=True).start()
    address = f"http://{CALLBACK_HOST}:{server.server_address[1]}"
    tenant = f"xanaevents{uuid.uuid4().hex[:8]}"
    settings = make_settings(
        ngsi_url=BROKER,
        ngsi_tenant=tenant,
        ngsi_context_url=f"{address}/context.jsonld",
        callback_base_url=address,
        event_webhook_secret="iri-test-secret",
        # `status` in full: as a short name it means the core context's term, whatever another context says.
        machine_watch_type="Machine",
        machine_watch_attributes=f"{base}status,errorCode,alarmLevel,faultCode",
    )
    headers = {"Content-Type": "application/json", "NGSILD-Tenant": tenant}
    machine = f"urn:ngsi-ld:Machine:iri-{uuid.uuid4().hex[:8]}"
    try:
        watch = MachineWatch(settings, lambda: None, False)
        async with httpx.AsyncClient(timeout=20) as client:
            entity = {
                "id": machine,
                "type": f"{base}Machine",
                f"{base}status": {"type": "Property", "value": "running"},
            }
            assert (await client.post(ENTITIES, json=entity, headers=headers)).status_code == 201
            await watch.check()
            assert watch.state == ACTIVE, watch.detail
            await watch.check()  # a second start's way: nothing to do

        # Written until it comes through: a slower broker takes a moment to set up a new tenant and subscription.
        async def delivered():
            async with httpx.AsyncClient(timeout=20) as client:
                value = f"fault-{uuid.uuid4().hex[:6]}"
                body = {f"{base}status": {"type": "Property", "value": value}}
                changed = await client.patch(f"{ENTITIES}/{machine}/attrs", json=body, headers=headers)
                assert changed.status_code == 204
            await asyncio.sleep(2)
            return _Listener.received

        await until(delivered, 90, "a notification")
        authorization, notification = _Listener.received[0]
        assert authorization == "Bearer iri-test-secret"
        [reported] = notification["data"]
        assert reported["id"] == machine
        names = [name for name in reported if name.rsplit("/", 1)[-1] == "status"]
        assert names, reported
        assert reported[names[0]]["value"].startswith("fault")
    finally:
        async with httpx.AsyncClient(timeout=10) as client:
            tenant_only = {"NGSILD-Tenant": tenant}
            await client.delete(f"{SUBSCRIPTIONS}/{SUBSCRIPTION_ID}", headers=tenant_only)
            await client.delete(f"{ENTITIES}/{machine}", headers=tenant_only)
        server.shutdown()
        server.server_close()


@pytest.mark.skipif(not KEYCLOAK, reason="needs TEST_KEYCLOAK_URL")
async def test_a_real_token_from_the_service_client():
    settings = make_settings(
        keycloak_url=KEYCLOAK,
        keycloak_service_client_id="xana-events",
        keycloak_service_client_secret="local-development-only-secret",
    )
    identity = ServiceIdentity(settings)
    assert await identity.renew()
    assert identity.token()
    wrong = make_settings(
        keycloak_url=KEYCLOAK, keycloak_service_client_id="xana-events", keycloak_service_client_secret="wrong"
    )
    refused = ServiceIdentity(wrong)
    assert await refused.renew() is None
    assert "401" in refused.problem
