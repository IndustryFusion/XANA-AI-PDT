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
"""The explorer against real services: a broker (TEST_BROKER_URL) and PostgREST (TEST_PGREST_URL) over
the time-series database (TEST_TSDB_URL). Rows are written in the platform's table layout, with
the columns it has, and full IRIs as attribute names."""

import asyncio
import os
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.explorer_support import app_with
from xana_agent.literals import datatype, literal

pytestmark = pytest.mark.services
BROKER = os.environ.get("TEST_BROKER_URL")
PGREST = os.environ.get("TEST_PGREST_URL")
TSDB = os.environ.get("TEST_TSDB_URL")
IRI = "https://industry-fusion.com/types/v0.9/"
NGSI = "https://uri.etsi.org/ngsi-ld/"
XSD = "http://www.w3.org/2001/XMLSchema#"

needs_broker = pytest.mark.skipif(not BROKER, reason="TEST_BROKER_URL not set")
needs_history = pytest.mark.skipif(not (PGREST and TSDB), reason="TEST_PGREST_URL and TEST_TSDB_URL not set")


def unique(kind: str = "m") -> str:
    return f"urn:test:{kind}:{uuid.uuid4().hex[:12]}"


@pytest.fixture
def api():
    token = os.environ.get("TEST_TOKEN")
    app = app_with(
        token=lambda: token, ngsi_url=BROKER or "http://127.0.0.1:1", pgrest_url=PGREST or "http://127.0.0.1:1"
    )
    # Real services here: the transports of the fakes are replaced.
    app.state.broker._transport = None
    app.state.attribute_history._transport = None
    return TestClient(app)


@pytest.fixture
def entity(api):
    """An entity named by full IRIs, removed afterwards."""
    entity_id = unique()
    body = {
        "id": entity_id,
        "type": f"{IRI}cutter_{uuid.uuid4().hex[:8]}",
        f"{IRI}temp": {
            "type": "Property",
            "value": 42,
            "unitCode": "CEL",
            f"{IRI}limit": {"type": "Property", "value": 99},
            f"{IRI}low": {"type": "Property", "value": 1},
        },
        f"{IRI}state": {"type": "Property", "value": "ON"},
        f"{IRI}hasFilter": {"type": "Relationship", "object": "urn:test:filter:1"},
        f"{IRI}many": [
            {"type": "Property", "value": 1, "datasetId": "urn:d:1"},
            {"type": "Property", "value": 2, "datasetId": "urn:d:2"},
        ],
        "max_temp": {"type": "Property", "value": 7},
    }
    assert api.post("/api/ngsi/import", json=[body]).json()[0]["result"] == "created"
    yield body
    api.delete(f"/api/ngsi/entities/{entity_id}")


def path(body):
    return f"/api/ngsi/entities/{body['id']}"


@needs_broker
def test_read_back_with_names_unchanged(api, entity):
    stored = api.get(path(entity)).json()
    assert stored[f"{IRI}temp"]["unitCode"] == "CEL"
    assert "max_temp" in stored
    assert entity["type"] in api.get("/api/ngsi/types").json()
    assert f"{IRI}temp" in api.get("/api/ngsi/attributes").json()


@needs_broker
def test_stats_count_for_real(api, entity):
    stats = api.get("/api/ngsi/stats").json()
    assert {"type": entity["type"], "count": 1} in stats["by_type"]
    assert stats["entity_count"] >= 1


@needs_broker
def test_queries_on_iri_data(api, entity):
    def found(**params):
        return [e["id"] for e in api.get("/api/ngsi/entities", params=params).json()]

    assert found(type=entity["type"]) == [entity["id"]]
    assert found(id=entity["id"]) == [entity["id"]]
    assert entity["id"] in found(id_pattern="urn:test:m:.*", limit=1000)
    assert found(type=entity["type"], q=f'{IRI}state=="ON"') == [entity["id"]]
    assert found(type=entity["type"], q=f'{IRI}state=="OFF"') == []
    assert found(type=entity["type"], q=f"{IRI}temp>40;{IRI}state") == [entity["id"]]
    assert found(type=entity["type"], q="max_temp==7") == [entity["id"]]
    # Why a context is needed: a short name silently matches nothing on such data.
    assert found(type=entity["type"], q='state=="ON"') == []


