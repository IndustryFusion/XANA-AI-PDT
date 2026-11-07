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
"""The checks of each connection: up, down, refused, and what they show. And the read-only settings."""

import asyncio

import aiomqtt
import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.config import service_settings
from app.events.subscription import MachineWatch
from app.health import HINTS, LABELS, HealthService
from app.main import create_app
from app.memory.migrate import Migrator
from app.redact import mask_url
from tests.conftest import make_settings

KEY = "alerta-key-value"
TOKEN = "operator-token-value"
PASSWORD = "s3cret-pw"


def service(handler=None, token=None, mqtt_client=None, **settings):
    values = {
        "alerta_url": "http://alerta:8080/api",
        "alerta_api_key": KEY,
        "pgrest_url": "http://pgrest:3000",
        "fuseki_url": "http://fuseki:3030",
        "mqtt_broker_url": "mqtt://emqx:1883",
    }
    s = make_settings(**(values | settings))
    extra = {"mqtt_client": mqtt_client} if mqtt_client else {}
    transport = httpx.MockTransport(handler) if handler else None
    migrator = Migrator(s.postgres_memory_url.get_secret_value())
    return HealthService(s, migrator, transport=transport, token=token, **extra)


def answering(status, body=None):
    return lambda request: httpx.Response(status, json=body if body is not None else {})


@pytest.mark.parametrize(
    ("probe", "ok_body"), [("_alerta", {"total": 1}), ("_pgrest", []), ("_fuseki", {"boolean": True})]
)
@pytest.mark.parametrize(
    ("status_code", "expected", "word"), [(401, "error", "refused"), (403, "error", "refused"), (500, "error", "500")]
)
async def test_a_refusal_or_failure_isnt_healthy(probe, ok_body, status_code, expected, word):
    assert (await getattr(service(answering(200, ok_body)), probe)())[0] == "ok"
    status, detail = await getattr(service(answering(status_code)), probe)()
    assert status == expected
    assert word in detail


async def test_an_empty_ontology_is_a_warning():
    status, detail = await service(answering(200, {"boolean": False}))._fuseki()
    assert status == "degraded"
    assert "empty" in detail


async def test_an_answer_from_fuseki_that_cant_be_read():
    assert (await service(answering(200, {"results": []}))._fuseki())[0] == "error"


async def test_each_sends_what_it_needs_and_no_secret_is_shown():
    seen = []

    def handler(request):
        seen.append(request)
        if "sparql" in str(request.url):
            return httpx.Response(200, json={"boolean": True})
        return httpx.Response(200, json=[])

    checks = service(handler, token=lambda: TOKEN)
    details = [(await probe())[1] for probe in (checks._alerta, checks._pgrest, checks._fuseki)]
    alerta, pgrest, fuseki = seen
    assert alerta.headers["authorization"] == f"Key {KEY}"
    assert pgrest.headers["authorization"] == fuseki.headers["authorization"] == f"Bearer {TOKEN}"
    assert b"ASK" in fuseki.content
    assert fuseki.url.path == "/iff/sparql"
    assert pgrest.url.path == "/attributes"
    assert KEY not in str(details) and TOKEN not in str(details)


class FakeMqtt:
    """As the MQTT client is used: a context manager that connects. `refuse` is a reason code, or an error."""

    made: list[dict] = []
    refuse = None

    def __init__(self, **kwargs):
        FakeMqtt.made.append(kwargs)

    async def __aenter__(self):
        if isinstance(FakeMqtt.refuse, Exception):
            raise FakeMqtt.refuse
        if FakeMqtt.refuse is not None:
            raise aiomqtt.MqttCodeError(FakeMqtt.refuse)
        return self

    async def __aexit__(self, *args):
        return None


@pytest.fixture
def mqtt():
    FakeMqtt.made, FakeMqtt.refuse = [], None
    return FakeMqtt


