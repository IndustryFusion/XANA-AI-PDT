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
from urllib.parse import quote

import httpx
import pytest
from fastapi.testclient import TestClient

from app.errors import Refused
from app.ngsi import query as q
from app.ngsi.broker import ContextBroker, check_document
from app.ngsi.failures import scrubbed
from tests.conftest import make_settings
from tests.explorer_support import IRI, MACHINE, TOKEN, Broker, app_with

ENTITY = f"/api/ngsi/entities/{MACHINE}"
CORE = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"


@pytest.fixture
def broker() -> Broker:
    return Broker()


@pytest.fixture
def client(broker: Broker) -> TestClient:
    return TestClient(app_with(broker))


def attrs(name: str = "temp") -> str:
    return f"{IRI}{name}"


# The query language ---------------------------------------------------------------------------

MACHINE_DOC = {
    "id": "urn:m:1",
    "type": "Machine",
    "status": {"type": "Property", "value": "running"},
    "power": {"type": "Property", "value": 12.5, "accuracy": {"type": "Property", "value": 2}},
    "partOf": {"type": "Relationship", "object": "urn:line:a"},
    "shifts": {"type": "ListProperty", "valueList": ["early", "late"]},
    "label": {"type": "LanguageProperty", "languageMap": {"en": "Press", "de": "Presse"}},
    "config": {"type": "JsonProperty", "json": {"mode": "auto"}},
    "where": {"type": "GeoProperty", "value": {"type": "Point", "coordinates": [1, 2]}},
    "kind": {"type": "Property", "value": {"@id": "urn:kind:a"}},
    f"{IRI}state": {"type": "Property", "value": "ON"},
    "many": [
        {"type": "Property", "value": 1, "datasetId": "urn:d:1"},
        {"type": "Property", "value": 5, "datasetId": "urn:d:2"},
    ],
}


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ('status=="running"', True),
        ('status!="running"', False),
        ("power>12", True),
        ("power>=12.5", True),
        ("power<12", False),
        ("power<=12.5", True),
        ("power==10..13", True),
        ("power==13..14", False),
        ('status=="idle","running"', True),
        ('status~="^run"', True),
        ('status!~="^run"', False),
        ("status", True),
        ("!status", False),
        ("nothing", False),
        ("!nothing", True),
        ('status=="running";power>100', False),
        ('status=="running"|power>100', True),
        ('(status=="idle"|power>1);partOf=="urn:line:a"', True),
        ("power.accuracy>=2", True),
        ("power.accuracy>=3", False),
        ("!power.missing", True),
        ('config[mode]=="auto"', True),
        ('config[mode]=="manual"', False),
        ('shifts=="late"', True),
        ('label=="Presse"', True),
        ('kind=="urn:kind:a"', True),
        (f'{IRI}state=="ON"', True),
        (f'{IRI}state=="OFF"', False),
        ("many==5", True),
        ("where", True),
        ('where=="x"', False),
    ],
)
def test_expressions(expression, expected):
    assert q.matches(MACHINE_DOC, q.parse(expression)) is expected


@pytest.mark.parametrize(
    ("expression", "reason"),
    [
        ("status==", "expected a value at position 9"),
        ('(status=="x"', 'missing ")"'),
        ("((", "expected an attribute name"),
        ('status=="open', "unterminated"),
        ('status~="("', "not a valid regular expression"),
        ('a=="1" b', 'unexpected "b"'),
        ("a[b", 'missing "]"'),
    ],
)
def test_syntax_errors_name_the_reason(expression, reason):
    with pytest.raises(Refused) as caught:
        q.parse(expression)
    assert caught.value.kind == "invalid"
    assert reason in caught.value.message


@pytest.mark.parametrize(
    ("expression", "sent"),
    [
        ('status=="a"', True),
        ("status.accuracy==1", True),
        ('a=="b";c>1|d<2', True),
        ("status", True),
        ('status=="a","b"', True),
        ('https://example/state=="ON"', True),
        (f'{IRI}state=="ON"', False),
        ("!status", False),
        ('status~="a"', False),
        ('status!~="a"', False),
        ("value==1..5", False),
        ('a=="b";!c', False),
        ('a=="b"|c~="d"', False),
    ],
)
def test_what_goes_to_the_broker_and_what_is_evaluated_here(expression, sent):
    assert q.broker_can_evaluate(q.parse(expression)) is sent


def test_no_expression_needs_no_evaluation():
    assert q.broker_can_evaluate(None) is True


@pytest.mark.parametrize("bad", ["a=={", "a==}", "a==[", "a==<", "a=={x}", "a==$", "(", "a b"])
def test_values_the_broker_fails_on_are_refused_as_syntax_errors(client, broker, bad):
    answer = client.get("/api/ngsi/entities", params={"type": "T", "q": bad})
    assert answer.status_code == 422
    assert broker.requests == []


def test_a_broker_failing_on_an_expression_falls_back_to_evaluating_here():
    calls = []

    def fails_with_q(request):
        calls.append(request)
        if "q" in request.url.params:
            return httpx.Response(500, json={"title": "Internal error"})
        return httpx.Response(200, json=[{"id": "urn:a", "type": "T", "a": {"type": "Property", "value": 1}}])

    answer = TestClient(app_with(fails_with_q)).get("/api/ngsi/entities", params={"type": "T", "q": "a==1"})
    assert answer.status_code == 200
    assert [e["id"] for e in answer.json()] == ["urn:a"]
    assert ["q" in r.url.params for r in calls] == [True, False]


def test_a_broker_that_is_really_down_stays_502_with_an_expression():
    def down(request):
        raise httpx.ConnectError("x", request=request)

    assert TestClient(app_with(down)).get("/api/ngsi/entities", params={"type": "T", "q": "a==1"}).status_code == 502


def test_a_catastrophic_pattern_returns_at_once(client, broker):
    broker.entities["urn:r"] = {"id": "urn:r", "type": "T", "a": {"type": "Property", "value": "a" * 5000 + "!"}}
    started = time.perf_counter()
    answer = client.get("/api/ngsi/entities", params={"type": "T", "q": 'a~="(a+)+$"'})
    assert answer.status_code == 200
    assert answer.json() == []
    assert time.perf_counter() - started < 2


@pytest.mark.parametrize("pattern", ["(?=a)b", "("])
def test_patterns_re2_cannot_run_are_refused(client, pattern):
    answer = client.get("/api/ngsi/entities", params={"type": "T", "q": f'a~="{pattern}"'})
    assert answer.status_code == 422
    assert "regular expression" in answer.json()["error"]["message"]