@needs_broker
def test_bad_expression_is_invalid_not_the_brokers_internal_error(api, entity):
    answer = api.get("/api/ngsi/entities", params={"type": entity["type"], "q": "(("})
    assert answer.status_code == 422


@needs_broker
def test_edit_keeps_unit_and_sub_attributes(api, entity):
    assert api.patch(f"{path(entity)}/attrs", json={f"{IRI}temp": {"value": 43}}).status_code == 204
    stored = api.get(path(entity)).json()[f"{IRI}temp"]
    assert stored["value"] == 43
    assert stored["unitCode"] == "CEL"
    assert stored[f"{IRI}limit"]["value"] == 99
    assert stored["observedAt"]


@needs_broker
def test_add_and_change_a_sub_attribute(api, entity):
    fragment = {f"{IRI}temp": {f"{IRI}new": {"type": "Property", "value": 5}}}
    assert api.patch(f"{path(entity)}/attrs", json=fragment).status_code == 204
    stored = api.get(path(entity)).json()[f"{IRI}temp"]
    assert stored["value"] == 42
    assert stored[f"{IRI}new"]["value"] == 5
    assert stored[f"{IRI}limit"]["value"] == 99


@needs_broker
def test_one_dataset_changes(api, entity):
    fragment = {f"{IRI}many": {"value": 22, "datasetId": "urn:d:2"}}
    assert api.patch(f"{path(entity)}/attrs", json=fragment).status_code == 204
    stored = {i["datasetId"]: i["value"] for i in api.get(path(entity)).json()[f"{IRI}many"]}
    assert stored == {"urn:d:1": 1, "urn:d:2": 22}


@needs_broker
def test_refusals_the_broker_would_not_give(api, entity):
    assert api.patch(f"{path(entity)}/attrs", json={f"{IRI}none": {"value": 1}}).status_code == 404
    assert api.patch(f"{path(entity)}/attrs", json={f"{IRI}temp": {"value": "abc"}}).status_code == 422
    conflict = {f"{IRI}state": {"type": "Property", "value": "X"}}
    assert api.post(f"{path(entity)}/attrs", json=conflict).status_code == 409
    assert api.delete(f"{path(entity)}/attrs", params={"name": f"{IRI}none"}).status_code == 404
    assert api.get(path(entity)).json()[f"{IRI}state"]["value"] == "ON"


@needs_broker
def test_add_and_delete_attributes(api, entity):
    added = {f"{IRI}fresh": {"type": "Property", "value": 1}}
    assert api.post(f"{path(entity)}/attrs", json=added).status_code == 204
    assert api.delete(f"{path(entity)}/attrs", params={"name": f"{IRI}fresh"}).status_code == 204
    assert f"{IRI}fresh" not in api.get(path(entity)).json()
    assert api.delete(f"{path(entity)}/attrs", params={"name": f"{IRI}many"}).status_code == 204
    assert f"{IRI}many" not in api.get(path(entity)).json()


@needs_broker
def test_delete_sub_attribute_only(api, entity):
    params = {"name": f"{IRI}temp", "sub_attribute": f"{IRI}low"}
    assert api.delete(f"{path(entity)}/attrs", params=params).status_code == 204
    stored = api.get(path(entity)).json()[f"{IRI}temp"]
    assert f"{IRI}low" not in stored
    assert stored[f"{IRI}limit"]["value"] == 99
    assert stored["value"] == 42


@needs_broker
def test_delete_entity(api, entity):
    assert api.delete(path(entity)).status_code == 204
    assert api.get(path(entity)).status_code == 404


@needs_broker
def test_import_created_updated_failed(api, entity):
    new = unique()
    body = [
        {"id": entity["id"], "type": entity["type"], f"{IRI}added": {"type": "Property", "value": 1}},
        {"id": new, "type": entity["type"]},
        {"id": unique(), "type": "T", "broken": {"type": "Property"}},
        {"id": "no uri", "type": "T"},
    ]
    try:
        answer = api.post("/api/ngsi/import", json=body)
        assert answer.status_code == 207
        rows = answer.json()
        assert [r["result"] for r in rows[:2]] == ["updated", "created"]
        assert rows[3]["result"] == "failed"
        stored = api.get(path(entity)).json()
        assert stored[f"{IRI}added"]["value"] == 1
        assert f"{IRI}state" not in stored  # replaced: what isn't in the file is gone
    finally:
        api.delete(f"/api/ngsi/entities/{new}")
        api.delete(f"/api/ngsi/entities/{body[2]['id']}")


