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
import logging

import httpx
import psycopg
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import errors
from app.api import gateway as gateway_api
from app.config import ConfigError, load_settings
from app.dataspace.connection import MAX_RENEW_FAILURES, GatewayConnection
from app.dataspace.credentials import CredentialStore, StoredCredential
from app.dataspace.gateway import GatewayClient
from app.errors import Refused
from app.health import HealthService
from app.main import AgentDeps, create_app
from app.memory.migrate import Migrator
from app.memory.store import Database, StoreUnavailable
from app.runs.machines import MachineResolver
from tests.conftest import CLOSED_HTTP, make_settings
from tests.dataspace_support import BUILDER, FACTORY, KEY, SECRET, Dataspace, gateway_settings, jwt
from xana_agent.testing import FakeContextSource, FakeHistorySource, StepScript, sample_entities, sample_history


class MemoryStore:
    """The credential store's behaviour, without a database."""

    def __init__(self, stored=None, down=False):
        self.stored = stored or StoredCredential()
        self.down = down
        self.saved: list[tuple[str, str]] = []

    async def read(self):
        if self.down:
            raise StoreUnavailable("The memory database is not reachable.")
        return self.stored

    async def save_secret(self, client_id, secret):
        if self.down:
            raise StoreUnavailable("The memory database is not reachable.")
        self.saved.append((client_id, secret))
        self.stored = StoredCredential(secret=secret)

    async def set_connect_wanted(self, wanted):
        if self.down:
            raise StoreUnavailable("The memory database is not reachable.")
        self.stored = StoredCredential(secret=self.stored.secret, connect_wanted=wanted)


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


def connection(space=None, store=None, company=lambda: None, clock=None, check_every_s=3600, **settings):
    space = space or Dataspace()
    return GatewayConnection(
        gateway_settings(**settings),
        store or MemoryStore(),
        company_id=company,
        transport=space.transport(),
        clock=clock or Clock(),
        check_every_s=check_every_s,
    )


# ── Settings ────────────────────────────────────────────────────────────────


def test_gateway_without_a_key_stops_startup_naming_it(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "http://gateway")
    monkeypatch.setenv("GATEWAY_KEYCLOAK_URL", "http://keycloak")
    with pytest.raises(ConfigError) as caught:
        load_settings(_env_file=None)
    assert "SETTINGS_ENCRYPTION_KEY is required when GATEWAY_URL is set" in str(caught.value)
    assert "Fernet.generate_key" in str(caught.value)


def test_invalid_key_stops_startup_without_showing_it(monkeypatch):
    monkeypatch.setenv("SETTINGS_ENCRYPTION_KEY", "not-a-usable-key-value")
    with pytest.raises(ConfigError) as caught:
        load_settings(_env_file=None)
    assert "SETTINGS_ENCRYPTION_KEY is not a valid key" in str(caught.value)
    assert "not-a-usable-key-value" not in str(caught.value)


def test_no_gateway_needs_no_key():
    assert make_settings().settings_encryption_key is None


def test_gateway_needs_the_identity_provider(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "http://gateway")
    monkeypatch.setenv("SETTINGS_ENCRYPTION_KEY", KEY)
    with pytest.raises(ConfigError, match="GATEWAY_KEYCLOAK_URL is required"):
        load_settings(_env_file=None)


def test_secrets_are_masked():
    settings = gateway_settings(gateway_client_secret=SECRET)
    redact = settings.redactor()
    assert SECRET not in redact(f"failed with {SECRET}")
    assert KEY not in redact(f"failed with {KEY}")


# ── Connecting ──────────────────────────────────────────────────────────────


async def test_connect_with_a_secret_stores_it_and_answers_without_it():
    store = MemoryStore()
    conn = connection(store=store)
    status = await conn.connect(SECRET)
    assert status["state"] == "connected"
    assert status["participant_id"] == FACTORY
    assert status["credential_configured"] is True
    assert status["expires_at"]
    assert SECRET not in str(status) and conn.token() not in str(status)
    assert store.saved == [(FACTORY, SECRET)]
    await conn.close()


