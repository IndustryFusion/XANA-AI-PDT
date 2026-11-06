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
"""What goes into a query, and how answers become hints. No network: answers come from a stub."""

import httpx
import pytest
from pydantic import ValidationError
from rdflib.plugins.sparql.parser import parseQuery
from rdflib.plugins.sparql.processor import translateQuery

from app.config import Settings
from xana_agent.sources.ontology import FusekiOntologySource, UnsafeTerm, iri_ref, literal, names, refusal_of

BASE = "https://uri.etsi.org/ngsi-ld/default-context/"
TYPE = f"{BASE}Machine"
ATTRIBUTE = f"{BASE}status"

HOSTILE = [
    'x"',
    'x" . } } #',
    'x") } } SELECT * WHERE { ?s ?p ?o } #',
    'x")) UNION { ?a ?b ?c } #',
    "x> . ?a ?b ?c . <y",
    "urn:x> . ?a ?b ?c . <urn:y",
    "urn:x>) } } DROP ALL #",
    "urn:x\n} DROP ALL",
    "new\nline",
    "tab\there",
    "back\\slash",
    'back\\" . ?a ?b ?c #',
    "{ ?s ?p ?o }",
    "# comment",
    "'single' quotes",
    "'''triple'''",
    '"""triple"""',
    "$var ?var",
    "ünïcode",
    "x\\u0022 . ?a ?b ?c",
    "x\\U00000022 . ?a ?b ?c",
]


class Fuseki:
    """Answers each query from `answer(query)`; records them."""

    def __init__(self, answer=None) -> None:
        self.answer = answer or (lambda query: [])
        self.queries: list[str] = []
        self.headers: list[httpx.Headers] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        query = request.content.decode()
        self.queries.append(query)
        self.headers.append(request.headers)
        rows = self.answer(query)
        bindings = [{k: {"type": "literal", "value": v} for k, v in row.items()} for row in rows]
        return httpx.Response(
            200,
            json={"head": {"vars": []}, "results": {"bindings": bindings}},
            headers={"Content-Type": "application/sparql-results+json"},
        )


def source(fuseki, **kwargs):
    return FusekiOntologySource("http://fuseki.test:3030", transport=httpx.MockTransport(fuseki), **kwargs)


def structure(query: str) -> str:
    """The query's algebra with its strings and IRIs taken out: what it does, whatever it names."""
    algebra = translateQuery(parseQuery(query)).algebra
    text = repr(algebra)
    return text


def shape_of(query: str, value_iri: str | None, value_literal: str | None) -> str:
    """The query's text with the placed value taken out, then checked to parse."""
    parseQuery(query)
    out = query
    if value_literal:
        out = out.replace(value_literal, '"NAME"')
    if value_iri:
        out = out.replace(value_iri, "<urn:NAME>")
    return out


@pytest.mark.parametrize("value", HOSTILE)
def test_literal_stays_one_string(value):
    if "\\u" in value or "\\U" in value:
        with pytest.raises(UnsafeTerm):
            literal(value)
        return
    placed = literal(value)
    query = f"SELECT ?s WHERE {{ ?s ?p ?o . FILTER(STR(?o) = {placed}) }}"
    parsed = parseQuery(query)
    algebra = translateQuery(parsed).algebra
    # The filter's right side is one literal that holds exactly the value.
    strings = _literals(algebra)
    assert value in strings
    assert _variables(query, placed) == {"s", "p", "o"}


def _literals(node, found=None):
    from rdflib import Literal

    found = set() if found is None else found
    if isinstance(node, Literal):
        found.add(str(node))
    elif isinstance(node, dict):
        for item in node.values():
            _literals(item, found)
    elif isinstance(node, list | tuple | set):
        for item in node:
            _literals(item, found)
    return found


def _variables(query: str, placed: str) -> set[str]:
    from rdflib.plugins.sparql.processor import translateQuery as translate

    return {str(v) for v in translate(parseQuery(query)).algebra["_vars"]}


@pytest.mark.parametrize(
    "value", ["urn:x> . ?a ?b ?c . <urn:y", 'urn:a"b', "urn:a b", "urn:a{b", "urn:a\nb", "urn:a\\b", "noscheme"]
)
def test_iri_ref_refuses_what_could_end_it(value):
    with pytest.raises(UnsafeTerm):
        iri_ref(value)


@pytest.mark.parametrize("value", ["bad\x00", "bad\x1b", "bad\x7f", "a\\u0022", "a\\U00000022"])
def test_literal_refuses_control_characters(value):
    with pytest.raises(UnsafeTerm):
        literal(value)


async def _hint_queries(entity_type, attribute):
    fuseki = Fuseki()
    await source(fuseki).hints(entity_type, attribute)
    return fuseki.queries