@needs_broker
def test_import_with_and_without_a_context(api):
    ids = [unique(), unique()]
    body = [
        {"id": ids[0], "type": "T"},
        {"@context": "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld", "id": ids[1], "type": "T"},
    ]
    try:
        answer = api.post("/api/ngsi/import", json=body)
        assert answer.status_code == 200, answer.text
        assert [r["result"] for r in answer.json()] == ["created", "created"]
    finally:
        for entity_id in ids:
            api.delete(f"/api/ngsi/entities/{entity_id}")


@needs_broker
def test_delete_by_types_including_more_than_a_page(api):
    kind = f"{IRI}bulk_{uuid.uuid4().hex[:8]}"
    entities = [{"id": unique("b"), "type": kind} for _ in range(1100)]
    assert {r["result"] for r in api.post("/api/ngsi/import", json=entities).json()} == {"created"}
    answer = api.post("/api/ngsi/delete-by-types", json={"types": [kind, "*"]})
    assert answer.json() == [{"type": kind, "count": 1100}, {"type": "*", "count": 0}]
    assert api.get("/api/ngsi/entities", params={"type": kind}).json() == []


def test_stopped_services_give_502():
    app = app_with(token=lambda: None, ngsi_url="http://127.0.0.1:1", pgrest_url="http://127.0.0.1:1")
    app.state.broker._transport = None
    app.state.attribute_history._transport = None
    client = TestClient(app)
    assert client.get("/api/ngsi/types").status_code == 502
    assert client.get("/api/ngsi/history", params={"entity_id": "urn:x", "attribute": "a"}).status_code == 502


@pytest.fixture
def matrix(api):
    """Entities for each operator of `frontend/docs/data-interface.md`, on a real broker."""
    kind = f"Op{uuid.uuid4().hex[:8]}"
    ids = {name: f"urn:test:op:{uuid.uuid4().hex[:10]}" for name in ("run", "idle", "bare")}
    body = [
        {
            "id": ids["run"],
            "type": kind,
            "status": {"type": "Property", "value": "running"},
            "temp": {"type": "Property", "value": 12.5, "acc": {"type": "Property", "value": 2}},
            "partOf": {"type": "Relationship", "object": "urn:line:a"},
            "cfg": {"type": "JsonProperty", "json": {"mode": "auto"}},
            "shifts": {"type": "ListProperty", "valueList": ["early", "late"]},
            "label": {"type": "LanguageProperty", "languageMap": {"en": "Press", "de": "Presse"}},
            f"{IRI}state": {"type": "Property", "value": "ON"},
            "serial": {"type": "Property", "value": "M20-A"},
        },
        {
            "id": ids["idle"],
            "type": kind,
            "status": {"type": "Property", "value": "idle"},
            "temp": {"type": "Property", "value": 99},
            f"{IRI}state": {"type": "Property", "value": "OFF"},
            "serial": {"type": "Property", "value": "Z-true-1"},
        },
        {"id": ids["bare"], "type": kind},
    ]
    assert {r["result"] for r in api.post("/api/ngsi/import", json=body).json()} == {"created"}
    yield kind, ids
    api.post("/api/ngsi/delete-by-types", json={"types": [kind]})


@needs_broker
@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("status", {"run", "idle"}),
        ("!status", {"bare"}),
        ("!nosuch", {"run", "idle", "bare"}),
        ('status=="running"', {"run"}),
        ("status==running", {"run"}),
        ('status!="running"', {"idle"}),
        ('status=="running","idle"', {"run", "idle"}),
        ('status~="^run"', {"run"}),
        ('status~="run.*"', {"run"}),
        ('status!~="^run"', {"idle"}),
        ("serial~=20", {"run"}),
        ("serial!~=20", {"idle"}),
        ("serial~=true", {"idle"}),
        ("serial!~=true", {"run"}),
        ('serial~="M","Z"', {"run", "idle"}),
        ('serial!~="M","Z"', set()),
        ("serial~=M,nothing", {"run"}),
        ("temp~=12.5", {"run"}),
        ("temp>50", {"idle"}),
        ("temp>=99", {"idle"}),
        ("temp<50", {"run"}),
        ("temp<=12.5", {"run"}),
        ("temp==1..50", {"run"}),
        ("temp==13..100", {"idle"}),
        ("temp.acc>=2", {"run"}),
        ("temp.acc", {"run"}),
        ("!temp.acc", {"idle", "bare"}),
        ('partOf=="urn:line:a"', {"run"}),
        ('cfg[mode]=="auto"', {"run"}),
        ('shifts=="late"', {"run"}),
        ('label=="Presse"', {"run"}),
        ('status=="running";!nosuch', {"run"}),
        ('(status=="running"|status=="idle");temp', {"run", "idle"}),
        ('status=="running"|temp==90..100', {"run", "idle"}),
        (f'{IRI}state=="ON"', {"run"}),
        (f'{IRI}state~="^O"', {"run", "idle"}),
        (f"!{IRI}state", {"bare"}),
    ],
)
def test_every_documented_operator_on_a_real_broker(api, matrix, expression, expected):
    kind, ids = matrix
    answer = api.get("/api/ngsi/entities", params={"type": kind, "q": expression, "limit": 1000})
    assert answer.status_code == 200, answer.text
    assert {e["id"] for e in answer.json()} == {ids[name] for name in expected}