async def test_mqtt_connects_with_the_operators_token(mqtt):
    status, detail = await service(token=lambda: TOKEN, mqtt_client=mqtt, keycloak_url="http://k")._mqtt()
    assert status == "ok"
    assert mqtt.made[0]["password"] == TOKEN and mqtt.made[0]["hostname"] == "emqx" and mqtt.made[0]["port"] == 1883
    assert TOKEN not in detail


async def test_mqtt_without_sign_in_connects_with_nothing(mqtt):
    assert (await service(mqtt_client=mqtt)._mqtt())[0] == "ok"
    assert mqtt.made[0]["password"] is None


@pytest.mark.parametrize("code", [4, 5, 134, 135])
async def test_refused_mqtt_credentials_are_a_failure(mqtt, code):
    mqtt.refuse = code
    status, detail = await service(mqtt_client=mqtt)._mqtt()
    assert status == "error"
    assert "refused" in detail


async def test_another_mqtt_failure_is_a_failure_too(mqtt):
    mqtt.refuse = 3
    report = await service(mqtt_client=mqtt).report()
    check = next(c for c in report["checks"] if c["id"] == "mqtt")
    assert check["status"] == "error"


async def test_mqtt_with_nobody_signed_in_checks_only_that_it_can_be_reached(mqtt):
    listening = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    port = listening.sockets[0].getsockname()[1]
    async with listening:
        status, detail = await service(
            token=lambda: None, mqtt_client=mqtt, keycloak_url="http://k", mqtt_broker_url=f"mqtt://127.0.0.1:{port}"
        )._mqtt()
    assert status == "degraded"
    assert "credentials can't be checked" in detail
    assert mqtt.made == []


async def test_a_stopped_service_turns_only_its_own_check_red():
    async def fine():
        return "ok", "fine"

    checks = service()
    names = ("memory", "alerta", "mqtt", "pgrest", "fuseki")
    checks._probes = {name: fine for name in names}
    # A real probe for one, on an address nothing listens on.
    checks._probes["alerta"] = service(alerta_url="http://127.0.0.1:1/api")._alerta
    report = await checks.report()
    assert report["overall"] == "degraded"
    assert {c["id"]: c["status"] for c in report["checks"]} == {
        "memory": "ok",
        "alerta": "error",
        "mqtt": "ok",
        "pgrest": "ok",
        "fuseki": "ok",
    }


async def test_every_check_has_a_label_a_hint_and_where_it_looks():
    settings = {
        "postgres_memory_url": f"postgresql://xana:{PASSWORD}@db/memory",
        "timescale_db_url": f"postgresql://xana:{PASSWORD}@db/tsdb",
        "gateway_url": "http://gateway",
        "gateway_keycloak_url": "http://k",
        "settings_encryption_key": "qcXAgZOKO96Cwvcq6oFyV8Q0Abj4XikFe9vZeGD5ioA=",
        "ifric_url": "http://ifric:4007",
        "callback_base_url": "http://backend:8000",
        "event_webhook_secret": "x",
        "health_timeout_s": 0.2,
    }
    report = await service(**settings).report()
    assert {c["id"] for c in report["checks"]} == set(HINTS) == set(LABELS)
    for check in report["checks"]:
        assert check["hint"], check["id"]
        assert check["probe"], check["id"]
    assert PASSWORD not in str(report)
    assert KEY not in str(report)


def test_settings_show_addresses_with_passwords_masked_and_no_key():
    settings = make_settings(
        postgres_memory_url=f"postgresql://xana:{PASSWORD}@db/memory",
        timescale_db_url=f"postgresql://xana:{PASSWORD}@db/tsdb",
        alerta_api_key=KEY,
        mqtt_broker_url=f"mqtt://user:{PASSWORD}@emqx:1883",
    )
    found = service_settings(settings)
    text = str(found)
    assert PASSWORD not in text and KEY not in text
    assert all(item["editable"] is False and item["changed"] is False for item in found)
    assert {item["key"] for item in found} >= {"context_broker", "message_broker", "alert_manager"}
    assert not any(item["key"] == "gateway" for item in found)  # none configured