def test_back_references_are_refused_as_re2_cannot_run_them():
    with pytest.raises(Refused, match="back-references"):
        q.compile_pattern("(a)\\1", "The pattern")


def test_a_very_long_pattern_is_refused(client, broker):
    long = "a" * (q.MAX_PATTERN + 1)
    assert client.get("/api/ngsi/entities", params={"type": "T", "q": f'a~="{long}"'}).status_code == 422
    assert client.get("/api/ngsi/entities", params={"type": "T", "id_pattern": long}).status_code == 422
    assert broker.requests == []
    fine = "a" * q.MAX_PATTERN
    assert client.get("/api/ngsi/entities", params={"type": "T", "q": f'a~="{fine}"'}).status_code == 200


def test_a_search_that_stopped_early_says_so_in_a_header_and_otherwise_does_not(broker):
    for i in range(5300):
        broker.entities[f"urn:b:{i:05d}"] = {
            "id": f"urn:b:{i:05d}",
            "type": "Big",
            "n": {"type": "Property", "value": i},
        }
    client_ = TestClient(app_with(broker))
    far = client_.get("/api/ngsi/entities", params={"type": "Big", "q": '!nothing;n~="^52..$"', "limit": 1000})
    assert far.json() == []
    assert far.headers["X-Results-Limited"] == "scanned=5000, total=5300"
    near = client_.get("/api/ngsi/entities", params={"type": "Big", "q": "!nothing", "limit": 5})
    assert len(near.json()) == 5
    assert "X-Results-Limited" not in near.headers
    plain = client_.get("/api/ngsi/entities", params={"type": "Big", "limit": 5})
    assert "X-Results-Limited" not in plain.headers


def test_all_entities_below_the_cap_are_not_called_limited(broker):
    for i in range(1500):
        broker.entities[f"urn:b:{i}"] = {"id": f"urn:b:{i}", "type": "Mid"}
    answer = TestClient(app_with(broker)).get(
        "/api/ngsi/entities", params={"type": "Mid", "q": "!nothing", "limit": 1000}
    )
    assert "X-Results-Limited" not in answer.headers


@pytest.mark.parametrize(
    "context",
    [
        "http://169.254.169.254/latest/meta-data",
        "http://keycloak:8080/realms/iff",
        "https://example.org/c.jsonld",
        ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld", "http://internal/c"],
        {"@import": "http://internal/c"},
        {"term": {"@id": "urn:t", "@context": "http://internal/c"}},
        [{"@context": "http://internal/c"}],
    ],
)
def test_import_never_passes_on_a_context_that_is_not_allowed(client, broker, context):
    answer = client.post("/api/ngsi/import", json=[{"@context": context, "id": "urn:c:1", "type": "T"}])
    assert answer.status_code == 207
    assert answer.json()[0]["result"] == "failed"
    assert "internal" not in answer.json()[0]["reason"]
    assert "169.254" not in answer.json()[0]["reason"]
    assert not any(r.url.path.endswith("upsert") for r in broker.requests)


def test_a_context_inside_an_attribute_is_refused_on_import_and_on_edits(client, broker):
    inner = {"type": "Property", "value": 1, "@context": "http://internal/c"}
    assert client.post("/api/ngsi/import", json=[{"id": "urn:c:1", "type": "T", "a": inner}]).status_code == 207
    assert not any(r.url.path.endswith("upsert") for r in broker.requests)
    assert client.post(f"{ENTITY}/attrs", json={"a": inner}).status_code == 422
    assert client.patch(f"{ENTITY}/attrs", json={attrs(): {"@context": "http://internal/c"}}).status_code == 422
    assert all(r.method == "GET" for r in broker.requests)


@pytest.mark.parametrize(
    "context",
    [
        "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld",
        "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.7.jsonld",
        "https://contexts.example/mine.jsonld",
        "https://contexts.example/configured.jsonld",
        {"term": "urn:t"},
    ],
)
def test_known_contexts_and_plain_inline_ones_reach_the_broker(broker, context):
    client_ = TestClient(
        app_with(
            broker,
            ngsi_context_url="https://contexts.example/configured.jsonld",
            ngsi_allowed_contexts="https://other.example/x, https://contexts.example/mine.jsonld",
        )
    )
    answer = client_.post("/api/ngsi/import", json=[{"@context": context, "id": "urn:c:1", "type": "T"}])
    assert answer.status_code == 200
    assert answer.json()[0]["result"] == "created"


def test_addresses_in_a_brokers_reasons_are_taken_out(client, broker):
    def rejecting(request):
        if request.url.path.endswith("upsert"):
            detail = "Failed to load http://inner-host:8080/secret/context.jsonld for this"
            errors_ = [{"entityId": "urn:n:1", "error": {"detail": detail}}]
            return httpx.Response(207, json={"success": [], "errors": errors_})
        if "q" in request.url.params:
            return httpx.Response(400, json={"detail": "bad value at http://inner-host:8080/x"})
        return httpx.Response(200, json=[])

    client_ = TestClient(app_with(rejecting))
    rows = client_.post("/api/ngsi/import", json=[{"id": "urn:n:1", "type": "T"}]).json()
    assert "inner-host" not in rows[0]["reason"]
    assert "[address]" in rows[0]["reason"]


@pytest.mark.parametrize("identifier", ["..", ".", " .. "])
def test_dots_cannot_climb_out_of_the_entities_path(broker, identifier):
    client_ = ContextBroker(
        make_settings(ngsi_url="http://b.test"), lambda: None, transport=httpx.MockTransport(broker)
    )
    for call in (
        client_.entity(identifier),
        client_.delete_entity(identifier),
        client_.append_attributes(identifier, {"a": {"type": "Property", "value": 1}}),
    ):
        with pytest.raises(Refused) as caught:
            asyncio.run(call)
        assert caught.value.kind == "invalid"
    assert broker.requests == []


def test_dots_as_an_attribute_are_refused(client, broker):
    broker.entities[MACHINE][".."] = {"type": "Property", "value": 1}
    assert client.delete(f"{ENTITY}/attrs", params={"name": ".."}).status_code == 422
    assert all(r.method == "GET" for r in broker.requests)