@needs_broker
@pytest.mark.parametrize("bad", ["a=={", "a==}", "((", "a==", "!", "a~=", 'a~="("'])
def test_malformed_expressions_are_client_errors_on_a_real_broker(api, matrix, bad):
    answer = api.get("/api/ngsi/entities", params={"type": matrix[0], "q": bad})
    assert answer.status_code == 422, answer.text


@needs_broker
@pytest.mark.parametrize("depth", [600, 3000])
def test_deep_nesting_is_a_client_error_on_a_real_broker(api, depth):
    deep: list = []
    for _ in range(depth):
        deep = [deep]
    answer = api.post(
        "/api/ngsi/import", json=[{"id": "urn:test:deep", "type": "T", "a": {"type": "Property", "value": deep}}]
    )
    assert answer.status_code == 422, answer.text[:200]


@needs_broker
def test_a_lone_surrogate_is_a_client_error_on_a_real_broker(api):
    body = b'[{"id": "urn:test:lone", "type": "T", "a": {"type": "Property", "value": "\\ud800"}}]'
    answer = api.post("/api/ngsi/import", content=body, headers={"Content-Type": "application/json"})
    assert answer.status_code == 422, answer.text[:200]


@needs_broker
def test_a_search_over_the_cap_says_so_on_a_real_broker(api):
    kind = f"Big{uuid.uuid4().hex[:8]}"
    entities = [
        {"id": f"urn:test:big:{kind}:{i:05d}", "type": kind, "n": {"type": "Property", "value": i}} for i in range(5300)
    ]
    try:
        assert {r["result"] for r in api.post("/api/ngsi/import", json=entities).json()} == {"created"}
        answer = api.get("/api/ngsi/entities", params={"type": kind, "q": 'n~="^xx"', "limit": 1000})
        assert answer.status_code == 200
        assert answer.headers["X-Results-Limited"] == "scanned=5000, total=5300"
    finally:
        api.post("/api/ngsi/delete-by-types", json={"types": [kind]})


@needs_broker
def test_a_catastrophic_pattern_on_a_real_broker_does_not_hold_up_the_answer(api, matrix):
    kind, ids = matrix
    patch = {"status": {"value": "a" * 40 + "!"}}
    assert api.patch(f"/api/ngsi/entities/{ids['idle']}/attrs", json=patch).status_code == 204
    started = time.perf_counter()
    assert api.get("/api/ngsi/entities", params={"type": kind, "q": 'status~="(a+)+$"'}).json() == []
    assert time.perf_counter() - started < 5


