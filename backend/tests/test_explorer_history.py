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
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ngsi.history import attribute_filter, quoted, typed_value
from app.ngsi.timeshift import rebuild
from tests.explorer_support import IRI, MACHINE, TOKEN, Broker, Rows, app_with

XSD = "http://www.w3.org/2001/XMLSchema#"
NGSI = "https://uri.etsi.org/ngsi-ld/"
T0 = "2026-11-01T00:00:00+00:00"
T1 = "2026-11-02T00:00:00+00:00"
T2 = "2026-11-03T00:00:00+00:00"
T3 = "2026-11-04T00:00:00+00:00"


def row(name, at, value, **extra):
    """A row in the platform's layout."""
    dataset = extra.get("datasetId", "@none")
    return {
        "id": extra.pop("id", f"{MACHINE}\\{name}\\{dataset}"),
        "parentId": extra.pop("parentId", None),
        "observedAt": at,
        "modifiedAt": at,
        "entityId": extra.pop("entityId", MACHINE),
        "attributeId": f"{IRI}{name}",
        "attributeType": extra.pop("attributeType", f"{NGSI}Property"),
        "datasetId": dataset,
        "nodeType": extra.pop("nodeType", "@value"),
        "value": value,
        "valueType": extra.pop("valueType", None),
        "unitCode": extra.pop("unitCode", None),
        "lang": None,
        "deleted": extra.pop("deleted", False),
        **extra,
    }


def tables():
    parent = f"{MACHINE}\\temp\\@none"
    return {
        "attributes": [
            row("temp", T0, "40", unitCode="CEL"),
            row("temp", T1, "41", unitCode="CEL", deleted=None),
            row("temp", T3, "99", unitCode="CEL"),
            row("limit", T0, "90", id="sub-limit", parentId=parent),
            row("hasFilter", T0, "urn:f:1", attributeType=f"{NGSI}Relationship", nodeType="@id"),
            row("hasFilter", T1, "urn:f:2", attributeType=f"{NGSI}Relationship", nodeType="@id"),
            row("state", T1, "ON", valueType=f"{XSD}string"),
            row("code", T1, "0042", valueType=f"{XSD}string"),
            row("gone", T0, "1"),
            row("gone", T1, None, deleted=True),
            row("many", T1, "1", datasetId="urn:d:1"),
            row("many", T1, "2", datasetId="urn:d:2"),
            row("json", T1, '{"a": 1}', attributeType=f"{NGSI}JsonProperty", nodeType="@json"),
            row("items", T1, "[1, 2]", attributeType=f"{NGSI}ListProperty", nodeType="@json"),
            row("place", T1, '{"type": "Point", "coordinates": [1, 2]}', attributeType=f"{NGSI}GeoProperty"),
            row("kind", T1, "urn:kind:a", nodeType="@id"),
            row("value", T1, "5", id="other", entityId="urn:x:other"),
        ],
        "entities": [
            {"id": MACHINE, "observedAt": T0, "type": f"{IRI}cutter", "deleted": None},
            {"id": "urn:x:other", "observedAt": T0, "type": f"{IRI}filter", "deleted": False},
            {"id": "urn:x:other", "observedAt": T2, "type": f"{IRI}filter", "deleted": True},
            {"id": "urn:x:late", "observedAt": T3, "type": f"{IRI}late", "deleted": False},
            {"id": "urn:x:sample", "observedAt": T0, "type": "https://uri.etsi.org/ngsi-ld/default-context/Machine"},
        ],
    }


@pytest.fixture
def rows():
    return Rows(tables())


@pytest.fixture
def client(rows):
    return TestClient(app_with(Broker(), rows))


def history(client, attribute, **params):
    return client.get("/api/ngsi/history", params={"entity_id": MACHINE, "attribute": attribute, **params})


def test_values_oldest_first_as_numbers_and_null_deleted_included(client):
    points = history(client, f"{IRI}temp").json()
    assert [p["value"] for p in points] == [40, 41, 99]
    assert points[0]["at"] == T0


def test_range(client):
    points = history(client, f"{IRI}temp", **{"from": T1, "to": T2}).json()
    assert [p["value"] for p in points] == [41]


def test_relationships_and_text_stay_text(client):
    assert [p["value"] for p in history(client, f"{IRI}hasFilter").json()] == ["urn:f:1", "urn:f:2"]
    assert [p["value"] for p in history(client, f"{IRI}code").json()] == ["0042"]


def test_deleted_rows_are_left_out(client):
    assert [p["value"] for p in history(client, f"{IRI}gone").json()] == [1]


def test_short_name_matches_the_end_of_an_iri(client):
    assert [p["value"] for p in history(client, "temp").json()] == [40, 41, 99]


def test_datasets_are_told_apart(client):
    points = history(client, f"{IRI}many", dataset_id="urn:d:2").json()
    assert points == [{"at": T1, "value": 2, "datasetId": "urn:d:2"}]