async def test_concurrent_adds_of_one_attribute_give_one_winner_and_one_conflict():
    broker = Broker()
    configured = make_settings(ngsi_url="http://broker.test:9090")
    client_ = ContextBroker(configured, lambda: None, transport=httpx.MockTransport(broker))
    body = {"new": {"type": "Property", "value": 1}}
    answers = await asyncio.gather(
        client_.append_attributes(MACHINE, body), client_.append_attributes(MACHINE, body), return_exceptions=True
    )
    assert sorted(type(a).__name__ for a in answers) == ["NoneType", "Refused"]
    assert next(a for a in answers if a is not None).kind == "conflict"
    assert client_._entity_locks == {}


async def test_edits_on_different_entities_do_not_wait_for_each_other():
    release = asyncio.Event()
    order = []

    class Slow(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            order.append(request.url.path)
            if request.url.path.endswith("urn:a"):
                await release.wait()
            return httpx.Response(200, json={"id": "x", "type": "T", "a": {"type": "Property", "value": 1}})

    client_ = ContextBroker(make_settings(ngsi_url="http://b.test"), lambda: None, transport=Slow())
    first = asyncio.create_task(client_.update_attributes("urn:a", {"a": {"value": 2}}))
    await asyncio.sleep(0)
    await asyncio.wait_for(client_.update_attributes("urn:b", {"a": {"value": 2}}), 2)
    assert first.done() is False
    release.set()
    await first


def test_delete_by_types_sends_no_wildcard_query(client, broker):
    client.post("/api/ngsi/delete-by-types", json={"types": ["*"]})
    assert not any(r.url.params.get("type") == "*" for r in broker.requests)


def test_sub_attribute_of_iris():
    path = q.parse(f"{IRI}temp.{IRI}limit>1").path
    assert (path.attribute, path.subs) == (f"{IRI}temp", (f"{IRI}limit",))


# Query and browse -----------------------------------------------------------------------------


def test_a_single_type_answered_without_a_list(client):
    assert client.get("/api/ngsi/types").json() == [f"{IRI}cutter"]


def test_iri_names_come_back_unchanged(client):
    answer = client.get("/api/ngsi/entities", params={"type": f"{IRI}cutter"}).json()
    assert attrs("temp") in answer[0]


def test_id_pattern_alone_asks_for_any_type(client, broker):
    client.get("/api/ngsi/entities", params={"id_pattern": "urn:x:.*"})
    assert broker.requests[-1].url.params["type"] == "*"


def test_context_goes_in_a_link_header():
    fake = Broker()
    app = app_with(fake, ngsi_context_url="https://contexts.example/c.jsonld")
    TestClient(app).get("/api/ngsi/entities", params={"type": "T", "q": 'state=="ON"'})
    assert "https://contexts.example/c.jsonld" in fake.requests[-1].headers["Link"]
    assert fake.requests[-1].url.params["q"] == 'state=="ON"'


def test_no_link_header_without_a_context(client, broker):
    client.get("/api/ngsi/types")
    assert "Link" not in broker.requests[-1].headers


def test_dotted_iri_is_filtered_here_not_sent(client, broker):
    answer = client.get("/api/ngsi/entities", params={"q": f'{IRI}state=="ON"', "limit": 5})
    assert [e["id"] for e in answer.json()] == [MACHINE]
    assert all("q" not in r.url.params for r in broker.requests)
    assert client.get("/api/ngsi/entities", params={"q": f'{IRI}state=="OFF"'}).json() == []


def test_bad_expression_is_refused_before_the_broker_sees_it(client, broker):
    answer = client.get("/api/ngsi/entities", params={"q": "(("})
    assert answer.status_code == 422
    assert "position" in answer.json()["error"]["message"]
    assert broker.requests == []


@pytest.mark.parametrize("limit", [0, 1001])
def test_limit_range(client, limit):
    answer = client.get("/api/ngsi/entities", params={"type": "T", "limit": limit})
    assert answer.status_code == 422


def test_no_criteria_is_invalid(client):
    assert client.get("/api/ngsi/entities").status_code == 422


def test_stats_count_each_type_including_a_zero_limit_trap(broker):
    broker.entities["urn:x:2"] = {"id": "urn:x:2", "type": "T"}
    broker.entities["urn:x:3"] = {"id": "urn:x:3", "type": "T"}
    answer = TestClient(app_with(broker)).get("/api/ngsi/stats").json()
    assert answer["entity_count"] == 3
    assert answer["type_count"] == 2
    assert answer["by_type"][0] == {"type": "T", "count": 2}


def test_caller_cannot_choose_the_server(client, broker):
    client.get("/api/ngsi/types", params={"server_url": "http://evil.test", "ngsi_url": "http://evil.test"})
    assert broker.requests[-1].url.host == "broker.test"


def test_identifier_stays_one_path_segment(client, broker):
    client.get("/api/ngsi/entities/urn:x%2F..%2F..%2Fadmin")
    assert broker.requests[-1].url.raw_path == b"/ngsi-ld/v1/entities/urn:x%2F..%2F..%2Fadmin"


# Editing --------------------------------------------------------------------------------------


def test_new_value_keeps_unit_and_sub_attributes_and_stamps_the_time(client, broker):
    answer = client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 43}})
    assert answer.status_code == 204
    stored = broker.entities[MACHINE][attrs()]
    assert stored["value"] == 43
    assert stored["unitCode"] == "CEL"
    assert stored[attrs("limit")]["value"] == 99
    assert stored["observedAt"].endswith("Z")


def test_stated_observation_time_is_kept(client, broker):
    client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 43, "observedAt": "2026-01-01T00:00:00Z"}})
    assert broker.entities[MACHINE][attrs()]["observedAt"] == "2026-01-01T00:00:00Z"


def test_adding_a_sub_attribute_keeps_the_value(client, broker):
    fragment = {attrs(): {attrs("new"): {"type": "Property", "value": 7}}}
    assert client.patch(f"{ENTITY}/attrs", json=fragment).status_code == 204
    stored = broker.entities[MACHINE][attrs()]
    assert stored["value"] == 42
    assert stored[attrs("new")]["value"] == 7
    assert "observedAt" not in stored


def test_one_dataset_changes_and_the_other_stays(client, broker):
    client.patch(f"{ENTITY}/attrs", json={attrs("many"): {"value": 22, "datasetId": "urn:d:2"}})
    values = {i["datasetId"]: i["value"] for i in broker.entities[MACHINE][attrs("many")]}
    assert values == {"urn:d:1": 1, "urn:d:2": 22}


def test_unknown_dataset_is_not_found(client):
    answer = client.patch(f"{ENTITY}/attrs", json={attrs("many"): {"value": 22, "datasetId": "urn:d:9"}})
    assert answer.status_code == 404