async def test_a_rejected_secret_keeps_the_stored_one():
    store = MemoryStore(StoredCredential(secret=SECRET))
    conn = connection(store=store)
    with pytest.raises(Refused) as caught:
        await conn.connect("wrong")
    assert caught.value.kind == "unauthorized"
    assert store.stored.secret == SECRET and store.saved == []
    assert conn.token() is None


async def test_unreachable_provider_is_told_apart_from_a_rejected_secret():
    space = Dataspace()
    space.provider_down = True
    with pytest.raises(Refused) as caught:
        await connection(space).connect(SECRET)
    assert caught.value.kind == "unavailable" and "identity provider" in caught.value.message


@pytest.mark.parametrize("answer", [{"expires_in": 300}, {"access_token": "t"}, {"access_token": 1, "expires_in": 3}])
async def test_unusable_answer_from_the_provider(answer):
    def handle(request):
        return httpx.Response(200, json=answer)

    conn = GatewayConnection(gateway_settings(), MemoryStore(), transport=httpx.MockTransport(handle), clock=Clock())
    with pytest.raises(Refused) as caught:
        await conn.connect(SECRET)
    assert caught.value.kind == "unavailable"


async def test_unreachable_gateway_does_not_connect_or_store():
    space = Dataspace()
    space.gateway_down = True
    store = MemoryStore()
    conn = connection(space, store)
    with pytest.raises(Refused) as caught:
        await conn.connect(SECRET)
    assert caught.value.kind == "unavailable" and "gateway" in caught.value.message
    assert conn.token() is None and store.saved == []


async def test_a_token_without_the_claim_is_refused_early():
    def handle(request):
        return httpx.Response(200, json={"access_token": jwt(azp="x"), "expires_in": 300})

    conn = GatewayConnection(gateway_settings(), MemoryStore(), transport=httpx.MockTransport(handle), clock=Clock())
    with pytest.raises(Refused) as caught:
        await conn.connect(SECRET)
    assert caught.value.kind == "conflict" and "participant_id" in caught.value.message
    assert conn.token() is None


async def test_client_id_comes_from_the_operator_first():
    space = Dataspace()
    conn = connection(space, company=lambda: "urn:ifric:company-of-the-claim")
    status = await conn.connect(SECRET)
    assert status["participant_id"] == "urn:ifric:company-of-the-claim"
    await conn.close()


async def test_not_configured():
    conn = connection(gateway_client_id=None)
    status = await conn.status()
    assert status["state"] == "not_configured" and status["sharing_tier"] is None
    with pytest.raises(Refused) as caught:
        await conn.connect(SECRET)
    assert caught.value.kind == "conflict"
    with pytest.raises(Refused) as caught:
        await conn.disconnect()
    assert caught.value.kind == "conflict"


async def test_no_secret_anywhere_asks_for_one():
    with pytest.raises(Refused) as caught:
        await connection().connect()
    assert caught.value.kind == "invalid"


async def test_environment_secret_comes_before_the_stored_one():
    store = MemoryStore(StoredCredential(secret="old-rotated-secret"))
    conn = connection(store=store, gateway_client_secret=SECRET)
    assert (await conn.status())["credential_configured"] is True
    assert (await conn.connect())["state"] == "connected"
    assert store.saved == [(FACTORY, SECRET)]
    await conn.close()


async def test_unreadable_stored_secret_refuses_and_asks_again():
    store = MemoryStore(StoredCredential(unreadable=True))
    conn = connection(store=store)
    with pytest.raises(Refused) as caught:
        await conn.connect()
    assert caught.value.kind == "conflict" and "Enter the secret again" in caught.value.message
    status = await conn.status()
    assert status["credential_configured"] is False and "Enter the secret again" in status["detail"]
    assert (await conn.connect(SECRET))["state"] == "connected"
    await conn.close()