@pytest.mark.parametrize(
    "url",
    [
        f"postgresql://u@h/db?password={PASSWORD}&sslmode=require",
        f"http://h/x?access_token={PASSWORD}",
        f"http://h/x?API_KEY={PASSWORD}",
        f"http://h/x?client_secret={PASSWORD}",
        f"postgresql://u:{PASSWORD}@h/db?password={PASSWORD}",
    ],
)
def test_a_secret_in_an_address_is_masked_also_in_its_query(url):
    assert PASSWORD not in mask_url(url)


@pytest.mark.parametrize(
    "url",
    [
        f"postgresql://u:{PASSWORD}@h1:5432,h2:5433/db",
        f"postgresql://u:{PASSWORD}@h:notaport/db",
        f"http://h/x#token={PASSWORD}",
        f"http://h/x?a=1;password={PASSWORD}",
        f"http://h/x?a=1;password={PASSWORD}&b=2",
        f"http://h/x?accessToken={PASSWORD}",
        f"http://h/x?pass%77ord={PASSWORD}",
    ],
)
def test_other_forms_of_a_secret_in_an_address(url):
    assert PASSWORD not in mask_url(url)


def test_several_hosts_stay_readable():
    assert mask_url(f"postgresql://u:{PASSWORD}@h1:5432,h2:5433/db") == "postgresql://u:***@h1:5432,h2:5433/db"


@pytest.mark.parametrize("name", ["monkey", "tokenizer", "keyboard", "secretary", "sslmode"])
def test_only_whole_words_are_masked(name):
    assert mask_url(f"http://h/x?{name}=shown") == f"http://h/x?{name}=shown"


@pytest.mark.parametrize("probe", ["_broker", "_alerta", "_pgrest"])
@pytest.mark.parametrize("status_code", [200, 401, 500])
async def test_a_secret_in_a_service_address_stays_out_of_a_checks_detail(probe, status_code):
    query = f"?token={PASSWORD}"
    settings = {"ngsi_url": f"http://b/{query}", "alerta_url": "http://a/api", "pgrest_url": f"http://p/{query}"}
    _, detail = await getattr(service(answering(status_code, []), **settings), probe)()
    assert PASSWORD not in detail


async def test_a_secret_in_the_gateways_and_models_address_stays_out_too():
    checks = service(answering(200, {"models": []}), ollama_url=f"http://o/?token={PASSWORD}")
    assert PASSWORD not in (await checks._llm())[1]


async def test_a_secret_in_the_callback_stays_out_of_its_check():
    def broker(request):
        return httpx.Response(201)

    settings = make_settings(callback_base_url=f"http://x/?token={PASSWORD}", event_webhook_secret="s")
    watch = MachineWatch(settings, lambda: None, False, transport=httpx.MockTransport(broker))
    await watch.check()
    assert PASSWORD not in watch.detail


def test_the_rest_of_an_address_stays_as_it_is():
    assert mask_url("postgresql://u@h:5/db?sslmode=require") == "postgresql://u@h:5/db?sslmode=require"
    assert "sslmode=require" in mask_url("postgresql://u@h/db?password=x&sslmode=require")


def test_settings_and_probes_mask_a_query():
    settings = {"timescale_db_url": f"postgresql://u@h/tsdb?password={PASSWORD}"}
    assert PASSWORD not in str(service_settings(make_settings(**settings)))
    assert PASSWORD not in service(**settings)._probe_address("timeseries")


async def test_a_broker_refusing_the_token_says_so():
    status, detail = await service(answering(401))._broker()
    assert status == "error"
    assert "refused" in detail


def test_settings_can_be_read_and_not_changed():
    with TestClient(create_app(make_settings(llm_provider="scripted"))) as client:
        assert client.get("/api/config").status_code == 200
        for method in ("post", "put", "patch", "delete"):
            assert getattr(client, method)("/api/config").status_code == 405
