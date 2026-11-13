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

import asyncio
import contextlib
from typing import Annotated, Any

from fastapi import APIRouter, Body, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.errors import invalid
from app.ngsi.broker import check_document
from app.ngsi.fetch import fetch_document
from app.ngsi.live import Watcher
from app.ngsi.stream import drop_connection, origin_allowed
from app.ngsi.timeshift import TimeShift

router = APIRouter(prefix="/api/ngsi", tags=["explorer"])

KEEPALIVE_S = 20
SEND_TIMEOUT_S = 10
OVERFLOW_CODE = 1013
ORIGIN_REFUSED_CODE = 4403


class ImportUrl(BaseModel):
    url: str


class TypeNames(BaseModel):
    types: list[str]


def _answer(found: list) -> Any:
    """A list. If it stopped early, a header says how far it got, and another gives the total when it is known:
    the body stays what the broker's would be."""
    headers = {}
    if limited := getattr(found, "limited", None):
        headers["X-Results-Limited"] = ", ".join(f"{key}={value}" for key, value in limited.items())
    if (total := getattr(found, "total", None)) is not None:
        headers["X-Total-Count"] = str(total)
    if not headers:
        return list(found)
    return JSONResponse(list(found), headers=headers)


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


@router.get("/prefixes")
async def prefixes(request: Request) -> dict:
    """The configured context's prefixes. The caller's parameters are ignored: no context is named here."""
    return await request.app.state.prefixes.prefixes()


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
    offset: int = 0,
    attrs: str | None = None,
    has_attr: str | None = None,
) -> Any:
    found = await request.app.state.broker.query(
        entity_type=type,
        entity_id=id,
        id_pattern=id_pattern,
        q=q,
        limit=limit,
        offset=offset,
        attrs=attrs,
        has_attr=has_attr,
    )
    return _answer(found)


def _at_path(name: str | None, path: list[str], body: Any) -> Any:
    """The fragment for the deepest level of a path: the body holds the attribute `name`, and only it."""
    if not name:
        raise invalid("Name the attribute that the path is below.")
    if not isinstance(body, dict) or list(body) != [name]:
        raise invalid("With a path, the body holds the named attribute and only it.")
    check_document(body)
    return body[name]


@router.patch("/entities/{entity_id:path}/attrs", status_code=204)
async def update_attributes(
    entity_id: str,
    body: Annotated[Any, Body()],
    request: Request,
    name: str | None = None,
    path: Annotated[list[str] | None, Query()] = None,
    dataset_id: str | None = None,
) -> Response:
    broker = request.app.state.broker
    if path:
        await broker.update_at_path(entity_id, name, path, _at_path(name, path, body), dataset_id)
    else:
        await broker.update_attributes(entity_id, _attributes(body))
    return Response(status_code=204)


@router.post("/entities/{entity_id:path}/attrs", status_code=204)
async def append_attributes(
    entity_id: str,
    body: Annotated[Any, Body()],
    request: Request,
    name: str | None = None,
    path: Annotated[list[str] | None, Query()] = None,
    dataset_id: str | None = None,
) -> Response:
    broker = request.app.state.broker
    if path:
        await broker.append_at_path(entity_id, name, path, _at_path(name, path, body), dataset_id)
    else:
        await broker.append_attributes(entity_id, _attributes(body))
    return Response(status_code=204)


@router.delete("/entities/{entity_id:path}/attrs", status_code=204)
async def delete_attribute(
    entity_id: str,
    request: Request,
    name: str = Query(...),
    sub_attribute: str | None = None,
    path: Annotated[list[str] | None, Query()] = None,
    dataset_id: str | None = None,
) -> Response:
    """`sub_attribute=x` is the same as one `path=x`."""
    broker = request.app.state.broker
    levels = path or ([sub_attribute] if sub_attribute else [])
    if path and sub_attribute:
        raise invalid("Name the sub-attribute either by path or by sub_attribute.")
    if levels:
        await broker.delete_at_path(entity_id, name, levels, dataset_id)
    elif dataset_id is not None:
        raise invalid("A dataset is named only with a path: an attribute is deleted with every dataset.")
    else:
        await broker.delete_attribute(entity_id, name)
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
    path: Annotated[list[str] | None, Query()] = None,
) -> Any:
    """`path` names a sub-attribute below the attribute, one entry per level."""
    found = await request.app.state.attribute_history.values(entity_id, attribute, start, end, dataset_id, path)
    return _answer(found)


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


@router.get("/subscription-health")
async def subscription_health(request: Request) -> dict:
    return request.app.state.live.health()


@router.websocket("/ws")
async def changes(websocket: WebSocket, type: str | None = None, ids: str | None = None) -> None:
    """Changes as they happen. A client that falls behind or stops reading is closed, and reconnects."""
    settings = websocket.app.state.settings
    if not origin_allowed(websocket.headers.get("origin"), websocket.headers.get("host"), settings.ws_allowed_origins):
        await websocket.close(code=ORIGIN_REFUSED_CODE)
        return
    await websocket.accept()
    live = websocket.app.state.live
    watcher = live.watch(type, [i for i in (ids or "").split(",") if i])
    keepalive = getattr(websocket.app.state, "stream_keepalive_s", KEEPALIVE_S)
    send_timeout = getattr(websocket.app.state, "stream_send_timeout_s", SEND_TIMEOUT_S)
    sender = asyncio.create_task(_send(websocket, watcher, keepalive, send_timeout))
    receiver = asyncio.create_task(_receive(websocket))
    try:
        await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        live.unwatch(watcher)
        for task in (sender, receiver):
            task.cancel()
        await asyncio.wait({sender, receiver})


async def _send(websocket: WebSocket, watcher: Watcher, keepalive: float, send_timeout: float) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        try:
            while True:
                # What arrived in time is delivered first, in order, and only then does it close.
                if watcher.overflowed and watcher.queue.empty():
                    await asyncio.wait_for(websocket.close(code=OVERFLOW_CODE), send_timeout)
                    return
                try:
                    message = await asyncio.wait_for(watcher.queue.get(), keepalive)
                except TimeoutError:
                    message = {"type": "keepalive"}
                await asyncio.wait_for(websocket.send_json(message), send_timeout)
        except TimeoutError:
            # The socket is full and nothing reads it, so a close frame wouldn't get out either.
            drop_connection(websocket)


async def _receive(websocket: WebSocket) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await websocket.receive_text()
