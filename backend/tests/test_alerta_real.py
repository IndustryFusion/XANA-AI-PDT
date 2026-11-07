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
"""Alerts against a real Alerta (TEST_ALERTA_URL, TEST_ALERTA_KEY), with alerts in the form of the platform's rules."""

import os
import uuid

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.alerta import AlertaClient
from app.api import alerta as alerta_routes
from app.api import errors
from tests.conftest import make_settings
from xana_agent import AlertaAlertSource

URL = os.environ.get("TEST_ALERTA_URL", "")
KEY = os.environ.get("TEST_ALERTA_KEY", "")
pytestmark = [pytest.mark.services, pytest.mark.skipif(not URL, reason="TEST_ALERTA_URL not set")]
AUTH = {"Authorization": f"Key {KEY}"}


def raise_alert(resource, event="ClassConstraintComponent(hasFilter)", severity="warning", environment="Development"):
    """As the platform's bridge sends what its rules produce."""
    body = {
        "resource": resource,
        "event": event,
        "environment": environment,
        "service": ["SHACL Validator"],
        "severity": severity,
        "customer": None,
        "text": f"Model validation for relationship hasFilter failed for {resource}.",
    }
    response = httpx.post(f"{URL}/alert", json=body, headers=AUTH)
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def resource():
    made = f"urn:plasmacutter-test:{uuid.uuid4().hex[:10]}"
    yield made
    for alert in httpx.get(f"{URL}/alerts", params={"resource": made}, headers=AUTH).json().get("alerts", []):
        httpx.delete(f"{URL}/alert/{alert['id']}", headers=AUTH)


@pytest.fixture
def api():
    app = FastAPI()
    app.state.alerta = AlertaClient(make_settings(alerta_url=URL, alerta_api_key=KEY))
    errors.install(app)
    app.include_router(alerta_routes.router)
    return TestClient(app)


async def test_the_full_entity_id_finds_a_rule_alert_and_a_prefix_does_not(resource):
    raised = raise_alert(resource)
    source = AlertaAlertSource(URL, KEY)
    assert [a["id"] for a in await source.active(resource)] == [raised]
    assert await source.active(resource[:-1]) == []
    assert await source.active(resource + "x") == []


async def test_only_open_and_acknowledged_are_active(resource):
    raised = raise_alert(resource)
    source = AlertaAlertSource(URL, KEY)
    put = httpx.put(f"{URL}/alert/{raised}/action", json={"action": "ack"}, headers=AUTH)  # noqa: ASYNC210
    assert put.status_code == 200
    assert [a["status"] for a in await source.active(resource)] == ["ack"]
    httpx.put(f"{URL}/alert/{raised}/action", json={"action": "close"}, headers=AUTH)  # noqa: ASYNC210
    assert await source.active(resource) == []


async def test_a_wrong_key_and_a_stopped_alerta_are_source_errors():
    from xana_agent.sources.base import SourceUnavailable

    with pytest.raises(SourceUnavailable, match="refused"):
        await AlertaAlertSource(URL, "wrong-key").active("urn:x")
    with pytest.raises(SourceUnavailable, match="not reachable"):
        await AlertaAlertSource("http://127.0.0.1:1/api", KEY).active("urn:x")


def test_routes_with_filters_and_counts(api, resource):
    raise_alert(resource, event="e-warning", severity="warning")
    raise_alert(resource, event="e-critical", severity="critical")
    raise_alert(resource, event="e-other", severity="major", environment="Production")
    listed = api.get("/api/alerta/alerts", params={"page_size": 1000}).json()
    mine = [a for a in listed["alerts"] if a["resource"] == resource]
    assert [a["severity"] for a in mine] == ["critical", "major", "warning"]
    assert listed["bySeverity"]["critical"] >= 1
    only = api.get("/api/alerta/alerts", params={"severity": "critical", "text": resource}).json()
    assert [a["event"] for a in only["alerts"]] == ["e-critical"]
    assert only["bySeverity"] == {"warning": 1, "critical": 1, "major": 1}
    production = api.get("/api/alerta/alerts", params={"environment": "Production", "text": resource}).json()
    assert [a["event"] for a in production["alerts"]] == ["e-other"]
    assert "SHACL Validator" in api.get("/api/alerta/services").json()
    assert {"Development", "Production"} <= set(api.get("/api/alerta/environments").json())
    assert api.get("/api/alerta/alerts/count").json()["total"] >= 3


@pytest.mark.parametrize("text", ['"', "a:b:c", "(((", "text:/.*/", "\\", "*", "%"])
def test_search_text_that_breaks_alertas_query_language_is_fine_here(api, text):
    answer = api.get("/api/alerta/alerts", params={"text": text})
    assert answer.status_code == 200
    # Alerta's own `q` fails on one of these, which is why it isn't used.
    assert httpx.get(f"{URL}/alerts", params={"q": "urn:other:2"}, headers=AUTH).status_code == 500


def test_a_page_past_the_end_on_a_real_alerta(api, resource):
    raise_alert(resource)
    answer = api.get("/api/alerta/alerts", params={"page": 99999, "page_size": 5})
    assert answer.status_code == 200, answer.text
    assert answer.json()["alerts"] == []
    assert answer.json()["total"] >= 1


def test_dots_are_not_an_alert_on_a_real_alerta(api):
    assert api.get("/api/alerta/alert/%2e%2e").status_code == 404


def test_search_finds_a_full_entity_id(api, resource):
    raise_alert(resource)
    answer = api.get("/api/alerta/alerts", params={"text": resource}).json()
    assert answer["total"] == 1
    assert answer["alerts"][0]["resource"] == resource


def test_all_actions_in_turn_with_history(api, resource):
    raised = raise_alert(resource)
    path = f"/api/alerta/alert/{raised}/action"
    for action, status in (
        ("ack", "ack"),
        ("unack", "open"),
        ("shelve", "shelved"),
        ("unshelve", "open"),
        ("close", "closed"),
        ("open", "open"),
    ):
        answer = api.put(path, json={"action": action, "text": f"note {action}"})
        assert answer.status_code == 200, answer.text
        assert answer.json()["status"] == status
    detail = api.get(f"/api/alerta/alert/{raised}").json()
    assert detail["history"][0]["type"] == "new"
    assert any(h["text"] == "note ack" and h["status"] == "ack" for h in detail["history"])
    assert all(h["type"] in ("new", "note", "status") for h in detail["history"])


def test_action_that_does_not_fit_and_unknown_ones(api, resource):
    raised = raise_alert(resource)
    assert api.put(f"/api/alerta/alert/{raised}/action", json={"action": "unack"}).status_code == 409
    assert api.put(f"/api/alerta/alert/{raised}/action", json={"action": "bogus"}).status_code == 422
    assert api.get("/api/alerta/alert/not-an-alert").status_code == 404


def test_wrong_key_is_502(resource):
    app = FastAPI()
    app.state.alerta = AlertaClient(make_settings(alerta_url=URL, alerta_api_key="wrong-key"))
    errors.install(app)
    app.include_router(alerta_routes.router)
    answer = TestClient(app).get("/api/alerta/alerts")
    assert answer.status_code == 502
    assert "wrong-key" not in answer.text
