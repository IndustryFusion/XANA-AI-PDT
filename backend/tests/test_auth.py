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
"""Signing in, staying signed in, signing out, and the token reaching the context broker."""

import asyncio
import base64
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import KeycloakSession, token_claims
from app.errors import Refused
from app.health import HealthService
from app.main import AgentDeps, create_app
from app.memory.migrate import Migrator
from app.runs.machines import MachineResolver
from tests.conftest import make_settings
from xana_agent import NgsiContextSource
from xana_agent.sources.base import SourceUnavailable

PASSWORD = "correct-horse-battery"
URL = "http://keycloak.test/auth"


def jwt(n=1, **claims):
    body = {"preferred_username": "op", "name": "Op Erator", "email": "op@example.org", "n": n, **claims}
    payload = base64.urlsafe_b64encode(json.dumps(body).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


class Provider:
    """A fake identity provider that records calls and hands out numbered tokens."""

    def __init__(self, expires_in=300, **claims):
        self.expires_in = expires_in
        self.claims = claims
        self.calls = []
        self.issued = 0
        self.refresh_fails = False
        self.down = False

    def __call__(self, request):
        form = dict(pair.split("=", 1) for pair in request.content.decode().split("&"))
        self.calls.append((request.url.path, form))
        if self.down:
            raise httpx.ConnectError("refused")
        if request.url.path.endswith("/logout"):
            return httpx.Response(204)
        if form["grant_type"] == "password" and form["password"] != PASSWORD:
            return httpx.Response(401, json={"error": "invalid_grant"})
        if form["grant_type"] == "refresh_token" and self.refresh_fails:
            return httpx.Response(400, json={"error": "invalid_grant"})
        self.issued += 1
        return httpx.Response(
            200,
            json={
                "access_token": jwt(self.issued, **self.claims),
                "refresh_token": f"refresh-{self.issued}",
                "expires_in": self.expires_in,
            },
        )


def session(provider, retry_s=0.01, **settings):
    s = make_settings(keycloak_url=URL, **settings)
    return KeycloakSession(s, transport=httpx.MockTransport(provider), retry_s=retry_s)


async def test_sign_in_shows_user_factory_and_company():
    s = session(Provider(ifric_factory_id="urn:f", ifric_company_id="urn:c"))
    status = await s.connect("op", PASSWORD)
    await s.close()
    assert status["valid"] is True
    assert status["user"] == {"username": "op", "name": "Op Erator", "email": "op@example.org"}
    assert (status["factory_id"], status["company_id"]) == ("urn:f", "urn:c")
    assert 0 < status["token_expires_in_s"] <= 300


async def test_sign_in_uses_the_configured_realm_and_client():
    provider = Provider()
    s = session(provider, keycloak_realm="other", keycloak_client_id="my-client")
    await s.connect("op", PASSWORD)
    await s.close()
    path, form = provider.calls[0]
    assert path == "/auth/realms/other/protocol/openid-connect/token"
    assert form["client_id"] == "my-client"


async def test_configured_factory_is_the_fallback():
    s = session(Provider(), factory_id="urn:configured")
    assert (await s.connect("op", PASSWORD))["factory_id"] == "urn:configured"
    await s.close()


async def test_wrong_credentials_are_unauthorized():
    s = session(Provider())
    with pytest.raises(Refused) as refused:
        await s.connect("op", "wrong")
    assert (refused.value.kind, refused.value.http_status) == ("unauthorized", 401)
    assert s.status()["valid"] is False


async def test_unreachable_provider_is_unavailable():
    provider = Provider()
    provider.down = True
    with pytest.raises(Refused) as refused:
        await session(provider).connect("op", PASSWORD)
    assert (refused.value.kind, refused.value.http_status) == ("unavailable", 503)


async def test_turned_off_without_an_address():
    s = KeycloakSession(make_settings())
    assert s.config() == {"enabled": False, "provider": "Keycloak"}
    assert s.status()["valid"] is False
    with pytest.raises(Refused) as refused:
        await s.connect("op", PASSWORD)
    assert refused.value.kind == "conflict"


async def until(check, within=3):
    deadline = asyncio.get_running_loop().time() + within
    while not check():
        assert asyncio.get_running_loop().time() < deadline, "condition not reached"
        await asyncio.sleep(0.01)


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def clocked(provider, clock, retry_s=0.01):
    settings = make_settings(keycloak_url=URL)
    return KeycloakSession(settings, transport=httpx.MockTransport(provider), clock=clock, retry_s=retry_s)


async def test_token_is_refreshed_beyond_its_life():
    # A token this short is refreshed about a second after it is issued.
    provider = Provider(expires_in=61)
    s = session(provider)
    await s.connect("op", PASSWORD)
    first = s.token()
    await until(lambda: s.token() != first)
    assert token_claims(s.token())["n"] > token_claims(first)["n"]
    assert s.status()["valid"] is True
    assert any(form.get("grant_type") == "refresh_token" for _, form in provider.calls)
    await s.close()


async def test_a_passing_failure_keeps_the_session():
    provider = Provider(expires_in=61)
    s = session(provider)
    await s.connect("op", PASSWORD)
    provider.refresh_fails = True
    refreshes = lambda: sum(form.get("grant_type") == "refresh_token" for _, form in provider.calls)  # noqa: E731
    await until(lambda: refreshes() >= 2)
    assert s.status()["valid"] is True
    provider.refresh_fails = False
    before = provider.issued
    await until(lambda: provider.issued > before)
    assert s.status()["valid"] is True
    await s.close()


async def test_five_failed_refreshes_end_the_session(caplog):
    provider = Provider(expires_in=61)
    provider.refresh_fails = True
    s = session(provider)
    await s.connect("op", PASSWORD)
    with caplog.at_level(logging.WARNING):
        await until(lambda: s.token() is None, within=5)
    assert sum(form.get("grant_type") == "refresh_token" for _, form in provider.calls) == 5
    assert s.status()["valid"] is False
    assert "session ended" in caplog.text
    await s.close()


async def test_an_expired_token_is_not_used():
    clock = Clock()
    s = clocked(Provider(expires_in=300), clock)
    await s.connect("op", PASSWORD)
    assert s.token()
    clock.now += 301
    assert s.token() is None
    assert s.status()["valid"] is False
    await s.close()


async def test_sign_out_tells_the_provider():
    provider = Provider()
    s = session(provider)
    await s.connect("op", PASSWORD)
    await s.logout()
    path, form = provider.calls[-1]
    assert path.endswith("/logout")
    assert form["refresh_token"] == "refresh-1"
    assert s.token() is None


async def test_sign_out_ends_the_session_when_the_provider_is_down():
    provider = Provider()
    s = session(provider)
    await s.connect("op", PASSWORD)
    provider.down = True
    await s.logout()
    assert s.status()["valid"] is False


async def test_steps_after_sign_in_run_and_cannot_stop_it(caplog):
    s = session(Provider())
    ran = []

    async def good():
        ran.append("good")

    async def bad():
        raise RuntimeError("no")

    s.on_sign_in += [bad, good]
    with caplog.at_level(logging.ERROR):
        status = await s.connect("op", PASSWORD)
    await s.close()
    assert status["valid"] is True
    assert ran == ["good"]
    assert "A step after sign-in failed" in caplog.text


def test_api_and_nothing_secret_in_responses_or_logs(caplog):
    provider = Provider(expires_in=61)
    s = make_settings(keycloak_url=URL, llm_provider="scripted", log_level="DEBUG")
    app = create_app(s, session=KeycloakSession(s, transport=httpx.MockTransport(provider)))
    bodies = []
    with caplog.at_level(logging.DEBUG), TestClient(app) as client:
        assert client.get("/api/auth/config").json() == {"enabled": True, "provider": "Keycloak"}
        assert client.get("/api/auth/status").json()["valid"] is False
        refused = client.post("/api/auth/connect", json={"username": "op", "password": "wrong-password"})
        assert refused.status_code == 401
        assert refused.json()["error"]["kind"] == "unauthorized"
        signed_in = client.post("/api/auth/connect", json={"username": "op", "password": PASSWORD})
        assert signed_in.status_code == 200
        bodies += [refused.text, signed_in.text, client.get("/api/auth/status").text]
        assert client.get("/api/auth/status").json()["user"]["username"] == "op"
        token = app.state.session.token()
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/auth/status").json()["valid"] is False
    everything = "\n".join(bodies) + caplog.text
    for secret in (PASSWORD, "wrong-password", token, "refresh-1"):
        assert secret not in everything


def test_a_restart_has_no_session():
    provider = Provider()
    settings = make_settings(keycloak_url=URL, llm_provider="scripted")
    with TestClient(
        create_app(settings, session=KeycloakSession(settings, transport=httpx.MockTransport(provider)))
    ) as c:
        c.post("/api/auth/connect", json={"username": "op", "password": PASSWORD})
        assert c.get("/api/auth/status").json()["valid"] is True
    restarted = create_app(settings, session=KeycloakSession(settings, transport=httpx.MockTransport(provider)))
    with TestClient(restarted) as c:
        assert c.get("/api/auth/status").json()["valid"] is False


def test_turned_off_api():
    with TestClient(create_app(make_settings(llm_provider="scripted"))) as client:
        assert client.get("/api/auth/config").json()["enabled"] is False
        assert client.post("/api/auth/connect", json={"username": "a", "password": "b"}).status_code == 409


class Broker:
    """Refuses a request without the expected token."""

    token = "the-token"  # noqa: S105

    def __init__(self):
        self.seen = []

    def __call__(self, request):
        self.seen.append(request.headers.get("authorization"))
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return httpx.Response(401, json={"title": "Unauthorized"})
        if request.url.path.endswith("/types"):
            return httpx.Response(200, json={"typeList": ["Machine"]})
        if request.url.path.endswith("/entities"):
            return httpx.Response(200, json=[{"id": "urn:ngsi-ld:Machine:m1", "type": "Machine"}])
        return httpx.Response(200, json={"id": "urn:ngsi-ld:Machine:m1", "type": "Machine"})


async def test_agent_source_sends_the_token():
    broker = Broker()
    source = NgsiContextSource("http://b", transport=httpx.MockTransport(broker), token=lambda: "the-token")
    assert (await source.get("urn:ngsi-ld:Machine:m1"))["type"] == "Machine"
    assert broker.seen == ["Bearer the-token"]


async def test_agent_source_uses_the_latest_token():
    tokens = iter(["old", "the-token"])
    broker = Broker()
    source = NgsiContextSource("http://b", transport=httpx.MockTransport(broker), token=lambda: next(tokens))
    with pytest.raises(SourceUnavailable):
        await source.get("urn:ngsi-ld:Machine:m1")
    assert await source.get("urn:ngsi-ld:Machine:m1")


async def test_without_a_token_the_source_is_unavailable_and_sends_no_header():
    broker = Broker()
    source = NgsiContextSource("http://b", transport=httpx.MockTransport(broker), token=lambda: None)
    with pytest.raises(SourceUnavailable, match="401"):
        await source.get("urn:ngsi-ld:Machine:m1")
    assert broker.seen == [None]


async def test_machine_lookup_sends_the_token():
    broker = Broker()
    resolver = MachineResolver("http://b", transport=httpx.MockTransport(broker), token=lambda: "the-token")
    assert await resolver.resolve("m1") == "urn:ngsi-ld:Machine:m1"
    assert set(broker.seen) == {"Bearer the-token"}


async def test_health_check_sends_the_token():
    broker = Broker()
    settings = make_settings()
    health = HealthService(settings, Migrator(""), transport=httpx.MockTransport(broker), token=lambda: "the-token")
    assert (await health._broker())[0] == "ok"


async def test_app_wires_the_session_token_to_the_agent():
    settings = make_settings(llm_provider="scripted")
    agent = AgentDeps.from_settings(settings, token=lambda: "the-token")
    assert agent.context._token() == "the-token"
    assert agent.machines._token() == "the-token"