def test_missing_attribute_is_not_found_though_the_broker_would_answer_204(client, broker):
    answer = client.patch(f"{ENTITY}/attrs", json={attrs("nope"): {"value": 1}})
    assert answer.status_code == 404
    assert all(r.method == "GET" for r in broker.requests)


def test_missing_entity_is_not_found(client):
    assert client.patch("/api/ngsi/entities/urn:none/attrs", json={"a": {"value": 1}}).status_code == 404
    assert client.get("/api/ngsi/entities/urn:none").status_code == 404
    assert client.delete("/api/ngsi/entities/urn:none").status_code == 404


def test_text_for_a_number_is_invalid(client, broker):
    answer = client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": "abc"}})
    assert answer.status_code == 422
    assert "must be a number" in answer.json()["error"]["message"]
    assert broker.entities[MACHINE][attrs()]["value"] == 42


def test_adding_an_existing_attribute_is_a_conflict_and_changes_nothing(client, broker):
    body = {attrs("state"): {"type": "Property", "value": "X"}, attrs("fresh"): {"type": "Property", "value": 1}}
    answer = client.post(f"{ENTITY}/attrs", json=body)
    assert answer.status_code == 409
    assert attrs("fresh") not in broker.entities[MACHINE]


def test_add_new_attribute(client, broker):
    assert client.post(f"{ENTITY}/attrs", json={"fresh": {"type": "Property", "value": 1}}).status_code == 204
    assert broker.entities[MACHINE]["fresh"]["value"] == 1


def test_delete_attribute_and_all_datasets(client, broker):
    answer = client.delete(f"{ENTITY}/attrs", params={"name": attrs("many")})
    assert answer.status_code == 204
    assert attrs("many") not in broker.entities[MACHINE]


def test_delete_missing_attribute_is_not_found(client):
    assert client.delete(f"{ENTITY}/attrs", params={"name": "nope"}).status_code == 404


def test_delete_sub_attribute_keeps_the_rest(client, broker):
    answer = client.delete(f"{ENTITY}/attrs", params={"name": attrs(), "sub_attribute": attrs("low")})
    assert answer.status_code == 204
    stored = broker.entities[MACHINE][attrs()]
    assert attrs("low") not in stored
    assert stored[attrs("limit")]["value"] == 99
    assert stored["unitCode"] == "CEL"


def test_delete_missing_or_value_member_as_sub_attribute(client, broker):
    params = {"name": attrs(), "sub_attribute": "nope"}
    assert client.delete(f"{ENTITY}/attrs", params=params).status_code == 404
    params = {"name": attrs(), "sub_attribute": "value"}
    assert client.delete(f"{ENTITY}/attrs", params=params).status_code == 404
    assert broker.entities[MACHINE][attrs()]["value"] == 42


# Sub-attributes at a path ---------------------------------------------------------------------


def deep(broker: Broker) -> list[dict]:
    """An attribute with two datasets, each with sub-attributes two levels deep."""

    def instance(dataset: str, value: int) -> dict:
        return {
            "type": "Property",
            "value": value,
            "datasetId": dataset,
            attrs("limit"): {
                "type": "Property",
                "value": 99,
                attrs("max"): {"type": "Property", "value": value * 10, "unitCode": "CEL"},
                attrs("min"): {"type": "Property", "value": 0},
            },
            attrs("note"): {"type": "Property", "value": "kept"},
        }

    broker.entities[MACHINE][attrs("deep")] = [instance("urn:d:1", 1), instance("urn:d:2", 2)]
    return broker.entities[MACHINE][attrs("deep")]


def at(*path: str, **extra: str) -> dict:
    return {"name": attrs("deep"), "path": [attrs(p) for p in path], **extra}


def test_changing_at_depth_two_keeps_everything_else(client, broker):
    stored = deep(broker)
    body = {attrs("deep"): {"value": 25}}
    answer = client.patch(f"{ENTITY}/attrs", params=at("limit", "max", dataset_id="urn:d:2"), json=body)
    assert answer.status_code == 204
    one, two = stored
    assert two[attrs("limit")][attrs("max")]["value"] == 25
    assert two[attrs("limit")][attrs("max")]["unitCode"] == "CEL"
    assert two[attrs("limit")][attrs("max")]["observedAt"].endswith("Z")
    assert two[attrs("limit")][attrs("min")] == {"type": "Property", "value": 0}
    assert two[attrs("limit")]["value"] == 99
    assert two["value"] == 2
    assert two[attrs("note")]["value"] == "kept"
    assert one[attrs("limit")][attrs("max")]["value"] == 10
    written = broker.requests[-1]
    assert written.method == "PATCH"
    assert written.url.raw_path.decode().endswith(f"/attrs/{quote(attrs('deep'), safe='')}")
    assert json.loads(written.content)["datasetId"] == "urn:d:2"


def test_adding_at_depth_two(client, broker):
    stored = deep(broker)
    body = {attrs("deep"): {attrs("step"): {"type": "Property", "value": 5}}}
    answer = client.post(f"{ENTITY}/attrs", params=at("limit", "max", dataset_id="urn:d:1"), json=body)
    assert answer.status_code == 204
    one, two = stored
    assert one[attrs("limit")][attrs("max")][attrs("step")]["value"] == 5
    assert one[attrs("limit")][attrs("max")]["value"] == 10
    assert one[attrs("limit")][attrs("min")]["value"] == 0
    assert attrs("step") not in two[attrs("limit")][attrs("max")]


def test_adding_an_existing_sub_attribute_at_depth_is_a_conflict_and_changes_nothing(client, broker):
    stored = deep(broker)
    before = json.dumps(stored, sort_keys=True)
    body = {attrs("deep"): {attrs("min"): {"type": "Property", "value": 5}}}
    answer = client.post(f"{ENTITY}/attrs", params=at("limit", dataset_id="urn:d:1"), json=body)
    assert answer.status_code == 409
    assert answer.json()["error"]["kind"] == "conflict"
    assert json.dumps(stored, sort_keys=True) == before
    assert all(r.method == "GET" for r in broker.requests)