async def test_typed_secret_that_cannot_be_stored_changes_nothing():
    store = MemoryStore(down=True)
    conn = connection(store=store)
    with pytest.raises(Refused) as caught:
        await conn.connect(SECRET)
    assert caught.value.kind == "unavailable"
    assert conn.token() is None


async def test_status_works_with_the_database_down():
    conn = connection(store=MemoryStore(down=True))
    status = await conn.status()
    assert status["state"] == "disconnected" and status["credential_configured"] is False


async def test_disconnect_is_remembered():
    store = MemoryStore()
    conn = connection(store=store)
    await conn.connect(SECRET)
    await conn.disconnect()
    assert (await conn.status())["state"] == "disconnected" and conn.token() is None
    assert store.stored.connect_wanted is False
    assert await conn.connect_if_wanted() is False and conn.token() is None
    assert (await conn.connect())["state"] == "connected"
    assert store.stored.connect_wanted is True
    await conn.close()


async def test_connect_if_wanted_with_nothing_stored_does_nothing():
    conn = connection()
    assert await conn.connect_if_wanted() is False


# ── Renewing ────────────────────────────────────────────────────────────────


async def test_renews_at_the_margin_and_not_before():
    space, clock = Dataspace(), Clock()
    conn = connection(space, clock=clock)
    await conn.connect(SECRET)
    first = conn.token()
    clock.now += 179  # 121 seconds left
    await conn.check()
    assert conn.token() == first and space.grants == 1
    clock.now += 1  # 120 seconds left
    await conn.check()
    assert conn.token() != first and space.grants == 2
    await conn.close()


async def test_stops_after_three_failures_and_then_shows_expired():
    space, clock = Dataspace(), Clock()
    conn = connection(space, clock=clock)
    await conn.connect(SECRET)
    clock.now += 200
    space.provider_status = 503
    for attempt in range(1, MAX_RENEW_FAILURES):
        await conn.check()
        status = await conn.status()
        assert status["state"] == "connected" and status["renewal_failures"] == attempt
        assert "It is tried again" in status["detail"]
    await conn.check()
    status = await conn.status()
    assert status["renewal_failures"] == MAX_RENEW_FAILURES and "no longer tried" in status["detail"]
    tried = len(space.requests)
    await conn.check()  # stopped: nothing more is sent
    assert len(space.requests) == tried
    clock.now += 101
    status = await conn.status()
    assert status["state"] == "expired" and conn.token() is None and "no longer tried" in status["detail"]
    # Connecting again starts afresh.
    space.provider_status = None
    status = await conn.connect()
    assert status["state"] == "connected" and status["detail"] is None and status["renewal_failures"] == 0
    await conn.close()


async def test_a_success_starts_the_count_again():
    space, clock = Dataspace(), Clock()
    conn = connection(space, clock=clock)
    await conn.connect(SECRET)
    clock.now += 200
    space.provider_down = True
    await conn.check()
    await conn.check()
    assert (await conn.status())["renewal_failures"] == 2
    space.provider_down = False
    await conn.check()
    status = await conn.status()
    assert status["renewal_failures"] == 0 and status["detail"] is None
    await conn.close()


async def test_the_loop_really_runs_and_stops():
    space, clock = Dataspace(), Clock()
    conn = connection(space, clock=clock, check_every_s=0.01)
    await conn.connect(SECRET)
    clock.now += 200
    space.provider_status = 500
    for _ in range(300):
        if (await conn.status())["renewal_failures"] >= MAX_RENEW_FAILURES:
            break
        await asyncio.sleep(0.01)
    assert (await conn.status())["renewal_failures"] == MAX_RENEW_FAILURES
    await asyncio.wait_for(conn._renewal, 2)  # ends by itself
    await conn.close()