@pytest.mark.parametrize("hostile", HOSTILE)
async def test_hostile_entity_type_leaves_every_query_with_the_same_structure(hostile):
    harmless = await _hint_queries("Harmless", "status")
    sent = await _hint_queries(hostile, "status")
    if not sent:
        return  # refused before any query, which is also safe
    assert len(sent) == len(harmless)
    for query, plain in zip(sent, harmless, strict=True):
        assert shape_of(query, None, literal(hostile)) == shape_of(plain, None, literal("Harmless")).replace(
            '"NAME"', '"NAME"'
        )
        parseQuery(query)


@pytest.mark.parametrize("hostile", HOSTILE)
async def test_hostile_attribute_leaves_every_query_with_the_same_structure(hostile):
    harmless = await _hint_queries("Machine", "harmless")
    sent = await _hint_queries("Machine", hostile)
    if not sent or len(sent) == 1:
        # Only the lookup of parent classes was sent: the attribute could not be placed.
        assert all(hostile not in query for query in sent)
        return
    assert shape_of(sent[1], None, literal(hostile)) == shape_of(harmless[1], None, literal("harmless"))
    parseQuery(sent[1])


@pytest.mark.parametrize("hostile", ["urn:x> . ?a ?b ?c . <urn:y", "urn:x>) } } DROP ALL #", "urn:x\n} DROP ALL"])
async def test_iri_shaped_hostile_input_reaches_no_query(hostile):
    assert await _hint_queries(hostile, "status") == []
    fuseki = Fuseki()
    assert (await source(fuseki).shapes(hostile))["rows"] == []
    assert (await source(fuseki).knowledge(hostile))["rows"] == []
    assert fuseki.queries == []


@pytest.mark.parametrize("hostile", HOSTILE)
async def test_shapes_and_knowledge_queries_parse_and_hold_one_value(hostile):
    fuseki = Fuseki()
    await source(fuseki).shapes(hostile)
    await source(fuseki).knowledge(hostile)
    for query in fuseki.queries:
        parseQuery(query)
        assert "DROP" not in _without_strings(query)


def _without_strings(query: str) -> str:
    return query.replace(literal("urn:x\n} DROP ALL"), "")


def test_names_uses_equality_for_iris_and_local_part_for_short_names():
    assert names("?x", TYPE) == f"?x = <{TYPE}>"
    assert names("?x", "Machine") == 'REPLACE(STR(?x), "^.*[/#]", "") = "Machine"'


@pytest.mark.parametrize(
    "query",
    [
        "INSERT DATA { <a:a> <a:b> <a:c> }",
        "DELETE WHERE { ?s ?p ?o }",
        "delete where { ?s ?p ?o }",
        "DROP ALL",
        "CLEAR DEFAULT",
        "LOAD <http://x/y>",
        "CREATE GRAPH <a:b>",
        "WITH <a:b> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }",
        "SELECT * WHERE { SERVICE <http://169.254.169.254/> { ?s ?p ?o } }",
        "select * where { service <http://internal/> { ?s ?p ?o } }",
        "SELECT * WHERE { SERVICE\n# comment\n<http://internal/> { ?s ?p ?o } }",
        "PREFIX a: <urn:a> SERVICE",
        "# only a comment",
        "",
    ],
)
async def test_query_refuses_what_is_not_a_plain_read_with_nothing_sent(query):
    fuseki = Fuseki()
    answer = await source(fuseki).query(query)
    assert answer["ok"] is False
    assert fuseki.queries == []


@pytest.mark.parametrize(
    "query",
    [
        "SELECT * WHERE { ?s ?p ?o }",
        "PREFIX ex: <urn:ex:> SELECT * WHERE { ?s ex:service ?o }",
        'SELECT * WHERE { ?s ?p "please DELETE this SERVICE" }',
        "# DELETE is only in a comment\nASK { ?s ?p ?o }",
        "BASE <urn:b> PREFIX a: <urn:a> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
        "DESCRIBE <urn:SERVICE>",
    ],
)
def test_query_allows_plain_reads_whatever_their_text_holds(query):
    assert refusal_of(query) is None


async def test_query_reports_truncation_at_the_limit():
    many = Fuseki(lambda q: [{"s": str(i)} for i in range(1200)])
    answer = await source(many).query("SELECT ?s WHERE { ?s ?p ?o }")
    assert answer["ok"] and answer["truncated"] and len(answer["rows"]) == 1000


@pytest.mark.parametrize(
    ("failure", "text"),
    [
        (httpx.Response(500), "HTTP 500"),
        (httpx.Response(401), "refused"),
        (httpx.Response(403), "refused"),
        (httpx.Response(400), "parse"),
        (httpx.Response(200, text="<html>", headers={"Content-Type": "application/json"}), "can't be read"),
    ],
)
async def test_every_function_gives_errors_as_data(failure, text):
    fuseki = source(lambda request: failure)
    for answer in (
        await fuseki.query("SELECT * WHERE { ?s ?p ?o }"),
        await fuseki.shapes("Machine"),
        await fuseki.knowledge("Machine"),
    ):
        assert answer["ok"] is False
        assert text in answer["error"]
    hint = await fuseki.hints("Machine", "status")
    assert hint["hint_type"] == "none"
    assert text in hint["detail"]


