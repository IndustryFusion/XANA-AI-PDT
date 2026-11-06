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

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.alerta import AlertaClient
from app.api import alerta, errors
from app.config import ConfigError, load_settings
from app.errors import Refused
from tests.conftest import make_settings

KEY = "the-alerta-key-value"


def alert(number=1, **extra):
    return {
        "id": f"id-{number}",
        "resource": f"urn:m:{number}",
        "event": f"event{number}",
        "text": f"text {number}",
        "severity": "major",
        "status": "open",
        "environment": "Development",
        "service": ["SHACL Validator"],
        "group": "Misc",
        "value": None,
        "origin": "o",
        "type": "exceptionAlert",
        "createTime": "2026-11-06T10:00:00.000Z",
        "lastReceiveTime": "2026-11-06T10:00:00.000Z",
        "duplicateCount": 0,
        "attributes": {"ip_address": "x"},
        "history": [],
        **extra,
    }


class Alerta:
    def __init__(self, alerts=None) -> None:
        self.alerts = alerts if alerts is not None else [alert(1), alert(2, severity="critical")]
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path.removeprefix("/api")
        if path == "/alerts":
            return httpx.Response(
                200, json={"alerts": self.alerts, "total": len(self.alerts), "severityCounts": {"x": 9}}
            )
        if path == "/alerts/count":
            return httpx.Response(200, json={"total": 7, "severityCounts": {"major": 3, "critical": 4}})
        if path == "/environments":
            data = [{"environment": "Production"}, {"environment": "Development"}, {"environment": "Production"}]
            return httpx.Response(200, json={"environments": data})
        if path == "/services":
            return httpx.Response(
                200, json={"services": [{"service": "B", "environment": "x"}, {"service": "A"}, {"service": "A"}]}
            )
        if path.endswith("/action"):
            return httpx.Response(200, json={"status": "ok"})
        if path == "/alert/id-1":
            history = [
                {
                    "updateTime": "t1",
                    "type": "new",
                    "status": "open",
                    "severity": "major",
                    "text": "raised",
                    "user": "u",
                },
                {"updateTime": "t2", "type": "ack", "status": "ack", "severity": "major", "text": "seen", "user": "u"},
                {"updateTime": "t3", "type": "note", "status": None, "severity": None, "text": "a note", "user": "u"},
                {
                    "updateTime": "t4",
                    "type": "close",
                    "status": "closed",
                    "severity": "normal",
                    "text": "",
                    "user": None,
                },
            ]
            return httpx.Response(200, json={"alert": alert(1, history=history)})
        return httpx.Response(404, json={"message": "not found"})


def client_for(handler, **settings) -> TestClient:
    app = FastAPI()
    configured = make_settings(alerta_url="http://alerta.test:8080/api", alerta_api_key=KEY, **settings)
    app.state.alerta = AlertaClient(configured, transport=httpx.MockTransport(handler))
    errors.install(app)
    app.include_router(alerta.router)
    return TestClient(app)


def params(request):
    return list(request.url.params.multi_items())


def test_list_defaults_to_open_and_ack_most_severe_and_newest_first():
    fake = Alerta()
    answer = client_for(fake).get("/api/alerta/alerts").json()
    first = params(fake.requests[0])
    assert ("status", "open") in first and ("status", "ack") in first
    assert [v for k, v in first if k == "sort-by"] == ["severity", "lastReceiveTime"]
    assert answer["total"] == 2
    assert answer["page"] == 1 and answer["pageSize"] == 50
    assert answer["alerts"][0]["attributes"] == {"ip_address": "x"}
    assert "history" not in answer["alerts"][0]


def test_key_authentication_goes_to_alerta_and_nowhere_else():
    fake = Alerta()
    answer = client_for(fake).get("/api/alerta/alerts")
    assert fake.requests[0].headers["Authorization"] == f"Key {KEY}"
    assert KEY not in answer.text


def test_severity_bar_is_counted_without_the_severity_filter():
    fake = Alerta()
    answer = (
        client_for(fake).get("/api/alerta/alerts", params={"severity": "major", "environment": "Development"}).json()
    )
    listed, counted = fake.requests
    assert ("severity", "major") in params(listed)
    assert "severity" not in dict(params(counted))
    assert ("environment", "Development") in params(counted)
    assert answer["bySeverity"] == {"major": 3, "critical": 4}