async def test_disconnect_during_a_renewal_leaves_no_token():
    space, clock = Dataspace(), Clock()
    conn = connection(space, clock=clock)
    await conn.connect(SECRET)
    clock.now += 200
    await asyncio.gather(conn.check(), conn.disconnect())
    assert conn.token() is None
    await conn.close()


# ── Gateway requests ────────────────────────────────────────────────────────


async def connected_client(space=None, clock=None):
    space = space or Dataspace()
    conn = connection(space, clock=clock)
    await conn.connect(SECRET)
    return space, conn, GatewayClient(conn, transport=space.transport())


async def test_not_connected_is_refused_without_calling_the_gateway():
    space = Dataspace()
    client = GatewayClient(connection(space), transport=space.transport())
    with pytest.raises(Refused) as caught:
        await client.peers()
    assert caught.value.kind == "unavailable" and space.requests == []


async def test_peers_list_with_what_each_offers():
    _, conn, client = await connected_client()
    assert await client.peers() == [
        {"id": BUILDER, "name": BUILDER, "capabilities": ["mb:confidential"], "capabilities_unavailable": False}
    ]
    await conn.close()


async def test_one_peer_failing_does_not_fail_the_list():
    space, conn, client = await connected_client()
    space.status_for["GET /capabilities/access"] = 503
    peers = await client.peers()
    assert peers[0]["capabilities"] == [] and peers[0]["capabilities_unavailable"] is True
    await conn.close()


async def test_status_mapping_in_both_directions():
    space, conn, client = await connected_client()
    space.access_here[BUILDER].append({"capability": "x", "status": "denied", "source": "explicit"})
    space.access_here[BUILDER].append({"capability": "y", "status": "approved", "source": "explicit"})
    answer = await client.peer_capabilities(BUILDER)
    assert {i["capability"]: i["status"] for i in answer["at_peer"]} == {"mb:confidential": "granted"}
    assert {i["capability"]: i["status"] for i in answer["here"]} == {
        "twin:direct": "granted",
        "twin:adjacents": "default",
        "twin:history": "default",
        "x": "denied",
        "y": "granted",
    }
    await conn.close()


async def test_unknown_peer_is_not_found():
    _, conn, client = await connected_client()
    with pytest.raises(Refused) as caught:
        await client.peer_capabilities("urn:ifric:nobody")
    assert caught.value.kind == "not_found"
    await conn.close()


async def test_policies_mark_a_failing_peer():
    space, conn, client = await connected_client()
    assert (await client.policies())[0]["capabilities"][0] == {
        "capability": "twin:direct",
        "status": "granted",
        "label": None,
        "description": None,
        "decision_note": None,
    }
    space.status_for["GET /capabilities/access"] = 503
    failed = (await client.policies())[0]
    assert failed["capabilities"] == [] and "error" in failed
    await conn.close()


async def test_decide_and_decide_again():
    space, conn, client = await connected_client()
    pending = await client.capability_requests("pending")
    assert pending[0]["requester_id"] == BUILDER and pending[0]["note"] is None
    decided = await client.decide_request("r1", "approve", "This quarter")
    assert decided["status"] == "approved" and decided["note"] == "This quarter" and decided["decided_at"]
    with pytest.raises(Refused) as caught:
        await client.decide_request("r1", "deny")
    assert caught.value.kind == "conflict" and "already approved" in caught.value.message
    with pytest.raises(Refused) as caught:
        await client.decide_request("r-unknown", "deny")
    assert caught.value.kind == "not_found"
    await conn.close()


async def test_requests_list_pending_first_then_newest():
    space, conn, client = await connected_client()
    base = space.capability_requests[0]
    space.capability_requests = [
        base | {"id": "old-done", "status": "denied", "requested_at": "2026-01-01T00:00:00+00:00"},
        base | {"id": "new-done", "status": "approved", "requested_at": "2026-12-01T00:00:00+00:00"},
        base | {"id": "old", "requested_at": "2026-02-01T00:00:00+00:00"},
        base | {"id": "new", "requested_at": "2026-03-01T00:00:00+00:00"},
    ]
    assert [r["id"] for r in await client.capability_requests()] == ["new", "old", "new-done", "old-done"]
    await conn.close()


