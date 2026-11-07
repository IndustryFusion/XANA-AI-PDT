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
"""Hints and read functions against a real Fuseki (TEST_FUSEKI_URL), loaded under their own graph base."""

import os
import uuid

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import shacl
from sample_data.loader import load_ontology
from tests.conftest import make_settings
from xana_agent.sources import FusekiOntologySource

pytestmark = [
    pytest.mark.services,
    pytest.mark.skipif(not os.environ.get("TEST_FUSEKI_URL"), reason="TEST_FUSEKI_URL not set"),
]
URL = os.environ.get("TEST_FUSEKI_URL", "")
VOCAB = "https://uri.etsi.org/ngsi-ld/default-context/"


@pytest.fixture(scope="module")
def base():
    """A graph base other than the default, removed afterwards."""
    chosen = f"http://fuseki.example/{uuid.uuid4().hex[:8]}"
    load_ontology(make_settings(fuseki_url=URL, fuseki_graph_base=chosen), wait_s=30)
    yield chosen
    for name in ("shacl.ttl", "knowledge.ttl"):
        httpx.delete(f"{URL}/iff/data", params={"graph": f"{chosen}/{name}"})


@pytest.fixture
def source(base):
    return FusekiOntologySource(URL, graph_base=base)


async def test_allowed_values_by_iri_and_by_short_name_through_a_parent_class(source):
    for entity_type, attribute in ((f"{VOCAB}Machine", f"{VOCAB}status"), ("Machine", "status")):
        hint = await source.hints(entity_type, attribute)
        assert hint["hint_type"] == "enum"
        assert "maintenance" in hint["values"]


async def test_values_of_a_class(source):
    hint = await source.hints("Machine", "operatingMode")
    assert hint["hint_type"] == "enum"
    assert "https://example.org/operating-mode/manual" in hint["values"]


async def test_range(source):
    hint = await source.hints("Sensor", "value")
    assert hint["hint_type"] == "range"
    assert (hint["minimum"], hint["minimum_exclusive"]) == (-40, False)
    assert (hint["maximum"], hint["maximum_exclusive"]) == (1000, True)


async def test_datatype_and_none(source):
    assert (await source.hints("Machine", "machineType"))["hint_type"] == "datatype"
    assert (await source.hints("Machine", "nothing"))["hint_type"] == "none"
    assert (await source.hints("Unknown", "status"))["hint_type"] == "none"


async def test_the_default_base_does_not_find_graphs_loaded_elsewhere(base):
    hint = await FusekiOntologySource(URL).hints("Sensor", "value")
    assert hint["hint_type"] in ("none", "range")
    other = await FusekiOntologySource(URL, graph_base="http://other.example/x").hints("Sensor", "value")
    assert other["hint_type"] == "none"
    assert "FUSEKI_GRAPH_BASE" in other["detail"]


async def test_shapes_and_knowledge(source):
    shapes = await source.shapes("Machine")
    assert shapes["ok"]
    assert any(row["o"].endswith("/status") for row in shapes["rows"])  # from the parent class's shape
    knowledge = await source.knowledge("OperatingMode")
    assert knowledge["ok"]
    assert any(row["s"].endswith("/manual") for row in knowledge["rows"])
    assert any(row["s"].endswith("/OperatingMode") for row in knowledge["rows"])


@pytest.mark.parametrize(
    "hostile",
    [
        'Machine" || "1"="1',
        'x")) || true || (("',
        'x") } } SELECT * WHERE { ?s ?p ?o } #',
        "x\n} } SELECT * WHERE { GRAPH ?g { ?s ?p ?o } } #",
        '\\" || true #',
        "' || true #",
        "urn:x> . ?a ?b ?c . <urn:y",
        VOCAB + "Machine> || true) } } #",
        'x\\u0022) || true || ("',
    ],
)
async def test_hostile_input_finds_nothing_in_a_real_store(source, hostile):
    assert (await source.hints(hostile, "status"))["hint_type"] == "none"
    assert (await source.hints("Machine", hostile))["hint_type"] == "none"
    assert (await source.hints("Machine", hostile))["detail"] is None
    assert (await source.shapes(hostile))["rows"] == []
    assert (await source.knowledge(hostile))["rows"] == []


async def test_a_service_hidden_from_a_lexer_is_refused_and_a_real_store_is_not_asked(source):
    """Fuseki would call this address; the listener on it would see the request."""
    for query in (
        "PREFIX ex: <http://ex/> SELECT * WHERE { VALUES ?v { ex:b\\# } SERVICE <http://127.0.0.1:9/x> { ?s ?p ?o } }",
        "SELECT * WHERE { SE\\u0052VICE <http://127.0.0.1:9/x> { ?s ?p ?o } }",
    ):
        answer = await source.query(query)
        assert answer["ok"] is False
        assert "not allowed" in answer["error"]


async def test_the_queries_the_platforms_notes_use_are_not_refused(source, base):
    for query in (
        f"SELECT ?shape WHERE {{ GRAPH <{base}/shacl.ttl> {{ ?shape a <http://www.w3.org/ns/shacl#NodeShape> }} }} "
        "LIMIT 10",
        f"SELECT ?cls WHERE {{ GRAPH <{base}/knowledge.ttl> {{ ?cls a <http://www.w3.org/2002/07/owl#Class> }} }}",
        f"CONSTRUCT {{ ?s ?p ?o }} WHERE {{ GRAPH <{base}/knowledge.ttl> {{ ?s ?p ?o }} }}",
        f"ASK {{ GRAPH <{base}/shacl.ttl> {{ ?s ?p ?o }} }}",
    ):
        assert (await source.query(query))["ok"] is True, query


async def test_a_plain_query_reads_and_refused_ones_change_nothing(source, base):
    count = f"SELECT (COUNT(*) AS ?n) WHERE {{ GRAPH <{base}/knowledge.ttl> {{ ?s ?p ?o }} }}"
    before = await source.query(count)
    assert before["ok"]
    for bad in (f"DROP GRAPH <{base}/knowledge.ttl>", f"CLEAR GRAPH <{base}/knowledge.ttl>"):
        assert (await source.query(bad))["ok"] is False
    assert await source.query(count) == before
    assert (await source.query(f"SELECT * WHERE {{ SERVICE <{URL}/iff/sparql> {{ ?s ?p ?o }} }}"))["ok"] is False
    assert (await source.query("SELECT nonsense {{{"))["ok"] is False


def _client(source_):
    app = FastAPI()
    app.state.ontology = source_
    app.include_router(shacl.router)
    return TestClient(app)


def test_route_on_a_real_store_and_with_nothing_behind_it(source):
    params = {"entity_type": "Machine", "attribute": "status"}
    assert _client(source).get("/api/shacl/hints", params=params).json()["hint_type"] == "enum"
    stopped = _client(FusekiOntologySource("http://127.0.0.1:1"))
    answer = stopped.get("/api/shacl/hints", params=params)
    assert answer.status_code == 200
    assert answer.json()["hint_type"] == "none"
    assert "cannot be reached" in answer.json()["detail"]