@pytest.mark.parametrize("text", ["urn:m:1", 'a"b', "(((", "text:x", ".*", "\\"])
def test_search_text_never_reaches_alerta(text):
    fake = Alerta()
    answer = client_for(fake).get("/api/alerta/alerts", params={"text": text})
    assert answer.status_code == 200
    assert all("q" not in dict(params(r)) and text not in str(r.url.query) for r in fake.requests)


def test_search_covers_the_documented_fields_and_ignores_case():
    fake = Alerta(
        [alert(1, text="BURR on edge"), alert(2, service=["Edge service"]), alert(3, value="edge-5"), alert(4)]
    )
    answer = client_for(fake).get("/api/alerta/alerts", params={"text": "edge"}).json()
    assert [a["id"] for a in answer["alerts"]] == ["id-1", "id-2", "id-3"]
    assert answer["total"] == 3
    by_id = client_for(fake).get("/api/alerta/alerts", params={"text": "urn:m:4"}).json()
    assert [a["id"] for a in by_id["alerts"]] == ["id-4"]


def test_search_pages_and_counts_over_what_it_found():
    fake = Alerta([alert(i, severity="major" if i % 2 else "critical") for i in range(1, 6)])
    client = client_for(fake)
    page = client.get("/api/alerta/alerts", params={"text": "text", "page": 2, "page_size": 2}).json()
    assert [a["id"] for a in page["alerts"]] == ["id-3", "id-4"]
    assert page["total"] == 5
    assert page["bySeverity"] == {"major": 3, "critical": 2}
    narrowed = client.get("/api/alerta/alerts", params={"text": "text", "severity": "critical"}).json()
    assert narrowed["total"] == 2
    assert narrowed["bySeverity"] == {"major": 3, "critical": 2}


@pytest.mark.parametrize("query", [{"sort": "nonsense"}, {"page": 0}, {"page_size": 0}, {"page_size": 1001}])
def test_bad_paging_or_sort_is_refused_before_alerta(query):
    fake = Alerta()
    assert client_for(fake).get("/api/alerta/alerts", params=query).status_code == 422
    assert fake.requests == []


def test_caller_cannot_choose_the_server_or_pass_filters_through():
    fake = Alerta()
    client_for(fake).get("/api/alerta/alerts", params={"alerta_url": "http://evil.test", "q": "x", "resource": "y"})
    assert fake.requests[0].url.host == "alerta.test"
    assert not {"q", "resource", "alerta_url"} & set(dict(params(fake.requests[0])))


def test_count():
    fake = Alerta()
    answer = client_for(fake).get("/api/alerta/alerts/count", params={"status": "open"}).json()
    assert answer == {"total": 7, "bySeverity": {"major": 3, "critical": 4}}
    assert params(fake.requests[0]) == [("status", "open")]


def test_detail_maps_history():
    answer = client_for(Alerta()).get("/api/alerta/alert/id-1").json()
    assert [h["type"] for h in answer["history"]] == ["new", "status", "note", "status"]
    assert [h["status"] for h in answer["history"]] == ["open", "ack", "ack", "closed"]
    assert answer["history"][1] == {
        "at": "t2",
        "type": "status",
        "status": "ack",
        "severity": "major",
        "text": "seen",
        "user": "u",
    }


def test_unknown_alert_is_not_found():
    assert client_for(Alerta()).get("/api/alerta/alert/nope").status_code == 404


def test_identifier_stays_one_path_segment():
    fake = Alerta()
    assert client_for(fake).get("/api/alerta/alert/a%2F..%2F..%2Fadmin").status_code == 404
    assert fake.requests == []
    client = AlertaClient(make_settings(alerta_url="http://alerta.test/api"), transport=httpx.MockTransport(fake))
    with pytest.raises(Refused):
        asyncio.run(client.alert("a/../../admin"))
    assert fake.requests[0].url.raw_path == b"/api/alert/a%2F..%2F..%2Fadmin"


