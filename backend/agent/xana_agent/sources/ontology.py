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
"""Reads the machine ontology and SHACL shapes from Fuseki. Every function only reads.

This is a formal model of the machines, not document retrieval. The shapes and knowledge are in
named graphs `<base>/shacl.ttl` and `<base>/knowledge.ttl`, and the base comes from configuration, as
the platform derives it from its external host. Errors come back as data, so a caller can go on.

SPARQL over HTTP has no parameters, so what comes from outside is placed in a query only through
`iri_ref` and `literal` here. Whatever can't be placed safely doesn't reach a query at all.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

import httpx

NS = """PREFIX sh: <http://www.w3.org/ns/shacl#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ngsi-ld: <https://uri.etsi.org/ngsi-ld/>
"""
MAX_ROWS = 1000
MAX_BYTES = 5 * 1024 * 1024
SERVICE = "The ontology service"

_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:")
# What SPARQL's grammar excludes from `<...>`, and spaces and control characters.
_NOT_IN_IRI = re.compile(r'[\x00-\x20<>"{}|\\^`\x7f-\x9f]')
_NOISE = re.compile(
    r'"""(?:[^"\\]|\\.|"(?!""))*"""'
    r"|'''(?:[^'\\]|\\.|'(?!''))*'''"
    r'|"(?:[^"\\\n]|\\.)*"'
    r"|'(?:[^'\\\n]|\\.)*'"
    r'|<[^<>"{}|\\^`\s]*>'
    r"|#[^\n]*",
    re.DOTALL,
)
_REFUSED_WORDS = re.compile(
    r"(?<![:\w?$])(SERVICE|INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|ADD|MOVE|COPY|WITH)(?![:\w])", re.IGNORECASE
)
_PROLOGUE = re.compile(r"\s*(PREFIX\s+[^\s:]*:\s*|BASE\s*)", re.IGNORECASE)
_READ_FORMS = re.compile(r"\s*(SELECT|ASK|CONSTRUCT|DESCRIBE)(?![:\w])", re.IGNORECASE)
_LITERAL_ESCAPES = {
    "\\": "\\\\",
    '"': '\\"',
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\b": "\\b",
    "\f": "\\f",
}


class UnsafeTerm(ValueError):
    """This value can't be placed in a query."""


def iri_ref(value: str) -> str:
    """`<value>`, or `UnsafeTerm` if the value could end the IRI or isn't one."""
    if not _SCHEME.match(value) or _NOT_IN_IRI.search(value):
        raise UnsafeTerm("not a usable IRI")
    return f"<{value}>"


def literal(value: str) -> str:
    """`"value"`, with everything that could end the string escaped.

    A `\\u` escape is decoded before SPARQL's grammar applies, so it could make a quote that no
    escaping here can catch. Such a value isn't placed at all.
    """
    if re.search(r"[\x00-\x08\x0b\x0e-\x1f\x7f]|\\[uU]", value):
        raise UnsafeTerm("control characters or code point escapes")
    return '"' + "".join(_LITERAL_ESCAPES.get(c, c) for c in value) + '"'


def is_iri(value: str) -> bool:
    return bool(_SCHEME.match(value)) and not _NOT_IN_IRI.search(value)


def names(variable: str, value: str) -> str:
    """A condition: `variable` is this IRI, or an IRI ending in this short name."""
    if _SCHEME.match(value):
        return f"{variable} = {iri_ref(value)}"
    return f'REPLACE(STR({variable}), "^.*[/#]", "") = {literal(value)}'


def refusal_of(query: str) -> str | None:
    """Why a query must not be sent, or None. Strings, IRIs and comments can't hide a keyword or trip this."""
    stripped = _NOISE.sub(" ", query)
    word = _REFUSED_WORDS.search(stripped)
    if word:
        kind = "calls another service" if word.group(1).upper() == "SERVICE" else "would change data"
        return f"The query is not allowed: it {kind} ({word.group(1).upper()})."
    position = 0
    while prologue := _PROLOGUE.match(stripped, position):
        position = prologue.end()
    if not _READ_FORMS.match(stripped, position):
        return "The query is not allowed: only SELECT, ASK, CONSTRUCT and DESCRIBE are."
    return None


class FusekiOntologySource:
    def __init__(
        self,
        url: str,
        dataset: str = "iff",
        graph_base: str | None = None,
        token: Callable[[], str | None] | None = None,
        timeout_s: float = 5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._endpoint = f"{url.rstrip('/')}/{dataset}/sparql"
        base = (graph_base or f"{url.rstrip('/')}/{dataset}").rstrip("/")
        self._shacl = iri_ref(f"{base}/shacl.ttl")
        self._knowledge = iri_ref(f"{base}/knowledge.ttl")
        self._token = token
        self._timeout = timeout_s
        self._transport = transport

    # The three read functions --------------------------------------------------------------

    async def query(self, sparql: str) -> dict[str, Any]:
        """A read-only SPARQL query. `{"ok": True, "rows", "truncated"}` or `{"ok": False, "error"}`."""
        problem = refusal_of(sparql)
        if problem:
            return {"ok": False, "error": problem}
        return await self._send(sparql)

    async def shapes(self, entity_type: str) -> dict[str, Any]:
        """What the SHACL shapes say about an entity type, as `node`, `p`, `o` rows."""
        parents = await self._parents(entity_type)
        if not parents["ok"]:
            return parents
        try:
            condition = self._target_condition(entity_type, parents["iris"])
        except UnsafeTerm:
            return {"ok": True, "rows": [], "truncated": False}
        return await self._send(
            f"""{NS}SELECT DISTINCT ?shape ?node ?p ?o WHERE {{
  GRAPH {self._shacl} {{
    ?shape sh:targetClass ?target ; (<>|!<>)* ?node .
    ?node ?p ?o .
    FILTER({condition})
  }}
}}"""
        )

    async def knowledge(self, entity_type: str) -> dict[str, Any]:
        """The entity type's class, its parents and its individuals, as `s`, `p`, `o` rows."""
        parents = await self._parents(entity_type)
        if not parents["ok"]:
            return parents
        try:
            own = self._target_condition(entity_type, parents["iris"], variable="?s")
            typed = self._target_condition(entity_type, parents["iris"], variable="?class")
        except UnsafeTerm:
            return {"ok": True, "rows": [], "truncated": False}
        return await self._send(
            f"""{NS}SELECT DISTINCT ?s ?p ?o WHERE {{
  GRAPH {self._knowledge} {{
    ?s ?p ?o .
    FILTER({own} || EXISTS {{ ?s a ?class . FILTER({typed}) }})
  }}
}}"""
        )

    # Hints ---------------------------------------------------------------------------------

    async def hints(self, entity_type: str, attribute: str) -> dict[str, Any]:
        """Allowed values and ranges. `hint_type` is `none` when nothing is known or Fuseki can't say."""
        parents = await self._parents(entity_type)
        if not parents["ok"]:
            return no_hints(parents["error"])
        try:
            target = self._target_condition(entity_type, parents["iris"])
            path = names("?attribute", attribute)
        except UnsafeTerm:
            return no_hints()
        found = await self._send(
            f"""{NS}SELECT DISTINCT ?allowed ?class ?datatype ?minIn ?minEx ?maxIn ?maxEx WHERE {{
  GRAPH {self._shacl} {{
    ?shape sh:targetClass ?target ; sh:property ?outer .
    ?outer sh:path ?attribute ; sh:property? ?rule .
    ?rule sh:path ?ruled .
    FILTER({target} && {path})
    FILTER(?rule = ?outer || ?ruled IN (ngsi-ld:hasValue, ngsi-ld:hasObject, ngsi-ld:hasValueList))
    OPTIONAL {{ ?rule sh:in/rdf:rest*/rdf:first ?allowed }}
    OPTIONAL {{ ?rule sh:class ?class }}
    OPTIONAL {{ ?rule sh:datatype ?datatype }}
    OPTIONAL {{ ?rule sh:minInclusive ?minIn }}
    OPTIONAL {{ ?rule sh:minExclusive ?minEx }}
    OPTIONAL {{ ?rule sh:maxInclusive ?maxIn }}
    OPTIONAL {{ ?rule sh:maxExclusive ?maxEx }}
  }}
}}"""
        )
        if not found["ok"]:
            return no_hints(found["error"])
        return await self._combine(found["rows"])

    async def _combine(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        values = {row["allowed"] for row in rows if row.get("allowed") is not None}
        classes = {row["class"] for row in rows if row.get("class")}
        datatypes = sorted({row["datatype"] for row in rows if row.get("datatype")})
        if classes:
            individuals = await self._individuals(classes)
            if not individuals["ok"]:
                return no_hints(individuals["error"])
            values |= {row["individual"] for row in individuals["rows"]}
        hint = {**no_hints(), "datatype": datatypes[0] if datatypes else None}
        hint.update(_limits(rows))
        if values:
            return {**hint, "hint_type": "enum", "values": sorted(str(v) for v in values)}
        if hint["minimum"] is not None or hint["maximum"] is not None:
            return {**hint, "hint_type": "range"}
        return {**hint, "hint_type": "datatype"} if datatypes else hint

    async def _individuals(self, classes: set[str]) -> dict[str, Any]:
        safe = [iri_ref(c) for c in sorted(classes) if is_iri(c)]
        if not safe:
            return {"ok": True, "rows": []}
        return await self._send(
            f"""{NS}SELECT DISTINCT ?individual WHERE {{
  GRAPH {self._knowledge} {{
    VALUES ?class {{ {" ".join(safe)} }}
    ?individual a ?class .
  }}
}}"""
        )

    # Shared --------------------------------------------------------------------------------

    def _target_condition(self, entity_type: str, parents: list[str], variable: str = "?target") -> str:
        condition = names(variable, entity_type)
        safe = [iri_ref(parent) for parent in parents if is_iri(parent)]
        return f"({condition} || {variable} IN ({', '.join(safe)}))" if safe else f"({condition})"

    async def _parents(self, entity_type: str) -> dict[str, Any]:
        try:
            condition = names("?class", entity_type)
        except UnsafeTerm:
            return {"ok": True, "iris": []}
        found = await self._send(
            f"""{NS}SELECT DISTINCT ?parent WHERE {{
  GRAPH {self._knowledge} {{
    ?class rdfs:subClassOf+ ?parent .
    FILTER({condition})
  }}
}}"""
        )
        if not found["ok"]:
            return found
        return {"ok": True, "iris": [row["parent"] for row in found["rows"]]}

    async def _send(self, sparql: str) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/sparql-query",
            "Accept": "application/sparql-results+json, application/n-triples;q=0.5",
        }
        if self._token and (token := self._token()):
            headers["Authorization"] = f"Bearer {token}"
        received = bytearray()
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                async with client.stream("POST", self._endpoint, content=sparql.encode(), headers=headers) as response:
                    if response.status_code >= 400:
                        return _failure(response.status_code)
                    async for chunk in response.aiter_bytes():
                        received += chunk
                        if len(received) > MAX_BYTES:
                            return {"ok": False, "error": f"{SERVICE} answered more than {MAX_BYTES} bytes."}
                    kind = response.headers.get("content-type", "")
        except httpx.HTTPError as error:
            return {"ok": False, "error": f"{SERVICE} cannot be reached ({type(error).__name__})."}
        return _parsed(bytes(received), kind)


def no_hints(detail: str | None = None) -> dict[str, Any]:
    return {
        "hint_type": "none",
        "values": [],
        "minimum": None,
        "maximum": None,
        "minimum_exclusive": False,
        "maximum_exclusive": False,
        "datatype": None,
        "detail": detail,
    }


def _limits(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The narrowest limits of all matching shapes."""
    low: tuple[float, bool] | None = None
    high: tuple[float, bool] | None = None
    for row in rows:
        for key, exclusive in (("minIn", False), ("minEx", True)):
            number = _number(row.get(key))
            if number is not None and (low is None or (number, exclusive) > low):
                low = (number, exclusive)
        for key, exclusive in (("maxIn", False), ("maxEx", True)):
            number = _number(row.get(key))
            if number is not None and (high is None or number < high[0] or (number == high[0] and exclusive)):
                high = (number, exclusive)
    return {
        "minimum": low[0] if low else None,
        "minimum_exclusive": low[1] if low else False,
        "maximum": high[0] if high else None,
        "maximum_exclusive": high[1] if high else False,
    }


def _number(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def _failure(status: int) -> dict[str, Any]:
    if status in (401, 403):
        return {"ok": False, "error": f"{SERVICE} refused the request (HTTP {status}); check the operator's roles."}
    if status == 400:
        return {"ok": False, "error": f"{SERVICE} could not parse the query."}
    return {"ok": False, "error": f"{SERVICE} answered HTTP {status}."}


def _parsed(body: bytes, content_type: str) -> dict[str, Any]:
    if "json" not in content_type:
        text = body.decode("utf-8", errors="replace")
        lines = text.splitlines()
        return {"ok": True, "rows": lines[:MAX_ROWS], "truncated": len(lines) > MAX_ROWS}
    try:
        answer = json.loads(body)
    except ValueError:
        return {"ok": False, "error": f"{SERVICE} sent an answer that can't be read."}
    if "boolean" in answer:
        return {"ok": True, "boolean": answer["boolean"], "rows": [], "truncated": False}
    bindings = answer.get("results", {}).get("bindings", [])
    rows = [{name: cell.get("value") for name, cell in row.items()} for row in bindings[:MAX_ROWS]]
    return {"ok": True, "rows": rows, "truncated": len(bindings) > MAX_ROWS}