@needs_broker
def test_two_adds_of_one_attribute_never_both_succeed_on_a_real_broker(api, entity):
    async def race(name):
        transport = httpx.ASGITransport(app=api.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:

            async def add(value):
                body = {name: {"type": "Property", "value": value}}
                return (await client.post(f"{path(entity)}/attrs", json=body)).status_code

            return await asyncio.gather(add("A"), add("B"))

    for i in range(10):
        codes = asyncio.run(race(f"{IRI}race{i}"))
        assert sorted(codes) == [204, 409]


@needs_broker
def test_a_remote_context_never_reaches_a_real_broker(api):
    """The address is internal and would answer: the reason mustn't show it, and the broker mustn't ask."""
    context = "http://127.0.0.1:9/never-fetched.jsonld"
    answer = api.post("/api/ngsi/import", json=[{"@context": context, "id": unique(), "type": "T"}])
    assert answer.status_code == 207
    assert answer.json()[0]["result"] == "failed"
    assert "127.0.0.1" not in answer.json()[0]["reason"]


@needs_broker
def test_identifier_dots_are_refused_on_a_real_broker(api, entity):
    assert api.delete(f"{path(entity)}/attrs", params={"name": ".."}).status_code in (404, 422)
    assert api.get(path(entity)).status_code == 200


@needs_broker
def test_deleting_a_sub_attribute_across_datasets(api):
    entity_id = unique()
    limit = {"type": "Property", "value": 9}
    body = {
        "id": entity_id,
        "type": "T",
        "many": [
            {"type": "Property", "value": 1, "datasetId": "urn:d:1", "limit": limit},
            {"type": "Property", "value": 2, "datasetId": "urn:d:2", "limit": limit},
            {"type": "Property", "value": 3, "datasetId": "urn:d:3"},
        ],
    }
    try:
        assert api.post("/api/ngsi/import", json=[body]).json()[0]["result"] == "created"
        params = {"name": "many", "sub_attribute": "limit"}
        assert api.delete(f"/api/ngsi/entities/{entity_id}/attrs", params=params).status_code == 204
        stored = api.get(f"/api/ngsi/entities/{entity_id}").json()["many"]
        assert {i["datasetId"]: i["value"] for i in stored} == {"urn:d:1": 1, "urn:d:2": 2, "urn:d:3": 3}
        assert all("limit" not in i for i in stored)
    finally:
        api.delete(f"/api/ngsi/entities/{entity_id}")


# History, in the platform's layout -----------------------------------------------------------


def _write(entity_id, entity_type, rows, entity_rows):
    with psycopg.connect(TSDB) as conn, conn.cursor() as cur:
        for at, name, value, extra in rows:
            dataset = extra.get("dataset", "@none")
            kind = extra.get("kind", "Property")
            cur.execute(
                'INSERT INTO attributes ("id", "parentId", "observedAt", "modifiedAt", "entityId", "attributeId", '
                '"attributeType", "datasetId", "nodeType", "value", "valueType", "unitCode", "deleted") '
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    extra.get("id", f"{entity_id}\\{name}\\{dataset}"),
                    extra.get("parent"),
                    at,
                    at,
                    entity_id,
                    f"{IRI}{name}",
                    f"{NGSI}{kind}",
                    dataset,
                    "@id" if kind == "Relationship" else "@value",
                    value,
                    extra.get("value_type"),
                    extra.get("unit"),
                    extra.get("deleted", False),
                ),
            )
        for at, deleted in entity_rows:
            cur.execute(
                'INSERT INTO entities ("id", "observedAt", "modifiedAt", "type", "deleted") '
                "VALUES (%s, %s, %s, %s, %s)",
                (entity_id, at, at, entity_type, deleted),
            )


@pytest.fixture
def recorded():
    """An entity's rows from 5 hours ago up to 1 hour ago, and when it was deleted."""
    entity_id = unique("h")
    entity_type = f"{IRI}hist_{uuid.uuid4().hex[:8]}"
    now = datetime.now(UTC).replace(microsecond=0)
    ago = lambda hours: now - timedelta(hours=hours)  # noqa: E731
    parent = f"{entity_id}\\temp\\@none"
    rows = [
        (ago(5), "temp", "40", {"unit": "CEL", "value_type": f"{XSD}double"}),
        (ago(5), "limit", "90", {"id": f"{parent}\\limit", "parent": parent}),
        (ago(5), "gone", "1", {}),
        (ago(5), "hasFilter", "urn:f:1", {"kind": "Relationship"}),
        (ago(5), "many", "1", {"dataset": "urn:d:1"}),
        (ago(5), "many", "2", {"dataset": "urn:d:2"}),
        (ago(4), "temp", "41", {"unit": "CEL", "deleted": None}),
        (ago(3), "gone", None, {"deleted": True}),
        (ago(3), "hasFilter", "urn:f:2", {"kind": "Relationship"}),
        (ago(3), "state", "ON", {"value_type": f"{XSD}string"}),
        (ago(1), "temp", "99", {"unit": "CEL"}),
    ]
    _write(entity_id, entity_type, rows, [(ago(5), None), (ago(1), True)])
    return {"id": entity_id, "type": entity_type, "ago": ago}


