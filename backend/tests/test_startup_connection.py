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
"""Connecting to the dataspace at startup, with sign-in on, and trying again while it can't be reached."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.dataspace.gateway import GatewayClient
from app.health import HealthService
from app.memory.migrate import Migrator
from tests.dataspace_support import FACTORY, SECRET, Dataspace, gateway_settings
from tests.test_gateway import MemoryStore, app_with, connection

OTHER = "urn:ifric:other-company"


async def until(condition, tries=400):
    for _ in range(tries):
        if condition():
            return True
        await asyncio.sleep(0.005)
    return condition()


def token_calls(space):
    return [r for r in space.requests if r.url.host == "keycloak.test"]


async def connector_detail(space, conn):
    settings = gateway_settings()
    service = HealthService(
        settings,
        Migrator(settings.postgres_memory_url.get_secret_value()),
        gateway=GatewayClient(conn, transport=space.transport()),
    )
    checks = {c["id"]: c for c in (await service.report(fresh=True))["checks"]}
    return checks["dataspace_connector"]


# ── The connection on its own ───────────────────────────────────────────────


async def test_unreachable_at_startup_is_tried_until_it_connects():
    space = Dataspace()
    space.provider_down = True
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret=SECRET)
    conn.start()
    # More than the 3 tries there used to be, and still trying.
    assert await until(lambda: len(token_calls(space)) >= 5)
    status = await conn.status()
    assert status["state"] == "disconnected" and status["connecting"] is True
    check = await connector_detail(space, conn)
    assert check["status"] == "degraded"
    assert "can't be reached" in check["detail"] and "tried again" in check["detail"]
    assert "keycloak.test" not in check["detail"] and SECRET not in check["detail"]
    space.provider_down = False
    assert await until(lambda: conn.token() is not None)
    status = await conn.status()
    assert status["state"] == "connected" and status["connecting"] is False and status["detail"] is None
    check = await connector_detail(space, conn)
    assert check["status"] == "ok" and "failed" not in check["detail"]
    await conn.close()


async def test_a_rejected_credential_is_not_tried_again():
    space = Dataspace()
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret="wrong")
    conn.start()
    assert await until(lambda: len(token_calls(space)) == 1)
    await asyncio.sleep(0.1)
    assert len(token_calls(space)) == 1
    status = await conn.status()
    assert status["connecting"] is False and "rejected" in status["detail"]
    check = await connector_detail(space, conn)
    assert "rejected" in check["detail"] and "not tried again" in check["detail"]
    await conn.close()


async def test_a_disconnect_stops_the_tries():
    space = Dataspace()
    space.provider_down = True
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret=SECRET)
    conn.start()
    assert await until(lambda: len(token_calls(space)) >= 2)
    await conn.disconnect()
    tried = len(token_calls(space))
    space.provider_down = False
    await asyncio.sleep(0.1)
    assert len(token_calls(space)) == tried and conn.token() is None
    assert (await conn.status())["connecting"] is False
    await conn.close()


async def test_shutting_down_stops_the_tries():
    space = Dataspace()
    space.provider_down = True
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret=SECRET)
    conn.start()
    assert await until(lambda: len(token_calls(space)) >= 2)
    await conn.close()
    tried = len(token_calls(space))
    await asyncio.sleep(0.1)
    assert len(token_calls(space)) == tried


async def test_concurrent_attempts_leave_one_grant_and_one_renewal():
    space = Dataspace()
    conn = connection(space, store=MemoryStore(), gateway_client_secret=SECRET)
    conn.start()
    await asyncio.gather(conn.on_sign_in(), *(conn.connect_if_wanted() for _ in range(3)))
    assert await until(lambda: conn.token() is not None)
    await asyncio.sleep(0.05)
    assert space.grants == 1
    renewals = [t for t in asyncio.all_tasks() if t.get_coro().__qualname__.endswith("_keep_fresh")]
    assert len(renewals) == 1
    await conn.close()


async def test_an_operator_of_another_company_keeps_the_connection():
    space = Dataspace()
    company = {"id": None}
    conn = connection(space, store=MemoryStore(), company=lambda: company["id"], gateway_client_secret=SECRET)
    conn.start()
    assert await until(lambda: conn.token() is not None)
    company["id"] = OTHER  # an operator whose token names another company signs in
    await conn.on_sign_in()
    await asyncio.sleep(0.05)
    assert space.grants == 1 and conn.participant_id == FACTORY
    assert (await conn.status())["client_id"] == FACTORY and conn.config()["client_id"] == FACTORY
    await conn.disconnect()
    assert (await conn.status())["client_id"] == OTHER  # what a new connection would use
    await conn.close()


# ── The backend at startup ──────────────────────────────────────────────────


def signed_in_app(url, space, **settings):
    values = {"keycloak_url": "http://sign-in.test", "inbox_poll_interval_s": 0.05} | settings
    return app_with(url, space, **values)


@pytest.mark.db
def test_sign_in_on_connects_at_startup_and_polls_the_inbox(fresh_database):
    url = fresh_database()
    space = Dataspace()
    with TestClient(signed_in_app(url, space, gateway_client_secret=SECRET)) as client:
        assert client.get("/api/auth/status").json()["valid"] is False  # nobody signed in
        for _ in range(400):
            if space.calls("GET", "/inbox/messages"):
                break
            asyncio.run(asyncio.sleep(0.01))
        status = client.get("/api/gateway/status").json()
        assert status["state"] == "connected" and status["client_id"] == FACTORY
        polled = space.calls("GET", "/inbox/messages")
        assert polled and polled[0].headers["authorization"].removeprefix("Bearer ") in space.valid_tokens


@pytest.mark.db
def test_unreachable_at_startup_does_not_stop_the_backend(fresh_database):
    url = fresh_database()
    space = Dataspace()
    space.provider_down = True
    with TestClient(signed_in_app(url, space, gateway_client_secret=SECRET)) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/api/agent/runs").status_code == 200
        status = client.get("/api/gateway/status").json()
        assert status["state"] == "disconnected"


@pytest.mark.db
@pytest.mark.parametrize(
    "settings",
    [
        {"gateway_client_id": None, "gateway_client_secret": SECRET},  # sign-in on, nobody signed in: no client
        {},  # no secret anywhere
    ],
    ids=["no client id", "no secret"],
)
def test_without_a_configured_client_nothing_is_tried(fresh_database, settings):
    url = fresh_database()
    space = Dataspace()
    with TestClient(signed_in_app(url, space, **settings)) as client:
        asyncio.run(asyncio.sleep(0.2))
        assert client.get("/api/gateway/status").json()["state"] in ("not_configured", "disconnected")
    assert not token_calls(space)


def test_without_a_gateway_nothing_is_tried():
    space = Dataspace()
    app = signed_in_app("postgresql://nobody@127.0.0.1:1/x", space, gateway_url=None, settings_encryption_key=None)
    with TestClient(app) as client:
        assert client.get("/api/gateway/status").json()["state"] == "not_configured"
    assert not space.requests


# ── A disconnect racing a connection by itself; connecting again after renewal stopped ─────


class SlowStore(MemoryStore):
    """Writes take a while, as a database's do, so a read can come before a write lands."""

    async def set_connect_wanted(self, wanted):
        await asyncio.sleep(0.05)
        await super().set_connect_wanted(wanted)