def test_sub_attribute_history(client):
    assert [p["value"] for p in history(client, f"{IRI}limit").json()] == [90]


def test_empty_is_an_empty_list(client):
    assert history(client, "nothing").json() == []


def test_bad_time_is_invalid_and_is_not_sent(client, rows):
    answer = history(client, "temp", **{"from": "2026-01-01&deleted=is.true"})
    assert answer.status_code == 422
    assert rows.requests == []


@pytest.mark.parametrize(
    "hostile",
    [
        'x",attributeId.like."y',
        "x),or=(deleted.is.true",
        'a"b',
        "back\\slash",
        "with,comma",
        "(paren)",
    ],
)
def test_short_name_cannot_change_the_filter(hostile):
    column, condition = attribute_filter(hostile)
    assert column == "or"
    inner = condition[1:-1]
    # Removing the three properly quoted values leaves only the structure.
    escaped = quoted(hostile)[1:-1]
    assert inner.count(escaped) == 3
    skeleton = inner.replace(escaped, "NAME")
    assert skeleton == 'attributeId.eq."NAME",attributeId.like."*/NAME",attributeId.like."*#NAME"'


def test_wildcard_in_a_short_name_is_refused(client, rows):
    assert history(client, "*").status_code == 422
    assert rows.requests == []


def test_iri_or_entity_with_filter_syntax_goes_as_one_literal_value(client, rows):
    entity = "urn:x&deleted=is.true"
    client.get("/api/ngsi/history", params={"entity_id": entity, "attribute": "urn:y,z)"})
    request = rows.requests[0]
    assert ("entityId", f"eq.{entity}") in list(request.url.params.multi_items())
    assert ("attributeId", "eq.urn:y,z)") in list(request.url.params.multi_items())
    assert [v for k, v in request.url.params.multi_items() if k == "deleted"] == ["not.is.true"]


def test_token_is_sent_to_postgrest_and_not_returned(client, rows):
    answer = history(client, "temp")
    assert rows.requests[0].headers["Authorization"] == f"Bearer {TOKEN}"
    assert TOKEN not in answer.text


def test_caller_cannot_choose_the_server(client, rows):
    client.get("/api/ngsi/attr-status", params={"entity_id": MACHINE, "pgrest_url": "http://evil.test"})
    assert rows.requests[0].url.host == "pgrest.test"


@pytest.mark.parametrize(
    ("status", "http", "kind"),
    [(401, 401, "unauthorized"), (403, 401, "unauthorized"), (500, 502, "unavailable"), (404, 502, "unavailable")],
)
def test_postgrest_failures(status, http, kind):
    client = TestClient(app_with(Broker(), Rows(status=status)))
    answer = history(client, "temp")
    assert answer.status_code == http
    assert answer.json()["error"]["kind"] == kind
    assert "PostgREST" in answer.text


def test_unreachable_postgrest_is_502_and_the_broker_routes_still_work():
    def down(request):
        raise httpx.ConnectError("http://inner-host:3000", request=request)

    client = TestClient(app_with(Broker(), down))
    answer = history(client, "temp")
    assert answer.status_code == 502
    assert "inner-host" not in answer.text
    assert client.get("/api/ngsi/types").status_code == 200


def test_rejected_filter_is_invalid_with_the_reason():
    client = TestClient(app_with(Broker(), lambda r: httpx.Response(400, json={"message": "bad column"})))
    answer = history(client, "temp")
    assert answer.status_code == 422
    assert "bad column" in answer.text


def test_status_is_latest_per_attribute(client):
    status = client.get("/api/ngsi/attr-status", params={"entity_id": MACHINE}).json()
    assert status[f"{IRI}gone"] == {"deleted": True, "observedAt": T1}
    assert status[f"{IRI}temp"] == {"deleted": False, "observedAt": T3}
    assert f"{IRI}limit" not in status


def test_status_goes_beyond_one_page():
    many = [row("a" * 3 + str(i), T0, "1") for i in range(2500)]
    client = TestClient(app_with(Broker(), Rows({"attributes": many, "entities": []})))
    assert len(client.get("/api/ngsi/attr-status", params={"entity_id": MACHINE}).json()) == 2500


@pytest.mark.parametrize(
    ("value", "value_type", "kind", "expected"),
    [
        ("12.5", None, None, 12.5),
        ("12", f"{XSD}double", None, 12),
        ("1e3", None, None, 1000.0),
        ("12", f"{XSD}string", None, "12"),
        ("true", f"{XSD}boolean", None, True),
        ("true", None, None, "true"),
        ("urn:x", None, f"{NGSI}Relationship", "urn:x"),
        ("123", None, f"{NGSI}Relationship", "123"),
        (None, None, None, None),
        ("nan", None, None, "nan"),
        ("inf", None, None, "inf"),
    ],
)
def test_typed_values(value, value_type, kind, expected):
    assert typed_value(value, value_type, kind) == expected