def iso(moment):
    return moment.isoformat()


@needs_history
def test_history_on_the_platform_layout(api, recorded):
    params = {"entity_id": recorded["id"], "attribute": f"{IRI}temp"}
    assert [p["value"] for p in api.get("/api/ngsi/history", params=params).json()] == [40, 41, 99]
    narrow = {**params, "from": iso(recorded["ago"](4.5)), "to": iso(recorded["ago"](2))}
    assert [p["value"] for p in api.get("/api/ngsi/history", params=narrow).json()] == [41]
    short = {**params, "attribute": "temp"}
    assert [p["value"] for p in api.get("/api/ngsi/history", params=short).json()] == [40, 41, 99]
    relation = {**params, "attribute": f"{IRI}hasFilter"}
    assert [p["value"] for p in api.get("/api/ngsi/history", params=relation).json()] == ["urn:f:1", "urn:f:2"]
    sub = {**params, "attribute": f"{IRI}limit"}
    assert [p["value"] for p in api.get("/api/ngsi/history", params=sub).json()] == [90]


@needs_history
@pytest.mark.parametrize(
    "hostile",
    ['x",attributeId.like."*', "x),or=(deleted.is.true", 'a"b', "back\\slash", "with,comma", "(paren)", "%25"],
)
def test_a_real_postgrest_takes_hostile_names_literally(api, recorded, hostile):
    if "*" in hostile:
        hostile = hostile.replace("*", "")
    answer = api.get("/api/ngsi/history", params={"entity_id": recorded["id"], "attribute": hostile})
    assert answer.status_code == 200
    assert answer.json() == []


@needs_history
def test_an_unescaped_quote_would_widen_a_real_filter_but_this_one_does_not(api, recorded):
    """Unescaped, this name adds `entityId.eq...` as another option of the `or`, and every row would match."""
    hostile = f'x",entityId.eq."{recorded["id"]}'
    answer = api.get("/api/ngsi/history", params={"entity_id": recorded["id"], "attribute": hostile})
    assert answer.status_code == 200
    assert answer.json() == []


@needs_history
def test_like_wildcards_match_only_themselves_on_a_real_postgrest(api, recorded):
    params = {"entity_id": recorded["id"]}
    assert [p["value"] for p in api.get("/api/ngsi/history", params={**params, "attribute": "temp"}).json()] == [
        40,
        41,
        99,
    ]
    assert api.get("/api/ngsi/history", params={**params, "attribute": "tem_"}).json() == []
    assert api.get("/api/ngsi/history", params={**params, "attribute": "t%"}).json() == []


@needs_history
def test_a_real_postgrest_takes_a_hostile_entity_literally(api, recorded):
    entity = f"{recorded['id']}&attributeId=like.*"
    answer = api.get("/api/ngsi/history", params={"entity_id": entity, "attribute": f"{IRI}temp"})
    assert answer.json() == []


@needs_history
def test_attribute_status(api, recorded):
    status = api.get("/api/ngsi/attr-status", params={"entity_id": recorded["id"]}).json()
    assert status[f"{IRI}gone"]["deleted"] is True
    assert status[f"{IRI}temp"]["deleted"] is False
    assert f"{IRI}limit" not in status


@needs_history
def test_time_shift_on_the_platform_layout(api, recorded):
    def shifted(hours, **params):
        at = iso(recorded["ago"](hours))
        return api.get("/api/ngsi/timeshift/entities", params={"at": at, "id": recorded["id"], **params}).json()

    def types(hours):
        return api.get("/api/ngsi/timeshift/types", params={"at": iso(recorded["ago"](hours))}).json()

    assert shifted(6) == []
    assert recorded["type"] not in types(6)

    [early] = shifted(4.5)
    assert early["type"] == recorded["type"]
    assert early[f"{IRI}temp"]["value"] == 40
    assert early[f"{IRI}temp"]["unitCode"] == "CEL"
    assert early[f"{IRI}temp"][f"{IRI}limit"]["value"] == 90
    assert early[f"{IRI}gone"]["value"] == 1
    assert early[f"{IRI}hasFilter"]["object"] == "urn:f:1"
    assert {i["datasetId"] for i in early[f"{IRI}many"]} == {"urn:d:1", "urn:d:2"}
    assert recorded["type"] in types(4.5)

    [later] = shifted(2)
    assert later[f"{IRI}temp"]["value"] == 41
    assert f"{IRI}gone" not in later
    assert later[f"{IRI}hasFilter"]["object"] == "urn:f:2"
    assert later[f"{IRI}state"]["value"] == "ON"

    assert shifted(2, q=f"{IRI}temp==41")[0]["id"] == recorded["id"]
    assert shifted(2, q=f"{IRI}temp==40") == []
    assert shifted(0.5) == []
    assert recorded["type"] not in types(0.5)