@pytest.mark.parametrize(
    "member", ["observedAt", "unitCode", "createdAt", "modifiedAt", "instanceId", "lang", "object"]
)
def test_a_member_of_the_attribute_is_no_sub_attribute_name(client, broker, member):
    stored = deep(broker)
    before = json.dumps(stored, sort_keys=True)
    body = {attrs("deep"): {member: {"type": "Property", "value": 1}}}
    answer = client.post(f"{ENTITY}/attrs", params=at("limit", dataset_id="urn:d:1"), json=body)
    assert answer.status_code == 422
    assert answer.json()["error"]["kind"] == "invalid"
    assert json.dumps(stored, sort_keys=True) == before
    assert all(r.method == "GET" for r in broker.requests)


@pytest.mark.parametrize("member", ["datasetId", "observedAt", "unitCode", "createdAt", "value"])
@pytest.mark.parametrize("params", [{"sub_attribute": "{member}"}, {"path": "{member}"}])
def test_a_member_of_the_attribute_is_not_deleted_as_a_sub_attribute(client, broker, member, params):
    stored = deep(broker)
    before = json.dumps(stored, sort_keys=True)
    query = {"name": attrs("deep"), **{k: v.format(member=member) for k, v in params.items()}}
    answer = client.delete(f"{ENTITY}/attrs", params=query)
    assert answer.status_code == 404
    assert answer.json()["error"]["kind"] == "not_found"
    assert json.dumps(stored, sort_keys=True) == before
    assert all(r.method == "GET" for r in broker.requests)


def test_deleting_at_depth_two_removes_it_from_each_dataset(client, broker):
    stored = deep(broker)
    del stored[1][attrs("limit")][attrs("min")]  # only one dataset has it now
    stored.append({"type": "Property", "value": 3, "datasetId": "urn:d:3"})
    answer = client.delete(f"{ENTITY}/attrs", params=at("limit", "min"))
    assert answer.status_code == 204
    one, two, three = broker.entities[MACHINE][attrs("deep")]
    assert attrs("min") not in one[attrs("limit")]
    assert one[attrs("limit")][attrs("max")]["value"] == 10
    assert two[attrs("limit")][attrs("max")]["value"] == 20
    assert three == {"type": "Property", "value": 3, "datasetId": "urn:d:3"}
    assert [r.method for r in broker.requests].count("PATCH") == 1


def test_deleting_at_depth_two_from_every_dataset(client, broker):
    deep(broker)
    assert client.delete(f"{ENTITY}/attrs", params=at("limit", "max")).status_code == 204
    for instance in broker.entities[MACHINE][attrs("deep")]:
        assert attrs("max") not in instance[attrs("limit")]
        assert instance[attrs("limit")][attrs("min")]["value"] == 0


@pytest.mark.parametrize(
    ("method", "path", "missing"),
    [
        ("patch", ("nope", "max"), "nope"),
        ("patch", ("limit", "nope"), "nope"),
        ("post", ("limit", "nope"), "nope"),
        ("delete", ("nope", "max"), "nope"),
        ("delete", ("limit", "nope"), "nope"),
        ("patch", ("limit", "value"), "value"),
    ],
)
def test_a_missing_level_is_not_found_with_its_name_and_nothing_changes(client, broker, method, path, missing):
    stored = deep(broker)
    before = json.dumps(stored, sort_keys=True)
    body = {attrs("deep"): {"value": 1} if method == "patch" else {attrs("x"): {"type": "Property", "value": 1}}}
    params = at(*path, dataset_id="urn:d:1") if method != "delete" else at(*path)
    kwargs = {} if method == "delete" else {"json": body}
    answer = getattr(client, method)(f"{ENTITY}/attrs", params=params, **kwargs)
    assert answer.status_code == 404
    assert answer.json()["error"]["kind"] == "not_found"
    assert f"sub-attribute {attrs(missing)}" in answer.json()["error"]["message"]
    assert json.dumps(stored, sort_keys=True) == before
    assert all(r.method == "GET" for r in broker.requests)


def test_a_path_below_a_missing_attribute_is_not_found(client, broker):
    answer = client.delete(f"{ENTITY}/attrs", params={"name": attrs("nope"), "path": attrs("limit")})
    assert answer.status_code == 404
    assert attrs("nope") in answer.json()["error"]["message"]


def test_one_path_entry_is_the_old_sub_attribute_parameter(client, broker):
    answer = client.delete(f"{ENTITY}/attrs", params={"name": attrs(), "path": attrs("low")})
    assert answer.status_code == 204
    stored = broker.entities[MACHINE][attrs()]
    assert attrs("low") not in stored
    assert stored[attrs("limit")]["value"] == 99
    old = Broker()
    TestClient(app_with(old)).delete(f"{ENTITY}/attrs", params={"name": attrs(), "sub_attribute": attrs("low")})
    assert old.entities == broker.entities
    assert [(r.method, r.url.path) for r in old.requests] == [(r.method, r.url.path) for r in broker.requests]


def test_changing_at_depth_one_on_a_single_instance(client, broker):
    body = {attrs(): {"value": 100}}
    assert (
        client.patch(f"{ENTITY}/attrs", params={"name": attrs(), "path": attrs("limit")}, json=body).status_code == 204
    )
    stored = broker.entities[MACHINE][attrs()]
    assert stored[attrs("limit")]["value"] == 100
    assert stored[attrs("low")]["value"] == 1
    assert stored["value"] == 42


def test_several_datasets_without_naming_one_is_not_found(client, broker):
    deep(broker)
    answer = client.patch(f"{ENTITY}/attrs", params=at("limit"), json={attrs("deep"): {"value": 1}})
    assert answer.status_code == 404
    assert "dataset" in answer.json()["error"]["message"]


@pytest.mark.parametrize(
    ("params", "body"),
    [
        ({"path": "x"}, {"x": {"value": 1}}),  # no name
        ({"name": "a", "path": "x"}, {"b": {"value": 1}}),  # another attribute
        ({"name": "a", "path": "x"}, {"a": {"value": 1}, "b": {"value": 1}}),
    ],
)
def test_a_path_body_holds_the_named_attribute_only(client, broker, params, body):
    assert client.patch(f"{ENTITY}/attrs", params=params, json=body).status_code == 422
    assert client.post(f"{ENTITY}/attrs", params=params, json=body).status_code == 422
    assert broker.requests == []


# Import and bulk delete -----------------------------------------------------------------------


