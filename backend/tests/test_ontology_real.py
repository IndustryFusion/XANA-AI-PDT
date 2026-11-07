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

import asyncio
import json
import os
import uuid

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_ollama import ChatOllama

from app.api import shacl
from sample_data.loader import load_ontology
from tests.conftest import make_settings
from xana_agent.conversation import ConversationAgent, ConversationInput
from xana_agent.sources import FusekiOntologySource
from xana_agent.sources.memory import InMemoryIncidentMemory
from xana_agent.testing import FakeContextSource, FakeHistorySource, sample_entities, sample_history

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


CALLBACK = os.environ.get("TEST_FUSEKI_CALLBACK_HOST")
needs_callback = pytest.mark.skipif(not CALLBACK, reason="TEST_FUSEKI_CALLBACK_HOST not set")


class Listener:
    """Counts what reaches it: a real Fuseki calling out, if the text gets through."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.server: asyncio.AbstractServer | None = None

    async def handle(self, reader, writer) -> None:
        line = await reader.readline()
        self.paths.append(line.decode(errors="replace"))
        writer.write(b"HTTP/1.1 500 No\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        await writer.drain()
        writer.close()

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, "0.0.0.0", 0)  # noqa: S104 - reached from the container
        self.port = self.server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *exc) -> None:
        self.server.close()


def proofs(address: str) -> dict[str, str]:
    """Queries this parser once took for harmless, and Fuseki reads as a call to `address`."""
    return {
        "carriage return ends a comment": f"SELECT * WHERE {{ # x\rSERVICE <{address}/cr> {{ ?a ?b ?c }}\n}}",
        "escaped quote": (
            f'SELECT * WHERE {{ VALUES ?v {{ "x\\u0022 " }} SERVICE <{address}/uq> {{ ?a ?b ?c }} # " }}\n}}'
        ),
        "lower case": f"select * where {{ # x\rservice <{address}/lc> {{ ?a ?b ?c }}\n}}",
        "mixed case": f"SELECT * WHERE {{ # x\rSeRvIcE <{address}/mc> {{ ?a ?b ?c }}\n}}",
    }


@needs_callback
async def test_a_real_store_calls_out_for_these_queries_and_the_query_function_never_lets_it(source):
    async with Listener() as listener:
        address = f"http://{CALLBACK}:{listener.port}"
        for name, query in proofs(address).items():
            answer = await source.query(query)
            assert answer["ok"] is False and "not allowed" in answer["error"], name
        await asyncio.sleep(1)
        assert listener.paths == []
        # The same text sent past the check: a real store does call out, so this test could fail.
        await source._send(proofs(address)["carriage return ends a comment"])
        await source._send(proofs(address)["escaped quote"])
        for _ in range(50):
            if len(listener.paths) >= 2:
                break
            await asyncio.sleep(0.1)
        assert "/cr" in listener.paths[0] and "/uq" in listener.paths[1]


class StandInOllama:
    """Answers as an Ollama server does, with the actions it is given: a model writing what a test wants."""

    def __init__(self, actions: list[dict]) -> None:
        self.actions = list(actions)
        self.asked: list[str] = []

    async def handle(self, reader, writer) -> None:
        head = await reader.readuntil(b"\r\n\r\n")
        length = next(
            (int(line.split(b":")[1]) for line in head.split(b"\r\n") if line.lower().startswith(b"content-length")), 0
        )
        body = await reader.readexactly(length)
        self.asked.append(body.decode())
        content = json.dumps(self.actions.pop(0))
        line = {"model": "stand-in", "message": {"role": "assistant", "content": content}, "done": True}
        line |= {"done_reason": "stop", "created_at": "2026-01-01T00:00:00Z"}
        answer = json.dumps(line).encode() + b"\n"
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n")
        writer.write(f"Content-Length: {len(answer)}\r\n\r\n".encode() + answer)
        await writer.drain()
        writer.close()

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        self.url = f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"
        return self

    async def __aexit__(self, *exc) -> None:
        self.server.close()


@needs_callback
async def test_a_query_the_model_writes_reaches_nothing_through_the_agents_real_path(source):
    """A real Ollama client, the real agent and a real Fuseki with a listener: only the model is a stand-in."""
    async with Listener() as listener:
        address = f"http://{CALLBACK}:{listener.port}"
        written = list(proofs(address).values())
        actions = [{"tool": "ontology_query", "arguments": {"sparql": query}} for query in written]
        actions.append({"tool": "ontology_query", "arguments": {"sparql": "ASK { ?s ?p ?o }"}})
        actions.append({"tool": "set_response", "arguments": {"text": "Done."}})
        async with StandInOllama(actions) as model:
            agent = ConversationAgent(
                ChatOllama(model="stand-in", base_url=model.url),
                FakeContextSource(sample_entities()),
                FakeHistorySource(sample_history()),
                InMemoryIncidentMemory(),
                ontology=source,
                llm_timeout_s=10,
            )
            turn = ConversationInput("urn:m", "Issue", "Look it up", [], ["urn:m"])
            reply = await agent.answer(turn)
        assert reply.reply == "Done."
        assert reply.tools == ["ontology_query"] * (len(written) + 1) + ["set_response"]
        await asyncio.sleep(1)
        assert listener.paths == []
        # The model read each refusal, and the plain query's answer.
        last = model.asked[-1]
        assert last.count("not allowed") >= len(written) and '\\"ok\\": true' in last


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
