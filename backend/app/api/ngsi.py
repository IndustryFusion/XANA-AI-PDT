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
from pydantic import BaseModel, Field, StringConstraints

from app.errors import Refused, invalid
from app.ngsi.broker import check_document
from app.ngsi.contexts import ADMIN_ROLE, change_role
from app.ngsi.fetch import fetch_document
from app.ngsi.live import Watcher
from app.ngsi.stream import drop_connection, origin_allowed
from app.ngsi.timeshift import TimeShift

router = APIRouter(prefix="/api/ngsi", tags=["explorer"])

KEEPALIVE_S = 20
SEND_TIMEOUT_S = 10
# How often a long search looks whether its client is still there.
DISCONNECT_POLL_S = 0.5
OVERFLOW_CODE = 1013
ORIGIN_REFUSED_CODE = 4403


class ImportUrl(BaseModel):
    url: str


class TypeNames(BaseModel):
    types: list[str]


# Many entities at once, for a tree of entities: more than this is refused rather than read.
MAX_IDS = 1000
# The longest entity ID accepted there: an ID is a URI, and the platform's are far shorter (about 120
# characters for the IRIs of an OPC UA model); a longer one is refused before anything reaches the broker.
MAX_ID_LENGTH = 2048


class EntityIds(BaseModel):
    ids: list[Annotated[str, StringConstraints(max_length=MAX_ID_LENGTH)]] = Field(max_length=MAX_IDS)


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


class ContextToAllow(BaseModel):
    url: str


def _change_role(request: Request) -> str:
    return change_role(request.app.state.session.client_id)


def _may_change_contexts(request: Request) -> bool:
    """Whether the signed-in operator may change the allowed contexts: the client's admin role, read
    from the token the backend's session holds, never from the caller."""
    return ADMIN_ROLE in request.app.state.session.client_roles()


def _only_admins(request: Request) -> None:
    if not _may_change_contexts(request):
        raise Refused(
            "unauthorized",
            f"Only an operator with {_change_role(request)} can change the allowed contexts.",
            status=403,
        )


async def _listed(request: Request) -> dict:
    return await request.app.state.contexts.entries(_may_change_contexts(request), _change_role(request))


@router.get("/contexts")
async def allowed_contexts(request: Request) -> dict:
    """The contexts an imported entity may name: the core, built-in, deployment and added ones."""
    return await _listed(request)


@router.get("/contexts/risks")
async def context_risks(request: Request, url: str) -> dict:
    """What allowing the context would risk, beyond trusting whoever controls it: for admins only, as
    it tells whether a name resolves inside the network."""
    _only_admins(request)
    return {"risks": await request.app.state.contexts.risks(url)}


@router.post("/contexts")
async def allow_context(body: ContextToAllow, request: Request) -> dict:
    _only_admins(request)
    user = (request.app.state.session.status().get("user") or {}).get("username") or None
    await request.app.state.contexts.add(body.url, user)
    return await _listed(request)


@router.delete("/contexts")
async def remove_context(request: Request, url: str) -> dict:
    _only_admins(request)
    await request.app.state.contexts.remove(url)
    return await _listed(request)


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
    """The fragment for the attribute `name`, or for the deepest level of a path below it: the body holds
    that attribute, and only it."""
    if not name:
        raise invalid("Name the attribute that the path is below.")
    if not isinstance(body, dict) or list(body) != [name]:
        raise invalid("With a name, the body holds the named attribute and only it.")
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
    force: bool = False,
    exact: bool = False,
) -> Response:
    """`force` writes a value the checks refuse, such as text for a number, when the operator insists.
    `exact` writes the value in the form given -- plain, or declared with the datatype the operator
    chose -- instead of keeping the stored datatype."""
    broker = request.app.state.broker
    if path:
        await broker.update_at_path(entity_id, name, path, _at_path(name, path, body), dataset_id, force, exact)
    else:
        await broker.update_attributes(entity_id, _attributes(body), force, exact)
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
    # With `name`, the body adds sub-attributes to that attribute, or to the sub-attribute at `path`
    # below it. The whole attribute is written back: the broker's merge can't add one (it stores its
    # own result object instead).
    if path or name:
        await broker.append_at_path(entity_id, name, path or [], _at_path(name, path or [], body), dataset_id)
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
    """`sub_attribute=x` is the same as one `path=x`. `dataset_id` without a path deletes that instance of the
    attribute alone, `@none` its default instance; without either, the attribute goes with every instance."""
    broker = request.app.state.broker
    levels = path or ([sub_attribute] if sub_attribute else [])
    if path and sub_attribute:
        raise invalid("Name the sub-attribute either by path or by sub_attribute.")
    if levels:
        await broker.delete_at_path(entity_id, name, levels, dataset_id)
    elif dataset_id is not None:
        await broker.delete_instance(entity_id, name, dataset_id)
    else:
        await broker.delete_attribute(entity_id, name)
    return Response(status_code=204)


@router.get("/referenced-by")
async def referenced_by(request: Request, entity_id: str) -> Any:
    """The entities that refer to `entity_id`, each with the places it refers from."""
    search = asyncio.ensure_future(request.app.state.broker.referrers(entity_id))
    try:
        while not (await asyncio.wait({search}, timeout=DISCONNECT_POLL_S))[0]:
            # A search nobody waits for any more must not read on, nor hold a place in the queue.
            if await request.is_disconnected():
                return Response(status_code=499)
        return _answer(await search)
    finally:
        search.cancel()


@router.post("/entities-by-id")
async def entities_by_id(body: EntityIds, request: Request) -> dict:
    """The entities of `ids` that exist, by ID, read together; an ID without an entity is left out."""
    return await request.app.state.broker.entities_by_id(body.ids)


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


@router.post("/attr-status-by-id")
async def attribute_statuses(body: EntityIds, request: Request) -> dict:
    """The latest recorded state per attribute of each entity of `ids`, by ID."""
    return await request.app.state.attribute_history.statuses(body.ids)


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