async def test_unknown_actions_never_reach_the_gateway():
    space, conn, client = await connected_client()
    before = len(space.requests)
    for call in (client.decide_request("r1", "maybe"), client.set_policy(BUILDER, "twin:direct", "grant")):
        with pytest.raises(Refused) as caught:
            await call
        assert caught.value.kind == "invalid"
    assert len(space.requests) == before
    await conn.close()


async def test_set_policy_sends_the_gateways_words():
    space, conn, client = await connected_client()
    answer = await client.set_policy(BUILDER, "twin:history", "approve")
    assert answer["status"] == "granted"
    assert space.policies == [{"consumer_id": BUILDER, "capability": "twin:history", "action": "approve"}]
    await conn.close()


@pytest.mark.parametrize(
    ("status", "kind", "http_status"),
    [
        (403, "conflict", 409),
        (404, "not_found", 404),
        (409, "conflict", 409),
        (422, "invalid", 422),
        (413, "invalid", 422),
        (502, "unavailable", 502),
        (503, "unavailable", 502),
        (504, "unavailable", 502),
    ],
)
async def test_gateway_refusals(status, kind, http_status):
    space, conn, client = await connected_client()
    space.status_for["GET /participants/compatible"] = status
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.kind == kind and caught.value.http_status == http_status
    assert "gateway.test" not in caught.value.message and conn.token() not in caught.value.message
    await conn.close()


async def test_gateway_unreachable_names_it_without_an_address():
    space, conn, client = await connected_client()
    space.gateway_down = True
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.kind == "unavailable" and "gateway" in caught.value.message
    assert "gateway.test" not in caught.value.message
    await conn.close()


async def test_answer_that_is_not_json():
    space, conn, client = await connected_client()
    original = space.route
    space.route = lambda request: httpx.Response(200, text="<html>")
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.http_status == 502
    space.route = lambda request: httpx.Response(200, json={"not": "a list"})
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.http_status == 502
    space.route = original
    await conn.close()


async def test_a_refused_token_renews_once_under_concurrent_reads():
    space, conn, client = await connected_client()
    space.valid_tokens.clear()
    answers = await asyncio.gather(*(client.compatible() for _ in range(8)))
    assert all(answer[0]["participant_id"] == BUILDER for answer in answers)
    assert space.grants == 2  # the first and exactly one renewal
    await conn.close()


async def test_a_token_refused_again_is_unavailable():
    space, conn, client = await connected_client()
    space.status_for["GET /participants/compatible"] = 401
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.kind == "unavailable"
    await conn.close()


async def test_refused_token_with_the_provider_down():
    space, conn, client = await connected_client()
    space.valid_tokens.clear()
    space.provider_down = True
    with pytest.raises(Refused) as caught:
        await client.compatible()
    assert caught.value.kind == "unavailable" and "could not be renewed" in caught.value.message
    await conn.close()


# ── Routes ──────────────────────────────────────────────────────────────────


def api(space=None, store=None, **settings):
    space = space or Dataspace()
    app = FastAPI()
    conn = connection(space, store, **settings)
    app.state.gateway_connection = conn
    app.state.gateway = GatewayClient(conn, transport=space.transport())
    errors.install(app)
    app.include_router(gateway_api.router)
    return TestClient(app), space