async def test_unreachable_service_is_data_without_its_address():
    def down(request):
        raise httpx.ConnectError("http://inner-host:3030 refused", request=request)

    fuseki = source(down)
    assert "inner-host" not in (await fuseki.query("ASK { ?s ?p ?o }"))["error"]
    hint = await fuseki.hints("Machine", "status")
    assert hint["hint_type"] == "none"
    assert "inner-host" not in hint["detail"]


async def test_token_is_sent_and_only_as_a_header():
    fuseki = Fuseki()
    await source(fuseki, token=lambda: "the-token").hints("Machine", "status")
    assert fuseki.headers[0]["Authorization"] == "Bearer the-token"
    assert all("the-token" not in q for q in fuseki.queries)


async def test_graph_names_come_from_the_base():
    fuseki = Fuseki()
    await source(fuseki, graph_base="http://fuseki.example/factory7").hints("Machine", "status")
    joined = "\n".join(fuseki.queries)
    assert "<http://fuseki.example/factory7/knowledge.ttl>" in joined
    assert "<http://fuseki.example/factory7/shacl.ttl>" in joined
    assert "fuseki.test" not in joined


async def test_default_base_is_the_address_and_dataset():
    fuseki = Fuseki()
    await source(fuseki).hints("Machine", "status")
    assert "<http://fuseki.test:3030/iff/shacl.ttl>" in fuseki.queries[0] + fuseki.queries[1]


def scripted(rows, individuals=()):
    def answer(query):
        if "subClassOf" in query:
            return []
        if "?individual" in query:
            return [{"individual": i} for i in individuals]
        return rows

    return Fuseki(answer)


async def test_enum_values_are_unique_and_sorted():
    hint = await source(scripted([{"allowed": "b"}, {"allowed": "a"}, {"allowed": "b"}])).hints("M", "s")
    assert hint["hint_type"] == "enum"
    assert hint["values"] == ["a", "b"]


async def test_class_values_are_its_individuals():
    hint = await source(scripted([{"class": "urn:c:State"}], ["urn:s:on", "urn:s:off"])).hints("M", "s")
    assert hint["hint_type"] == "enum"
    assert hint["values"] == ["urn:s:off", "urn:s:on"]


async def test_unsafe_class_from_the_store_is_not_placed_in_a_query():
    fuseki = scripted([{"class": "urn:c> . ?a ?b ?c . <urn:d"}])
    hint = await source(fuseki).hints("M", "s")
    assert hint["hint_type"] == "none"
    assert len(fuseki.queries) == 2


async def test_unsafe_parent_from_the_store_is_not_placed_in_a_query():
    def answer(query):
        return [{"parent": "urn:p> . ?a ?b ?c . <urn:q"}] if "subClassOf" in query else []

    fuseki = Fuseki(answer)
    await source(fuseki).hints("M", "s")
    assert all("?a ?b ?c" not in q for q in fuseki.queries)


@pytest.mark.parametrize(
    ("rows", "expected"),
    [
        ([{"minIn": "20.0", "maxEx": "50.0"}], (20, False, 50, True)),
        ([{"minEx": "1"}], (1, True, None, False)),
        ([{"maxIn": "9"}], (None, False, 9, False)),
        ([{"minIn": "1", "maxIn": "9"}, {"minIn": "2", "maxIn": "8"}], (2, False, 8, False)),
        ([{"maxIn": "8"}, {"maxEx": "8"}], (None, False, 8, True)),
        ([{"minIn": "8"}, {"minEx": "8"}], (8, True, None, False)),
    ],
)
async def test_ranges_take_the_narrowest_limits(rows, expected):
    hint = await source(scripted(rows)).hints("M", "s")
    assert hint["hint_type"] == "range"
    assert (hint["minimum"], hint["minimum_exclusive"], hint["maximum"], hint["maximum_exclusive"]) == expected


async def test_datatype_only_and_nothing():
    assert (await source(scripted([{"datatype": "xsd:string"}])).hints("M", "s"))["hint_type"] == "datatype"
    nothing = await source(scripted([])).hints("M", "s")
    assert nothing["hint_type"] == "none"
    assert nothing["detail"] is None


def test_config_refuses_an_unsafe_graph_base():
    for bad in ["http://x> . ?a ?b ?c", "not an iri", 'http://x"y']:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, fuseki_graph_base=bad)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, fuseki_dataset="a/../b")
    assert Settings(_env_file=None, fuseki_url="fuseki:3030").fuseki_url == "http://fuseki:3030"