def test_import_tells_created_from_updated(client, broker):
    body = [
        {"id": MACHINE, "type": f"{IRI}cutter", "n": {"type": "Property", "value": 1}},
        {"id": "urn:n:1", "type": "T"},
    ]
    answer = client.post("/api/ngsi/import", json=body)
    assert answer.status_code == 200
    assert [r["result"] for r in answer.json()] == ["updated", "created"]
    # Replaced: it holds exactly what was imported, and the attributes not in the file are gone.
    assert broker.entities[MACHINE] == body[0]
    assert attrs("temp") not in broker.entities[MACHINE]
    upserts = [r for r in broker.requests if r.url.path.endswith("/entityOperations/upsert")]
    assert upserts and all("options" not in r.url.params for r in upserts)


def test_reimporting_without_an_attribute_removes_it(client, broker):
    first = {"id": "urn:n:2", "type": "T", "a": {"type": "Property", "value": 1}, "b": {"type": "Property", "value": 2}}
    assert client.post("/api/ngsi/import", json=[first]).json()[0]["result"] == "created"
    again = {"id": "urn:n:2", "type": "T", "a": {"type": "Property", "value": 3}}
    assert client.post("/api/ngsi/import", json=[again]).json()[0]["result"] == "updated"
    assert broker.entities["urn:n:2"] == again


def test_import_partial_failure_is_207_with_reasons_in_input_order(client):
    body = [
        {"id": "urn:n:reject", "type": "T"},
        "not an entity",
        {"id": "no uri", "type": "T"},
        {"id": "urn:n:notype"},
        {"id": "urn:n:ok", "type": "T"},
        {"id": MACHINE, "type": "Other"},
    ]
    answer = client.post("/api/ngsi/import", json=body)
    assert answer.status_code == 207
    rows = answer.json()
    assert [r["result"] for r in rows] == ["failed", "failed", "failed", "failed", "created", "failed"]
    assert rows[0]["reason"] == "rejected by broker"
    assert "not an entity" in rows[1]["reason"]
    assert "exists with the type" in rows[5]["reason"]


def test_import_splits_entities_with_their_own_context(client, broker):
    body = [{"id": "urn:n:1", "type": "T"}, {"@context": CORE, "id": "urn:n:2", "type": "T"}]
    answer = client.post("/api/ngsi/import", json=body)
    assert answer.status_code == 200
    posts = [r for r in broker.requests if r.url.path.endswith("upsert")]
    assert sorted(r.headers["content-type"] for r in posts) == ["application/json", "application/ld+json"]


def test_import_context_body_gets_no_link_header():
    fake = Broker()
    client_ = TestClient(app_with(fake, ngsi_context_url="https://contexts.example/c.jsonld"))
    client_.post("/api/ngsi/import", json=[{"@context": CORE, "id": "urn:n:2", "type": "T"}])
    post = next(r for r in fake.requests if r.url.path.endswith("upsert"))
    assert "Link" not in post.headers


def test_import_needs_a_list(client):
    assert client.post("/api/ngsi/import", json={"id": "x"}).status_code == 422


def test_import_more_than_one_batch(client, broker):
    body = [{"id": f"urn:n:{i}", "type": "T"} for i in range(250)]
    answer = client.post("/api/ngsi/import", json=body)
    assert {r["result"] for r in answer.json()} == {"created"}
    assert len([r for r in broker.requests if r.url.path.endswith("upsert")]) == 3


def test_delete_by_types_counts_more_than_a_page(broker):
    for i in range(1500):
        broker.entities[f"urn:b:{i}"] = {"id": f"urn:b:{i}", "type": "Bulk"}
    client_ = TestClient(app_with(broker))
    answer = client_.post("/api/ngsi/delete-by-types", json={"types": ["Bulk", "Unknown"]})
    assert answer.json() == [{"type": "Bulk", "count": 1500}, {"type": "Unknown", "count": 0}]
    assert MACHINE in broker.entities


@pytest.mark.parametrize("wildcard", ["*", "T|U", f"{IRI}cutter,T", f"{IRI}cutter;T"])
def test_delete_by_types_refuses_type_queries(client, broker, wildcard):
    answer = client.post("/api/ngsi/delete-by-types", json={"types": [wildcard]})
    assert answer.json() == [{"type": wildcard, "count": 0}]
    assert MACHINE in broker.entities


def test_delete_by_types_failure_says_how_many_went_first(broker):
    broker.entities["urn:b:1"] = {"id": "urn:b:1", "type": "A"}
    broker.entities["urn:b:2"] = {"id": "urn:b:2", "type": "Z"}
    real = broker.__call__

    def failing(request):
        if request.url.path.endswith("entityOperations/delete") and b"urn:b:2" in request.content:
            return httpx.Response(500)
        return real(request)

    answer = TestClient(app_with(failing)).post("/api/ngsi/delete-by-types", json={"types": ["A", "Z"]})
    assert answer.status_code == 502
    assert "1 entity was deleted before this" in answer.json()["error"]["message"]


# Failures -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "http", "kind"),
    [(500, 502, "unavailable"), (503, 502, "unavailable"), (401, 401, "unauthorized"), (403, 401, "unauthorized")],
)
def test_broker_failures(status, http, kind):
    client_ = TestClient(app_with(lambda request: httpx.Response(status, json={"detail": "http://inner:1 secret"})))
    answer = client_.get("/api/ngsi/types")
    assert answer.status_code == http
    assert answer.json()["error"]["kind"] == kind
    assert "inner" not in answer.text
    assert "context broker" in answer.text


def test_broker_reason_is_shown_for_a_rejected_request():
    client_ = TestClient(app_with(lambda request: httpx.Response(400, json={"title": "Bad", "detail": "no good"})))
    answer = client_.get("/api/ngsi/entities", params={"type": "T"})
    assert answer.status_code == 422
    assert answer.json()["error"]["message"] == "no good"


def test_unreachable_broker_is_502_without_its_address():
    def down(request):
        raise httpx.ConnectError("connect to http://secret-host:9090 failed", request=request)

    answer = TestClient(app_with(down)).get("/api/ngsi/stats")
    assert answer.status_code == 502
    assert "secret-host" not in answer.text
    assert answer.json()["error"]["kind"] == "unavailable"


def test_answer_that_is_not_json_is_502():
    answer = TestClient(app_with(lambda request: httpx.Response(200, text="<html>"))).get("/api/ngsi/types")
    assert answer.status_code == 502


def test_token_goes_to_the_broker_and_nowhere_else(caplog, broker):
    caplog.set_level(logging.DEBUG)
    client_ = TestClient(app_with(broker))
    answers = [
        client_.get("/api/ngsi/types"),
        client_.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 1}}),
        client_.patch(f"{ENTITY}/attrs", json={attrs(): {"value": "x"}}),
        client_.get("/api/ngsi/entities/urn:none"),
    ]
    assert all(r.headers["Authorization"] == f"Bearer {TOKEN}" for r in broker.requests)
    assert all(TOKEN not in a.text for a in answers)
    assert TOKEN not in caplog.text