def test_routes_end_to_end():
    with api()[0] as client:
        assert client.get("/api/gateway/config").json()["realm"] == "dataspace"
        assert client.get("/api/gateway/status").json()["state"] == "disconnected"
        assert client.get("/api/gateway/peers").status_code == 503
        assert client.get("/api/gateway/token-claims").status_code == 503
        rejected = client.post("/api/gateway/connect", json={"secret": "wrong"})
        assert rejected.status_code == 401 and rejected.json()["error"]["kind"] == "unauthorized"
        connected = client.post("/api/gateway/connect", json={"secret": SECRET})
        assert connected.status_code == 200 and connected.json()["state"] == "connected"
        claims = client.get("/api/gateway/token-claims").json()
        assert claims["participant_id"] == FACTORY and "access_token" not in claims
        assert client.get("/api/gateway/peers").json()[0]["id"] == BUILDER
        here = client.get(f"/api/gateway/peers/{BUILDER}/capabilities").json()["here"]
        assert here[0] == {
            "capability": "twin:direct",
            "status": "granted",
            "label": None,
            "description": None,
            "decision_note": None,
        }
        assert client.get("/api/gateway/policies").json()[0]["peer_id"] == BUILDER
        assert client.get("/api/gateway/capabilities/requests").json()[0]["id"] == "r1"
        decided = client.patch("/api/gateway/capabilities/requests/r1", json={"action": "deny", "note": "No"})
        assert decided.json()["status"] == "denied"
        again = client.patch("/api/gateway/capabilities/requests/r1", json={"action": "approve"})
        assert again.status_code == 409 and "already denied" in again.json()["error"]["message"]
        body = {"consumer_id": BUILDER, "capability": "twin:direct", "action": "reset"}
        assert client.post("/api/gateway/capabilities/policy", json=body).json()["status"] == "default"
        body["action"] = "grant"
        assert client.post("/api/gateway/capabilities/policy", json=body).status_code == 422
        assert client.post("/api/gateway/disconnect").status_code == 204
        assert client.get("/api/gateway/status").json()["state"] == "disconnected"


def test_a_token_never_appears_in_any_answer():
    client, space = api()
    with client:
        answers = [client.post("/api/gateway/connect", json={"secret": SECRET}).text]
        answers += [client.get(f"/api/gateway/{route}").text for route in ("status", "config", "token-claims")]
    tokens = space.valid_tokens
    assert tokens and not any(token in text or SECRET in text for token in tokens for text in answers)


# ── Health ──────────────────────────────────────────────────────────────────


async def health_of(space, conn):
    settings = gateway_settings()
    service = HealthService(
        settings,
        Migrator(settings.postgres_memory_url.get_secret_value()),
        gateway=GatewayClient(conn, transport=space.transport()),
    )
    report = await service.report(fresh=True)
    return {c["id"]: c for c in report["checks"]}


async def test_health_when_up():
    space, conn, _ = await connected_client()
    checks = await health_of(space, conn)
    assert checks["gateway"]["status"] == "ok" and checks["connector"]["status"] == "ok"
    assert "can't be checked" in checks["connector"]["detail"]
    await conn.close()


async def test_health_when_not_connected():
    space = Dataspace()
    checks = await health_of(space, connection(space))
    assert checks["gateway"]["status"] == "ok" and checks["connector"]["status"] == "degraded"
    assert "Not connected" in checks["connector"]["detail"]


async def test_health_when_the_gateway_is_down():
    space, conn, _ = await connected_client()
    space.gateway_down = True
    checks = await health_of(space, conn)
    assert checks["gateway"]["status"] == "error" and checks["connector"]["status"] == "error"
    await conn.close()


async def test_health_when_the_adapter_fails():
    space, conn, _ = await connected_client()
    space.status_for["GET /capabilities/requests"] = 503
    checks = await health_of(space, conn)
    assert checks["gateway"]["status"] == "ok" and checks["connector"]["status"] == "error"
    await conn.close()


async def test_no_dataspace_leaves_the_overall_state_alone(caplog):
    settings = make_settings()
    service = HealthService(settings, Migrator(settings.postgres_memory_url.get_secret_value()))
    with caplog.at_level(logging.ERROR, logger="httpx"):
        report = await service.report(fresh=True)
    checks = {c["id"]: c for c in report["checks"]}
    assert checks["gateway"]["status"] == "ok" and "No dataspace" in checks["gateway"]["detail"]
    assert checks["connector"]["status"] == "ok"
    assert report["overall"] == "error"  # everything else is down, and these two don't hide that