def test_token_is_needed_without_an_anonymous_role():
    url = os.environ.get("TEST_PGREST_NO_ANON_URL")
    if not url:
        pytest.skip("TEST_PGREST_NO_ANON_URL not set")
    assert httpx.get(f"{url}/attributes", params={"limit": 1}).status_code == 401


# Paging, attributes to return, has-attribute and replacing import ------------------------------


@pytest.fixture
def batch(api):
    """23 entities of a fresh type, every third with attribute `mark`, removed afterwards."""
    kind = f"{IRI}paged_{uuid.uuid4().hex[:8]}"
    body = []
    for n in range(23):
        entity = {"id": unique("p"), "type": kind, f"{IRI}n": {"type": "Property", "value": n}}
        if n % 3 == 0:
            entity[f"{IRI}mark"] = {"type": "Property", "value": "x"}
        body.append(entity)
    assert {r["result"] for r in api.post("/api/ngsi/import", json=body).json()} == {"created"}
    yield kind, body
    api.post("/api/ngsi/delete-by-types", json={"types": [kind]})


def direct(params):
    """The broker's own answer to the same NGSI-LD query."""
    response = httpx.get(f"{BROKER}/ngsi-ld/v1/entities", params=params, headers={"Accept": "application/json"})
    response.raise_for_status()
    return response.json()


@needs_broker
def test_real_paging_to_the_end(api, batch):
    kind, body = batch
    seen, offset = [], 0
    while True:
        answer = api.get("/api/ngsi/entities", params={"type": kind, "limit": 5, "offset": offset})
        page = [e["id"] for e in answer.json()]
        assert answer.status_code == 200 and answer.headers.get("X-Total-Count") == ("23" if page else None)
        assert page == [e["id"] for e in direct({"type": kind, "limit": 5, "offset": offset, "orderBy": "id"})]
        if not page:
            break
        seen += page
        offset += 5
    assert sorted(seen) == sorted(e["id"] for e in body) and len(seen) == len(set(seen)) == 23


@needs_broker
def test_real_selected_attributes_match_the_broker(api, batch):
    kind, _ = batch
    params = {"type": kind, "attrs": f"{IRI}mark", "limit": 100}
    ours = api.get("/api/ngsi/entities", params=params).json()
    assert ours == direct(params | {"orderBy": "id"})  # the same query, in the order the backend asks for
    assert len(ours) == 8 and all(f"{IRI}n" not in e for e in ours)


@needs_broker
def test_real_has_attribute_matches_the_broker_and_is_whole(api, batch):
    kind, _ = batch
    answer = api.get("/api/ngsi/entities", params={"type": kind, "has_attr": f"{IRI}mark", "limit": 100})
    ours = answer.json()
    theirs = direct({"type": kind, "attrs": f"{IRI}mark", "limit": 100, "orderBy": "id"})
    assert [e["id"] for e in ours] == [e["id"] for e in theirs] and len(ours) == 8
    assert all(f"{IRI}n" in e and f"{IRI}mark" in e for e in ours)
    assert answer.headers["X-Total-Count"] == "8"


@needs_broker
def test_real_reimport_without_an_attribute_removes_it(api, entity):
    again = {k: v for k, v in entity.items() if k != f"{IRI}state"}
    assert api.post("/api/ngsi/import", json=[again]).json()[0]["result"] == "updated"
    stored = api.get(path(entity)).json()
    assert f"{IRI}state" not in stored and stored[f"{IRI}temp"]["value"] == 42