def test_no_token_means_no_header(broker):
    TestClient(app_with(broker, token=lambda: None)).get("/api/ngsi/types")
    assert "Authorization" not in broker.requests[-1].headers


def test_body_is_json_of_what_the_broker_got(client, broker):
    client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 43}})
    sent = json.loads(next(r for r in broker.requests if r.method == "PATCH").content)
    assert sent[attrs()]["type"] == "Property"


@pytest.mark.parametrize(
    ("expression", "value", "found"),
    [
        ("serial~=20", "M20-A", True),
        ("serial!~=20", "M20-A", False),
        ("serial~=20.0", "M20-A", False),
        ("serial~=true", "not-true-1", True),
        ("serial!~=true", "M20-A", True),
        ("serial~=True", "not-true-1", False),
        ('serial~="M","Z"', "Z-1", True),
        ('serial~="M","Z"', "A-1", False),
        ('serial!~="M","Z"', "Z-1", False),
        ('serial!~="M","Z"', "A-1", True),
        ("serial~=M,Z", "Z-1", True),
        ("serial~=1..5", "11115", True),
    ],
)
def test_patterns_are_the_text_as_written(expression, value, found):
    entity = {"id": "urn:e", "type": "T", "serial": {"type": "Property", "value": value}}
    assert q.matches(entity, q.parse(expression)) is found


@pytest.mark.parametrize("bad", ['a~="M","("', 'a!~="(",M'])
def test_every_pattern_of_a_list_is_checked(bad):
    with pytest.raises(Refused) as caught:
        q.parse(bad)
    assert caught.value.kind == "invalid"


@pytest.mark.parametrize(
    "text",
    [
        "fails at scorpio.svc.cluster.local:9090 [/10.0.0.5]",
        "Connection to kafka:9092 refused",
        "host 10.1.2.3 down",
        "postgres.iff.svc is gone",
        "http://a.b:1/c failed",
    ],
)
def test_addresses_leave_a_reason(text):
    result = scrubbed(text)
    for piece in ("scorpio", "10.0.0.5", "kafka", "9092", "10.1.2.3", "postgres.iff", "a.b:1"):
        assert piece not in result


@pytest.mark.parametrize(
    "text", ["The attribute urn:ngsi-ld:Machine:12345 is bad", "Value 1.5 is too big", "a.b is not valid"]
)
def test_a_reason_without_an_address_stays(text):
    assert scrubbed(text) == text


def test_a_long_reason_takes_no_long_time():
    started = time.perf_counter()
    scrubbed("a" * 400_000 + " " + "b." * 200_000)
    assert time.perf_counter() - started < 1


def test_deep_or_broken_documents_are_refused_without_recursion():
    deep: list = []
    for _ in range(50_000):
        deep = [deep]
    for bad in (deep, {"a": "\ud800"}, {"\ud800": 1}, ["x", ["\udfff"]]):
        with pytest.raises(Refused) as caught:
            check_document(bad)
        assert caught.value.kind == "invalid"
    check_document({"a": [{"b": "fine"}]})


# Paging, attributes to return, and the has-attribute filter ------------------------------------


def many(broker: Broker, count: int = 7) -> list[str]:
    """`count` entities of type T, half of them with attribute `a`, all with `b`."""
    ids = []
    for n in range(count):
        entity = {"id": f"urn:p:{n}", "type": "T", "b": {"type": "Property", "value": n}}
        if n % 2 == 0:
            entity["a"] = {"type": "Property", "value": n}
        broker.entities[entity["id"]] = entity
        ids.append(entity["id"])
    return ids


def test_paging_to_the_end_gives_every_match_once_with_the_total(client, broker):
    ids = many(broker)
    seen, offset = [], 0
    while True:
        answer = client.get("/api/ngsi/entities", params={"type": "T", "limit": 3, "offset": offset})
        page = [e["id"] for e in answer.json()]
        # Past the end the broker counts 0, so no total is given rather than a wrong one.
        assert answer.status_code == 200 and answer.headers.get("X-Total-Count") == ("7" if page else None)
        if not page:
            break
        seen += page
        offset += 3
    assert seen == ids and offset == 9
    sent = [r for r in broker.requests if r.url.params.get("type") == "T"]
    assert [r.url.params["offset"] for r in sent] == ["0", "3", "6", "9"] and sent[0].url.params["count"] == "true"
    assert all(r.url.params["orderBy"] == "id" for r in sent)  # or the broker's pages overlap


@pytest.mark.parametrize("offset", ["-1", "x", "1.5"])
def test_an_invalid_offset_is_refused_before_the_broker(client, broker, offset):
    answer = client.get("/api/ngsi/entities", params={"type": "T", "offset": offset})
    assert answer.status_code in (400, 422) and answer.json()["error"]["kind"] == "invalid"
    assert not broker.requests


def test_offset_with_an_expression_the_backend_evaluates(client, broker):
    many(broker)
    # `~=` on an attribute is evaluated here (see the query tests), over whole entities.
    params = {"type": "T", "q": 'b~=".*"', "limit": 2}
    first = client.get("/api/ngsi/entities", params=params | {"offset": 0})
    second = client.get("/api/ngsi/entities", params=params | {"offset": 2})
    assert [e["id"] for e in first.json()] == ["urn:p:0", "urn:p:1"]
    assert [e["id"] for e in second.json()] == ["urn:p:2", "urn:p:3"]
    assert second.headers.get("X-Total-Count") == "7"  # every entity was read


def test_selected_attributes_are_what_the_broker_returns(client, broker):
    many(broker)
    answer = client.get("/api/ngsi/entities", params={"type": "T", "attrs": "a"})
    direct = broker._query({"type": "T", "attrs": "a", "limit": "100"}).json()
    assert answer.json() == direct
    assert [e["id"] for e in direct] == ["urn:p:0", "urn:p:2", "urn:p:4", "urn:p:6"] and all(
        "b" not in e for e in direct
    )


def test_selected_attributes_after_the_backends_own_evaluation_match_on_whole_entities(client, broker):
    many(broker)
    # The condition is on `b`, and only `a` is returned: matching must see `b`.
    answer = client.get("/api/ngsi/entities", params={"type": "T", "q": 'b~="^[0-3]$"', "attrs": "a"})
    assert [e["id"] for e in answer.json()] == ["urn:p:0", "urn:p:2"]
    assert all(set(e) == {"id", "type", "a"} for e in answer.json())