async def test_a_disconnect_during_a_sign_in_is_not_undone():
    space = Dataspace()
    store = SlowStore()
    await store.save_secret(FACTORY, SECRET)  # a secret stored, and connecting wanted
    conn = connection(space, store=store)
    # The sign-in reads "wanted" before the disconnect has stored "not wanted", then waits for the lock.
    await asyncio.gather(conn.disconnect(), conn.connect_if_wanted())
    await asyncio.sleep(0.05)
    assert conn.token() is None and space.grants == 0
    assert store.stored.connect_wanted is False
    assert (await conn.status())["state"] == "disconnected"
    await conn.close()


async def test_after_renewal_stops_the_backend_connects_again_by_itself():
    space = Dataspace()
    space.expires_in = 100  # within the renewal margin: due at once
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret=SECRET)
    await conn.connect()
    space.provider_status = 503  # the identity provider is down for longer than renewal tries
    assert await until(lambda: conn._stopped and conn._retrying)
    status = await conn.status()
    assert "renewal stopped" in status["detail"] and status["connecting"] is True
    space.provider_status = None
    assert await until(lambda: conn.token() is not None and not conn._stopped)
    status = await conn.status()
    assert status["state"] == "connected" and status["renewal_failures"] == 0 and status["connecting"] is False
    await conn.close()


async def test_after_renewal_stops_a_disconnect_ends_the_tries():
    space = Dataspace()
    space.expires_in = 100
    conn = connection(space, store=MemoryStore(), check_every_s=0.01, gateway_client_secret=SECRET)
    await conn.connect()
    space.provider_status = 503
    assert await until(lambda: conn._stopped)
    await conn.disconnect()
    tried = len(token_calls(space))
    space.provider_status = None
    await asyncio.sleep(0.1)
    assert len(token_calls(space)) == tried and conn.token() is None
    await conn.close()
