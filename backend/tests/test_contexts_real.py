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
"""Who may change the allowed contexts, end to end: the backend's sign-in against a real Keycloak, and
the contexts routes against the real memory database. `operator` has Factory-Admin on `scorpio` in the
local realm; `visitor` has no role there."""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import auth, errors, ngsi
from app.auth import KeycloakSession
from app.memory.migrate import Migrator
from app.memory.store import Database
from app.ngsi.contexts import ContextAllowList
from tests.conftest import make_settings

pytestmark = pytest.mark.services
KEYCLOAK = os.environ.get("TEST_KEYCLOAK_URL")
MEMORY = os.environ.get("TEST_MEMORY_URL")
needs_services = pytest.mark.skipif(not (KEYCLOAK and MEMORY), reason="TEST_KEYCLOAK_URL and TEST_MEMORY_URL not set")


@pytest.fixture
def client():
    settings = make_settings(keycloak_url=KEYCLOAK, keycloak_realm="iff", keycloak_client_id="scorpio")
    db = Database(MEMORY)

    @asynccontextmanager
    async def lifespan(app):
        await Migrator(MEMORY).apply()
        await db.open()
        yield
        await app.state.session.close()
        await db.close()

    app = FastAPI(lifespan=lifespan)
    app.state.session = KeycloakSession(settings)
    app.state.contexts = ContextAllowList(db, [])
    errors.install(app)
    app.include_router(auth.router)
    app.include_router(ngsi.router)
    with TestClient(app) as client:
        yield client


def sign_in(client, username):
    answer = client.post("/api/auth/connect", json={"username": username, "password": username})
    assert answer.status_code == 200 and answer.json()["user"]["username"] == username


@needs_services
def test_an_operator_without_the_role_sees_the_list_and_cant_change_it(client):
    sign_in(client, "visitor")
    url = f"https://contexts.example.org/{uuid.uuid4().hex}/c.jsonld"
    listed = client.get("/api/ngsi/contexts").json()
    assert listed["mayChange"] is False and listed["changeRole"] == "Factory-Admin on client scorpio"
    assert any(c["url"] == "https://schema.org/" for c in listed["contexts"])
    for answer in (
        client.post("/api/ngsi/contexts", json={"url": url}),
        client.delete("/api/ngsi/contexts", params={"url": url}),
        client.get("/api/ngsi/contexts/risks", params={"url": url}),
    ):
        assert answer.status_code == 403 and answer.json()["error"]["kind"] == "unauthorized"
    assert all(c["url"] != url for c in client.get("/api/ngsi/contexts").json()["contexts"])


@needs_services
def test_a_factory_admin_adds_and_removes_a_context_that_then_applies(client):
    sign_in(client, "operator")
    url = f"https://contexts.example.org/{uuid.uuid4().hex}/c.jsonld"
    assert client.get("/api/ngsi/contexts").json()["mayChange"] is True
    assert client.get("/api/ngsi/contexts/risks", params={"url": url}).status_code == 200
    added = client.post("/api/ngsi/contexts", json={"url": url})
    assert added.status_code == 200
    assert {"url": url, "source": "added", "removable": True, "label": None} in added.json()["contexts"]
    try:
        assert client.app.state.contexts.allowed(url)
    finally:
        assert client.delete("/api/ngsi/contexts", params={"url": url}).status_code == 200
    assert not client.app.state.contexts.allowed(url)


@needs_services
def test_signing_in_as_another_operator_changes_who_may_change_the_list(client):
    sign_in(client, "operator")
    assert client.get("/api/ngsi/contexts").json()["mayChange"] is True
    sign_in(client, "visitor")
    assert client.get("/api/ngsi/contexts").json()["mayChange"] is False