def test_has_attribute_returns_whole_entities(client, broker):
    many(broker)
    answer = client.get("/api/ngsi/entities", params={"type": "T", "has_attr": "a"})
    found = answer.json()
    expected = [e["id"] for e in broker._query({"type": "T", "attrs": "a", "limit": "100"}).json()]
    assert [e["id"] for e in found] == expected
    assert all("b" in e and "a" in e for e in found)
    assert answer.headers["X-Total-Count"] == "4"


def test_has_attribute_with_selected_attributes(client, broker):
    many(broker)
    found = client.get("/api/ngsi/entities", params={"type": "T", "has_attr": "a", "attrs": "b"}).json()
    assert [e["id"] for e in found] == ["urn:p:0", "urn:p:2", "urn:p:4", "urn:p:6"]
    assert all(set(e) == {"id", "type", "b"} for e in found)


def test_has_attribute_nothing_has_it(client, broker):
    many(broker)
    answer = client.get("/api/ngsi/entities", params={"type": "T", "has_attr": "nothing"})
    assert answer.status_code == 200 and answer.json() == []


def test_has_attribute_names_one(client, broker):
    answer = client.get("/api/ngsi/entities", params={"type": "T", "has_attr": "a,b"})
    assert answer.json()["error"]["kind"] == "invalid" and not broker.requests


def test_has_attribute_with_the_backends_own_evaluation(client, broker):
    many(broker)
    found = client.get("/api/ngsi/entities", params={"type": "T", "q": 'b~=".*"', "has_attr": "a"}).json()
    assert [e["id"] for e in found] == ["urn:p:0", "urn:p:2", "urn:p:4", "urn:p:6"]
    assert all("b" in e for e in found)


def test_has_attribute_reads_a_large_page_in_chunks_in_order(client, broker):
    for n in range(250):
        broker.entities[f"urn:q:{n:03d}"] = {"id": f"urn:q:{n:03d}", "type": "Q", "a": {"type": "Property", "value": n}}
    found = client.get("/api/ngsi/entities", params={"type": "Q", "has_attr": "a", "limit": 1000}).json()
    assert [e["id"] for e in found] == [f"urn:q:{n:03d}" for n in range(250)]
    reads = [r for r in broker.requests if r.url.params.get("type") == "*" and "id" in r.url.params]
    assert [len(r.url.params["id"].split(",")) for r in reads] == [100, 100, 50]


# ── Declared values (gh-84-read-declared-values) ─────────────────────────────

DOUBLE = "http://www.w3.org/2001/XMLSchema#double"


@pytest.mark.parametrize(
    ("expression", "value", "found"),
    [
        ("temp==40..50", {"type": DOUBLE, "@value": 42.5}, True),
        ("temp>40", {"type": DOUBLE, "@value": 42.5}, True),
        ("temp>40", {"type": DOUBLE, "@value": "42.5"}, True),
        ("temp<40", {"type": DOUBLE, "@value": "42.5"}, False),
        ("temp==42.5", {"@type": DOUBLE, "@value": 42.5}, True),
        ('temp~="^42"', {"type": DOUBLE, "@value": 42.5}, True),
        ("temp~=double", {"type": DOUBLE, "@value": 42.5}, False),
        ("temp==40..50", 42.5, True),
    ],
)
def test_declared_values_are_compared_as_their_values(expression, value, found):
    entity = {"id": "urn:e", "type": "T", "temp": {"type": "Property", "value": value}}
    assert q.matches(entity, q.parse(expression)) is found


def _declare_temp(broker, value=42.5):
    broker.entities[MACHINE][attrs()]["value"] = {"type": DOUBLE, "@value": value}


def _sent_value(broker):
    """The value of the temperature in the last write the backend sent to the broker."""
    for request in reversed(broker.requests):
        if request.method in ("PATCH", "POST") and request.content:
            body = json.loads(request.content)
            for item in body if isinstance(body, list) else [body]:
                if isinstance(item, dict) and attrs() in item:
                    return item[attrs()]["value"]
    raise AssertionError("no write of the temperature was sent")


def test_text_for_a_declared_number_is_invalid(client, broker):
    _declare_temp(broker)
    before = len(broker.requests)
    answer = client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": "hot"}})
    assert answer.status_code == 422
    assert "must be a number" in answer.json()["error"]["message"]
    assert broker.entities[MACHINE][attrs()]["value"] == {"type": DOUBLE, "@value": 42.5}
    assert not [r for r in broker.requests[before:] if r.method in ("PATCH", "POST")], "the broker is not called"


def test_a_number_for_a_declared_number_is_sent_declared(client, broker):
    _declare_temp(broker)
    assert client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 80}}).status_code == 204
    assert _sent_value(broker) == {"@value": 80, "@type": DOUBLE}
    # Not as a merge, which the broker fails on a value object (Scorpio 22023), but as the whole
    # attribute through the attribute write, so its unit and sub-attributes stay.
    write = next(r for r in reversed(broker.requests) if r.method in ("PATCH", "POST") and r.content)
    assert write.method == "POST" and write.url.path.endswith("/attrs")
    assert json.loads(write.content)[attrs()]["unitCode"] == "CEL"


def test_a_plain_number_is_edited_as_before(client, broker):
    assert client.patch(f"{ENTITY}/attrs", json={attrs(): {"value": 80}}).status_code == 204
    assert _sent_value(broker) == 80


def test_a_declared_sub_attribute_keeps_its_datatype_when_edited_at_its_path(client, broker):
    """A path-addressed edit writes the whole instance; the declared datatype goes with it."""
    broker.entities[MACHINE][attrs()][attrs("limit")]["value"] = {"type": DOUBLE, "@value": 99}
    params = {"name": attrs(), "path": attrs("limit")}
    refused = client.patch(f"{ENTITY}/attrs", params=params, json={attrs(): {"value": "hot"}})
    assert refused.status_code == 422
    assert "must be a number" in refused.json()["error"]["message"]
    assert client.patch(f"{ENTITY}/attrs", params=params, json={attrs(): {"value": 100}}).status_code == 204
    stored = broker.entities[MACHINE][attrs()]
    assert stored[attrs("limit")]["value"] == {"@value": 100, "@type": DOUBLE}
    assert stored["value"] == 42, "the attribute's own value is untouched"
