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


# Import and bulk delete -----------------------------------------------------------------------


def test_import_tells_created_from_updated(client, broker):
    body = [
        {"id": MACHINE, "type": f"{IRI}cutter", "n": {"type": "Property", "value": 1}},
        {"id": "urn:n:1", "type": "T"},
    ]
    answer = client.post("/api/ngsi/import", json=body)
    assert answer.status_code == 200
    assert [r["result"] for r in answer.json()] == ["updated", "created"]
    assert attrs("temp") in broker.entities[MACHINE]


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
