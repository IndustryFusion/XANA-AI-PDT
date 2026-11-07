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
"""The Data Explorer's routes. They use the backend's own configuration: no route takes an address.

Answers hold attribute names as the broker gives them. The diagnostic workflow doesn't use these
routes: editing is an operator action.

Identifiers can hold anything a URI can, so entity IDs are matched as a path, and attribute names
travel as parameters.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.errors import invalid
from app.ngsi.broker import check_document
from app.ngsi.fetch import fetch_document
from app.ngsi.timeshift import TimeShift

router = APIRouter(prefix="/api/ngsi", tags=["explorer"])


class ImportUrl(BaseModel):
    url: str


class TypeNames(BaseModel):
    types: list[str]


def _answer(found: list) -> Any:
    """A list. If it stopped early, a header says how far it got: the body stays what the broker's would be."""
    limited = getattr(found, "limited", None)
    if not limited:
        return list(found)
    text = ", ".join(f"{key}={value}" for key, value in limited.items())
    return JSONResponse(list(found), headers={"X-Results-Limited": text})


def _attributes(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict) or not body:
        raise invalid("Name at least one attribute.")
    check_document(body)
    return body


@router.get("/types")
async def types(request: Request) -> list[str]:
    return await request.app.state.broker.types()


@router.get("/attributes")
async def attributes(request: Request) -> list[str]:
    return await request.app.state.broker.attributes()


@router.get("/stats")
async def stats(request: Request) -> dict:
    return await request.app.state.broker.stats()


@router.get("/entities")
async def query_entities(
    request: Request,
    type: str | None = None,
    id: str | None = None,
    id_pattern: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> Any:
    found = await request.app.state.broker.query(
        entity_type=type, entity_id=id, id_pattern=id_pattern, q=q, limit=limit
    )
    return _answer(found)


@router.patch("/entities/{entity_id:path}/attrs", status_code=204)
async def update_attributes(entity_id: str, body: Annotated[Any, Body()], request: Request) -> Response:
    await request.app.state.broker.update_attributes(entity_id, _attributes(body))
    return Response(status_code=204)


@router.post("/entities/{entity_id:path}/attrs", status_code=204)
async def append_attributes(entity_id: str, body: Annotated[Any, Body()], request: Request) -> Response:
    await request.app.state.broker.append_attributes(entity_id, _attributes(body))
    return Response(status_code=204)


@router.delete("/entities/{entity_id:path}/attrs", status_code=204)
async def delete_attribute(
    entity_id: str, request: Request, name: str = Query(...), sub_attribute: str | None = None
) -> Response:
    await request.app.state.broker.delete_attribute(entity_id, name, sub_attribute)
    return Response(status_code=204)


@router.get("/entities/{entity_id:path}")
async def get_entity(entity_id: str, request: Request) -> dict:
    return await request.app.state.broker.entity(entity_id)


@router.delete("/entities/{entity_id:path}", status_code=204)
async def delete_entity(entity_id: str, request: Request) -> Response:
    await request.app.state.broker.delete_entity(entity_id)
    return Response(status_code=204)


@router.post("/delete-by-types")
async def delete_by_types(body: TypeNames, request: Request) -> list[dict]:
    return await request.app.state.broker.delete_by_types(body.types)


@router.post("/import")
async def import_entities(body: Annotated[Any, Body()], request: Request) -> JSONResponse:
    if not isinstance(body, list):
        raise invalid("Import expects a list of NGSI-LD entities.")
    check_document(body)
    results = await request.app.state.broker.import_entities(body)
    partial = any(item["result"] == "failed" for item in results)
    return JSONResponse(results, status_code=207 if partial else 200)


@router.post("/import/fetch")
async def import_fetch(body: ImportUrl) -> dict:
    return await fetch_document(body.url)


@router.get("/history")
async def history(
    request: Request,
    entity_id: str,
    attribute: str,
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    dataset_id: str | None = None,
) -> Any:
    return _answer(await request.app.state.attribute_history.values(entity_id, attribute, start, end, dataset_id))


@router.get("/attr-status")
async def attribute_status(request: Request, entity_id: str) -> dict:
    return await request.app.state.attribute_history.status(entity_id)


@router.get("/timeshift/types")
async def timeshift_types(request: Request, at: str) -> list[str]:
    return await TimeShift(request.app.state.attribute_history).types(at)


@router.get("/timeshift/entities")
async def timeshift_entities(
    request: Request,
    at: str,
    type: str | None = None,
    id: str | None = None,
    id_pattern: str | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[dict]:
    return await TimeShift(request.app.state.attribute_history).query(
        at, entity_type=type, entity_id=id, id_pattern=id_pattern, q=q, limit=limit
    )