@needs_broker
def test_real_has_attribute_with_the_largest_page(api):
    """A thousand IDs in one address are too long for the broker (HTTP 414); they are read in chunks."""
    kind = f"{IRI}many_{uuid.uuid4().hex[:8]}"
    body = [
        {"id": f"urn:test:many:{uuid.uuid4().hex}", "type": kind, f"{IRI}mark": {"type": "Property", "value": n}}
        for n in range(1000)
    ]
    try:
        for start in range(0, len(body), 200):
            assert {r["result"] for r in api.post("/api/ngsi/import", json=body[start : start + 200]).json()} == {
                "created"
            }
        answer = api.get("/api/ngsi/entities", params={"type": kind, "has_attr": f"{IRI}mark", "limit": 1000})
        assert answer.status_code == 200, answer.text[:300]
        theirs = direct({"type": kind, "attrs": f"{IRI}mark", "limit": 1000, "orderBy": "id"})
        assert [e["id"] for e in answer.json()] == [e["id"] for e in theirs] and len(theirs) == 1000
    finally:
        api.post("/api/ngsi/delete-by-types", json={"types": [kind]})


# ── Declared values (gh-84-read-declared-values) ─────────────────────────────

DOUBLE = "http://www.w3.org/2001/XMLSchema#double"


@pytest.fixture
def declared_entity(api):
    """An entity whose temperature is a declared double, as the platform writes one."""
    entity_id = unique()
    body = {
        "id": entity_id,
        "type": f"{IRI}cutter_{uuid.uuid4().hex[:8]}",
        f"{IRI}temp": {"type": "Property", "value": {"@value": 42.5, "@type": DOUBLE}, "unitCode": "CEL"},
    }
    assert api.post("/api/ngsi/import", json=[body]).json()[0]["result"] == "created"
    yield body
    api.delete(f"/api/ngsi/entities/{entity_id}")


@needs_broker
def test_a_declared_double_round_trips(api, declared_entity):
    stored = api.get(path(declared_entity)).json()[f"{IRI}temp"]
    assert literal(stored["value"]) == 42.5
    assert datatype(stored["value"]) == DOUBLE, "the broker returns it declared"

    found = api.get("/api/ngsi/entities", params={"type": declared_entity["type"], "q": f"{IRI}temp==40..50"})
    assert [e["id"] for e in found.json()] == [declared_entity["id"]], "a range is evaluated on the plain value"

    assert api.patch(f"{path(declared_entity)}/attrs", json={f"{IRI}temp": {"value": "hot"}}).status_code == 422
    assert api.patch(f"{path(declared_entity)}/attrs", json={f"{IRI}temp": {"value": 80}}).status_code == 204
    stored = api.get(path(declared_entity)).json()[f"{IRI}temp"]
    assert literal(stored["value"]) == 80
    assert datatype(stored["value"]) == DOUBLE, "the edit keeps the datatype"
    assert stored["unitCode"] == "CEL"


@needs_broker
def test_the_brokers_own_query_on_a_declared_number_is_recorded(api, declared_entity):
    """What the broker's own `q` does with a declared value (gh-84 design, Risks): recorded, not asserted."""
    found = api.get("/api/ngsi/entities", params={"type": declared_entity["type"], "q": f"{IRI}temp>40"})
    matched = [e["id"] for e in found.json()] == [declared_entity["id"]] if found.status_code == 200 else None
    print(f"GH84-BROKER-Q temp>40 on a declared 42.5: status={found.status_code} matched={matched}")


@needs_broker
def test_a_declared_sub_attribute_round_trips(api):
    """A declared double in a sub-attribute, edited at its path (gh-84, D3)."""
    entity_id = unique()
    body = {
        "id": entity_id,
        "type": f"{IRI}cutter_{uuid.uuid4().hex[:8]}",
        f"{IRI}temp": {
            "type": "Property",
            "value": 42,
            f"{IRI}limit": {"type": "Property", "value": {"@value": 99.0, "@type": DOUBLE}},
        },
    }
    assert api.post("/api/ngsi/import", json=[body]).json()[0]["result"] == "created"
    try:
        params = {"name": f"{IRI}temp", "path": f"{IRI}limit"}
        answer = api.patch(f"/api/ngsi/entities/{entity_id}/attrs", params=params, json={f"{IRI}temp": {"value": 100}})
        assert answer.status_code == 204, answer.text
        limit = api.get(f"/api/ngsi/entities/{entity_id}").json()[f"{IRI}temp"][f"{IRI}limit"]
        assert literal(limit["value"]) == 100
        assert datatype(limit["value"]) == DOUBLE
    finally:
        api.delete(f"/api/ngsi/entities/{entity_id}")
