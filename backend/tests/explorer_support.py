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
"""Answers of a context broker and PostgREST, recorded in form from the real services."""

from __future__ import annotations

import json
from urllib.parse import parse_qsl, unquote

import httpx
from fastapi import FastAPI

from app.api import errors, ngsi
from app.ngsi.broker import ContextBroker
from app.ngsi.history import AttributeHistory
from tests.conftest import make_settings

IRI = "https://industry-fusion.com/types/v0.9/"
MACHINE = "urn:x:cutter:1"
TOKEN = "header.secret-operator-token.signature"


def cutter() -> dict:
    return {
        "id": MACHINE,
        "type": f"{IRI}cutter",
        f"{IRI}temp": {
            "type": "Property",
            "value": 42,
            "unitCode": "CEL",
            f"{IRI}limit": {"type": "Property", "value": 99},
            f"{IRI}low": {"type": "Property", "value": 1},
        },
        f"{IRI}state": {"type": "Property", "value": "ON"},
        f"{IRI}many": [
            {"type": "Property", "value": 1, "datasetId": "urn:d:1"},
            {"type": "Property", "value": 2, "datasetId": "urn:d:2"},
        ],
    }


class Broker:
    """A fake broker that behaves as the real one was measured to, and records requests."""

    def __init__(self) -> None:
        self.entities: dict[str, dict] = {MACHINE: cutter()}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path.removeprefix("/ngsi-ld/v1")
        params = dict(request.url.params)
        if path == "/types":
            types = sorted({e["type"] for e in self.entities.values()})
            return httpx.Response(200, json={"typeList": types[0] if len(types) == 1 else types})
        if path == "/attributes":
            names = {k for e in self.entities.values() for k in e if k not in ("id", "type")}
            return httpx.Response(200, json={"attributeList": sorted(names)})
        if path == "/entities" and request.method == "GET":
            return self._query(params)
        if path == "/entityOperations/upsert":
            return self._upsert(request)
        if path == "/entityOperations/delete":
            ids = json.loads(request.content)
            for entity_id in ids:
                self.entities.pop(entity_id, None)
            return httpx.Response(204)
        if path.startswith("/entities/"):
            return self._entity(request, path)
        return httpx.Response(404)

    def _query(self, params: dict) -> httpx.Response:
        found = list(self.entities.values())
        if params.get("type") not in (None, "*"):
            found = [e for e in found if e["type"] == params["type"]]
        if "id" in params:
            found = [e for e in found if e["id"] in params["id"].split(",")]
        if "q" in params and "((" in params["q"]:
            return httpx.Response(500, json={"title": "Internal error"})
        total = len(found)
        offset = int(params.get("offset", 0))
        limit = int(params.get("limit", 20))
        reported = 0 if limit == 0 else total
        return httpx.Response(200, json=found[offset : offset + limit], headers={"NGSILD-Results-Count": str(reported)})

    def _upsert(self, request: httpx.Request) -> httpx.Response:
        created, errors_ = [], []
        success = []
        for entity in json.loads(request.content):
            if "@context" in entity and request.headers["content-type"] != "application/ld+json":
                errors_.append({"entityId": entity["id"], "error": {"detail": "@context entry in body is not allowed"}})
            elif entity["id"].endswith("reject"):
                errors_.append({"entityId": entity["id"], "error": {"detail": "rejected by broker"}})
            else:
                success.append(entity["id"])
                if entity["id"] not in self.entities:
                    created.append(entity["id"])
                    self.entities[entity["id"]] = dict(entity)
                else:
                    self.entities[entity["id"]].update(entity)
        if errors_:
            return httpx.Response(207, json={"success": success, "errors": errors_})
        return httpx.Response(201, json=created) if created else httpx.Response(204)

    def _entity(self, request: httpx.Request, path: str) -> httpx.Response:
        raw = request.url.raw_path.decode().split("?")[0].removeprefix("/ngsi-ld/v1/entities/")
        parts = raw.split("/")
        entity = self.entities.get(parts[0])
        if entity is None:
            return httpx.Response(404, json={"title": "Resource not found.", "detail": "Resource not found."})
        if len(parts) == 1:
            if request.method == "GET":
                return httpx.Response(200, json=entity)
            if request.method == "DELETE":
                del self.entities[parts[0]]
                return httpx.Response(204)
            if request.method == "PATCH":
                for name, fragment in json.loads(request.content).items():
                    if "type" not in fragment:
                        return httpx.Response(400, json={"detail": f"The key {name} is an invalid entry."})
                    entity.setdefault(name, {}).update(fragment)
                return httpx.Response(204)
        if parts[1:] == ["attrs"] and request.method == "POST":
            for name, attribute in json.loads(request.content).items():
                if isinstance(entity.get(name), list) and isinstance(attribute, dict):
                    entity[name] = [
                        attribute if i.get("datasetId") == attribute.get("datasetId") else i for i in entity[name]
                    ]
                elif params_no_overwrite(request) and name in entity:
                    continue
                else:
                    entity[name] = attribute
            return httpx.Response(204)
        if len(parts) == 3 and request.method == "DELETE":
            name = unquote(parts[2])
            if isinstance(entity.get(name), list) and "deleteAll" not in request.url.params:
                return httpx.Response(404, json={"detail": "not found"})
            entity.pop(name, None)
            return httpx.Response(204)
        return httpx.Response(405)