# Time-shift ----------------------------------------------------------------------------------


def at_types(client, at):
    return client.get("/api/ngsi/timeshift/types", params={"at": at})


def at_entities(client, at, **params):
    return client.get("/api/ngsi/timeshift/entities", params={"at": at, **params})


def test_types_at_a_moment(client):
    types = at_types(client, T1).json()
    assert types == ["Machine", f"{IRI}cutter", f"{IRI}filter"]


def test_entity_deleted_before_or_created_after_is_left_out(client):
    assert f"{IRI}filter" not in at_types(client, T3).json()
    assert f"{IRI}late" not in at_types(client, T2).json()
    assert f"{IRI}late" in at_types(client, T3).json()


def test_entity_at_a_moment_has_its_values_then(client):
    [entity] = at_entities(client, T2, id=MACHINE).json()
    temp = entity[f"{IRI}temp"]
    assert temp["value"] == 41
    assert temp["unitCode"] == "CEL"
    assert temp[f"{IRI}limit"]["value"] == 90
    assert entity[f"{IRI}hasFilter"] == {"type": "Relationship", "object": "urn:f:2", "observedAt": T1}
    assert entity[f"{IRI}state"]["value"] == "ON"
    assert entity[f"{IRI}json"]["json"] == {"a": 1}
    assert entity[f"{IRI}items"]["valueList"] == [1, 2]
    assert entity[f"{IRI}place"]["value"]["type"] == "Point"
    assert entity[f"{IRI}kind"]["value"] == {"@id": "urn:kind:a"}
    assert {i["datasetId"] for i in entity[f"{IRI}many"]} == {"urn:d:1", "urn:d:2"}


def test_attribute_deleted_before_the_moment_is_left_out_but_was_there_earlier(client):
    assert f"{IRI}gone" not in at_entities(client, T2, id=MACHINE).json()[0]
    assert at_entities(client, T0, id=MACHINE).json()[0][f"{IRI}gone"]["value"] == 1


def test_children_of_a_deleted_attribute_drop_out():
    rows_ = [
        row("temp", T1, None, deleted=True),
        row("limit", T0, "90", id="sub", parentId=f"{MACHINE}\\temp\\@none"),
    ]
    entity = rebuild(MACHINE, "T", rows_)
    assert set(entity) == {"id", "type"}


def test_default_context_names_are_compacted_as_the_broker_shows_them():
    vocab = "https://uri.etsi.org/ngsi-ld/default-context/"
    entity = rebuild("urn:s", "Machine", [{**row("x", T0, "1"), "attributeId": f"{vocab}status"}])
    assert "status" in entity


def test_query_at_a_moment(client):
    assert [e["id"] for e in at_entities(client, T2, type="Machine").json()] == ["urn:x:sample"]
    assert [e["id"] for e in at_entities(client, T1, id_pattern="^urn:x:o").json()] == ["urn:x:other"]
    assert [e["id"] for e in at_entities(client, T1, q=f"{IRI}value==5").json()] == ["urn:x:other"]
    assert [e["id"] for e in at_entities(client, T2, q=f"{IRI}temp>41").json()] == []
    assert [e["id"] for e in at_entities(client, T3, q=f"{IRI}temp>41").json()] == [MACHINE]
    assert len(at_entities(client, T2, limit=1).json()) == 1


def test_expression_uses_the_values_of_the_moment(client):
    assert at_entities(client, T2, q=f"{IRI}temp==41").json()[0]["id"] == MACHINE


def test_signal_with_many_rows_costs_few_requests():
    long = [row("temp", f"2026-10-{1 + i % 28:02d}T{i % 24:02d}:{i % 60:02d}:00+00:00", str(i)) for i in range(4000)]
    other = [row("zz", T0, "1")]
    entities = [{"id": MACHINE, "observedAt": T0, "type": "T", "deleted": False}]
    fake = Rows({"attributes": long + other, "entities": entities})
    client = TestClient(app_with(Broker(), fake))
    [entity] = at_entities(client, T3, id=MACHINE).json()
    assert f"{IRI}zz" in entity
    assert sum(r.url.path == "/attributes" for r in fake.requests) <= 3


@pytest.mark.parametrize("at", ["yesterday", "2999-01-01T00:00:00Z"])
def test_moment_must_be_a_past_timestamp(client, rows, at):
    assert at_types(client, at).status_code == 422
    assert at_entities(client, at).status_code == 422
    assert rows.requests == []


def test_timeshift_syntax_errors_and_limits(client):
    now = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    assert at_entities(client, now, q="((").status_code == 422
    assert at_entities(client, now, id_pattern="(").status_code == 422
    assert at_entities(client, now, limit=0).status_code == 422


def test_timeshift_with_postgrest_stopped_is_502():
    def down(request):
        raise httpx.ConnectError("x", request=request)

    assert at_types(TestClient(app_with(Broker(), down)), T1).status_code == 502