# ── With a database: what is stored, and a restart ──────────────────────────


def app_with(url, space, **settings):
    script = StepScript("clarified")
    agent = AgentDeps(
        llm=script.model(),
        context=FakeContextSource(sample_entities()),
        history=FakeHistorySource(sample_history()),
        machines=MachineResolver(CLOSED_HTTP),
    )
    values = gateway_settings(postgres_memory_url=url, llm_provider="scripted", **settings)
    return create_app(values, agent=agent, gateway_transport=space.transport())


@pytest.mark.db
def test_the_secret_is_unreadable_in_the_database_and_survives_a_restart(fresh_database):
    url = fresh_database()
    space = Dataspace()
    with TestClient(app_with(url, space)) as client:
        assert client.post("/api/gateway/connect", json={"secret": SECRET}).json()["state"] == "connected"
    with psycopg.connect(url) as conn:
        row = conn.execute("SELECT * FROM gateway_credentials").fetchone()
        dump = str(row)
        everything = conn.execute("SELECT string_agg(t::text, '|') FROM gateway_credentials t").fetchone()[0]
    assert SECRET not in dump and SECRET not in everything
    assert SECRET[:8] not in everything
    # Decryptable with the key: this is the secret, encrypted, not something else.
    assert Fernet(KEY).decrypt(row[2].encode()).decode() == SECRET
    # A restart connects with what is stored, with nobody giving it again.
    with TestClient(app_with(url, space)) as client:
        for _ in range(200):
            status = client.get("/api/gateway/status").json()
            if status["state"] == "connected":
                break
            asyncio.run(asyncio.sleep(0.02))
        assert status["state"] == "connected"
        assert client.get("/api/gateway/peers").json()[0]["id"] == BUILDER


@pytest.mark.db
def test_a_disconnect_survives_a_restart(fresh_database):
    url = fresh_database()
    space = Dataspace()
    with TestClient(app_with(url, space)) as client:
        client.post("/api/gateway/connect", json={"secret": SECRET})
        assert client.post("/api/gateway/disconnect").status_code == 204
    grants = space.grants
    with TestClient(app_with(url, space)) as client:
        asyncio.run(asyncio.sleep(0.2))
        assert client.get("/api/gateway/status").json()["state"] == "disconnected"
    assert space.grants == grants


@pytest.mark.db
def test_another_key_refuses_and_never_falls_back(fresh_database):
    url = fresh_database()
    space = Dataspace()
    with TestClient(app_with(url, space)) as client:
        client.post("/api/gateway/connect", json={"secret": SECRET})
    other = Fernet.generate_key().decode()
    with TestClient(app_with(url, space, settings_encryption_key=other)) as client:
        asyncio.run(asyncio.sleep(0.2))
        status = client.get("/api/gateway/status").json()
        assert status["state"] == "disconnected" and status["credential_configured"] is False
        refused = client.post("/api/gateway/connect", json={})
        assert refused.status_code == 409 and "Enter the secret again" in refused.json()["error"]["message"]
        assert client.post("/api/gateway/connect", json={"secret": SECRET}).json()["state"] == "connected"


@pytest.mark.db
async def test_store_reads_through_a_real_database(fresh_database):
    url = fresh_database()
    db = Database(url)
    migrator = Migrator(url)
    await migrator.apply()
    store = CredentialStore(db, KEY, migrator.apply)
    assert await store.read() == StoredCredential()
    await store.set_connect_wanted(False)
    assert await store.read() == StoredCredential(connect_wanted=False)
    await store.save_secret(FACTORY, SECRET)
    assert await store.read() == StoredCredential(secret=SECRET)
    keyless = CredentialStore(db, None, migrator.apply)
    assert (await keyless.read()).unreadable is True
    with pytest.raises(StoreUnavailable):
        await keyless.save_secret(FACTORY, "x")
    await db.close()