@pytest.mark.parametrize("action", ["ack", "unack", "shelve", "unshelve", "close", "open"])
def test_action_is_sent_and_answers_the_updated_alert(action):
    fake = Alerta()
    answer = client_for(fake).put("/api/alerta/alert/id-1/action", json={"action": action, "text": "note"})
    assert answer.status_code == 200
    assert answer.json()["history"]
    put = fake.requests[0]
    assert put.method == "PUT"
    assert put.url.path == "/api/alert/id-1/action"
    assert json.loads(put.content) == {"action": action, "text": "note"}


@pytest.mark.parametrize("action", ["bogus", "delete", "", "timeout"])
def test_unknown_action_is_refused_though_alerta_would_take_it(action):
    fake = Alerta()
    assert client_for(fake).put("/api/alerta/alert/id-1/action", json={"action": action}).status_code == 422
    assert fake.requests == []


def test_action_that_does_not_fit_is_a_conflict_with_alertas_reason():
    def conflict(request):
        return httpx.Response(409, json={"message": "alert is already in ack status"})

    answer = client_for(conflict).put("/api/alerta/alert/id-1/action", json={"action": "ack"})
    assert answer.status_code == 409
    assert answer.json()["error"] == {"kind": "conflict", "message": "alert is already in ack status"}


def test_environments_and_services_are_unique_names():
    client = client_for(Alerta())
    assert client.get("/api/alerta/environments").json() == ["Development", "Production"]
    assert client.get("/api/alerta/services").json() == ["A", "B"]


def test_refresh_interval_is_configured():
    answer = client_for(Alerta(), alerts_refresh_interval_s=45).get("/api/alerta/config")
    assert answer.json() == {"refresh_interval_s": 45}


@pytest.mark.parametrize(
    ("handler", "message"),
    [
        (lambda r: httpx.Response(500, json={"message": "stack trace http://inner"}), "failed (HTTP 500)"),
        (
            lambda r: httpx.Response(401, json={"message": f"API key parameter '{KEY}' is invalid"}),
            "refused the configured API key",
        ),
        (lambda r: httpx.Response(403), "refused the configured API key"),
        (lambda r: httpx.Response(200, text="<!DOCTYPE html>"), "ends in /api"),
        (lambda r: httpx.Response(200, json=[]), "unexpected answer"),
    ],
)
def test_failures_are_502_and_say_what(handler, message):
    answer = client_for(handler).get("/api/alerta/alerts")
    assert answer.status_code == 502
    assert answer.json()["error"]["kind"] == "unavailable"
    assert message in answer.json()["error"]["message"]
    assert KEY not in answer.text
    assert "inner" not in answer.text


def test_stopped_alerta_is_502_without_its_address():
    def down(request):
        raise httpx.ConnectError("http://inner-host:8080", request=request)

    answer = client_for(down).get("/api/alerta/alerts/count")
    assert answer.status_code == 502
    assert "Alerta" in answer.text and "inner-host" not in answer.text


@pytest.mark.parametrize(
    "url",
    ["http://alerta:8080", "http://alerta:8080/", "alerta:8080", "http://alerta:8080/api/v2", "http://apihost:8080"],
)
def test_missing_api_in_the_url_stops_the_backend_with_a_clear_message(url):
    with pytest.raises(ConfigError) as caught:
        load_settings(_env_file=None, alerta_url=url)
    assert "ALERTA_URL" in str(caught.value)
    assert "/api" in str(caught.value)


@pytest.mark.parametrize(
    ("url", "stored"),
    [
        ("alerta:8080/api", "http://alerta:8080/api"),
        ("http://alerta:8080/api/", "http://alerta:8080/api"),
        ("https://x.example/alerts/api", "https://x.example/alerts/api"),
    ],
)
def test_good_urls(url, stored):
    assert make_settings(alerta_url=url).alerta_url == stored


def test_key_is_a_secret_setting():
    settings = make_settings(alerta_api_key=KEY)
    assert settings.redactor()(f"failed with {KEY}") == "failed with ***"
    assert KEY not in repr(settings)
    with pytest.raises(ValidationError):
        make_settings(alerta_api_key="two words")