def params_no_overwrite(request: httpx.Request) -> bool:
    return request.url.params.get("options") == "noOverwrite"


class Rows:
    """A fake PostgREST over rows, evaluating the filters the backend uses."""

    def __init__(self, tables: dict[str, list[dict]] | None = None, status: int | None = None) -> None:
        self.tables = tables or {"attributes": [], "entities": []}
        self.status = status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status:
            return httpx.Response(self.status, json={"message": "refused"})
        rows = list(self.tables[request.url.path.strip("/")])
        pairs = parse_qsl(request.url.query.decode(), keep_blank_values=True)
        limit, offset, order = 10**9, 0, None
        for key, value in pairs:
            if key == "limit":
                limit = int(value)
            elif key == "offset":
                offset = int(value)
            elif key == "order":
                order = value
            elif key == "or":
                rows = [r for r in rows if _or(r, value)]
            elif key != "select":
                rows = [r for r in rows if _test(r.get(key), value)]
        for part in reversed((order or "").split(",") if order else []):
            column, _, direction = part.partition(".")
            rows.sort(key=lambda r: r.get(column) or "", reverse=direction == "desc")
        return httpx.Response(200, json=rows[offset : offset + limit])


def _or(row: dict, value: str) -> bool:
    # Only what `attribute_filter` writes; anything unquoted would fail the assert.
    assert value.startswith("(") and value.endswith(")")
    results = []
    inner = value[1:-1]
    position = 0
    while position < len(inner):
        head, _, _rest = inner[position:].partition('"')
        column, op, _ = head.split(".")
        position += len(head) + 1
        out = []
        while inner[position] != '"':
            if inner[position] == "\\":
                position += 1
            out.append(inner[position])
            position += 1
        position += 2  # the closing quote and the comma
        text = "".join(out)
        actual = row.get(column) or ""
        results.append(actual == text if op == "eq" else actual.endswith(text.removeprefix("*")))
    return any(results)


def _test(actual: object, condition: str) -> bool:
    if condition == "not.is.true":
        return actual is not True
    if condition == "is.null":
        return actual is None
    op, _, operand = condition.partition(".")
    if op == "eq":
        return actual == operand
    text = str(actual or "")
    return {"lte": text <= operand, "gte": text >= operand, "gt": text > operand}[op]


def app_with(broker=None, rows=None, token=lambda: TOKEN, **settings) -> FastAPI:
    app = FastAPI()
    values = {"ngsi_url": "http://broker.test:9090", "pgrest_url": "http://pgrest.test:3000", **settings}
    configured = make_settings(**values)
    app.state.broker = ContextBroker(configured, token, transport=httpx.MockTransport(broker or Broker()))
    app.state.attribute_history = AttributeHistory(configured, token, transport=httpx.MockTransport(rows or Rows()))
    errors.install(app)
    app.include_router(ngsi.router)
    return app
