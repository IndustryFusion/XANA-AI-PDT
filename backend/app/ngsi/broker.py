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
"""The explorer's calls to the context broker: `NGSI_URL`, with the session's token.

Every address comes from the configuration. Identifiers from a caller go into a path only
percent-encoded, and into a query only as parameters.

Several checks here make up for what the broker does not say. See `gh-22-data-explorer-backend`'s
design for what was measured: updating a missing attribute, and deleting one, answer 204, and
adding one that exists with `noOverwrite` answers 204 as well.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.errors import Refused, bad_gateway, conflict, invalid, not_found
from app.ngsi.failures import refusal, scrubbed, unreachable
from app.ngsi.query import broker_can_evaluate, compile_pattern, matches, parse
from xana_agent.sources.ngsi import context_link

SERVICE = "The context broker"
BASE = "/ngsi-ld/v1"
TIMEOUT_S = 15
MAX_LIMIT = 1000
BATCH = 100
MAX_SCANNED = 5000
# Without an order, the broker's pages can repeat some entities and leave out others (measured on
# Scorpio: 12 of 57 when paging by 7). It orders by ID when asked; a broker that doesn't know the
# parameter ignores it.
STABLE_ORDER = {"orderBy": "id"}
CONCURRENT_COUNTS = 8
RESERVED = {"id", "type", "@context", "scope", "createdAt", "modifiedAt", "deletedAt"}
VALUE_MEMBERS = ("value", "object", "objectList", "json", "languageMap", "valueList", "vocab")
_URI = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:\S+")
_CORE_CONTEXT = re.compile(r"https://uri\.etsi\.org/ngsi-ld/v1/ngsi-ld-core-context(-v[0-9.]+)?\.jsonld")
JSON_TYPE = "application/json"
LD_TYPE = "application/ld+json"


CONTEXT_REFUSED = (
    "This entity's @context names an address that isn't allowed here: the broker would fetch it from "
    "inside the platform. Allowed contexts are set with NGSI_ALLOWED_CONTEXTS."
)


class Limited(list):
    """A list that stopped early. `limited` says how far it got, for the caller and the operator.

    `total` is the number of matches in all, when it is known.
    """

    limited: dict[str, int] | None = None
    total: int | None = None


def _checked_identifier(identifier: str) -> str:
    # Percent-encoding leaves dots alone, and `..` would address the path above.
    if identifier.strip() in ("", ".", ".."):
        raise invalid("That is not a valid identifier.")
    return identifier


def _segment(identifier: str) -> str:
    return quote(_checked_identifier(identifier), safe=":")


def _attribute_segment(name: str) -> str:
    return quote(_checked_identifier(name), safe="")


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


MAX_DEPTH = 64


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _checked_limit(limit: int) -> int:
    if not 1 <= limit <= MAX_LIMIT:
        raise invalid(f"The limit must be a whole number from 1 to {MAX_LIMIT}.")
    return limit


def _checked_offset(offset: int) -> int:
    if offset < 0:
        raise invalid("The offset must be a whole number from 0.")
    return offset


def _names(text: str | None) -> list[str]:
    """Attribute names from a comma-separated list, each checked as an identifier."""
    names = [name.strip() for name in (text or "").split(",") if name.strip()]
    for name in names:
        _checked_identifier(name)
    return list(dict.fromkeys(names))


def _projected(entity: dict[str, Any], names: list[str]) -> dict[str, Any] | None:
    """The entity with only the named attributes, as the broker's `attrs` gives it: None without any of them."""
    kept = {key: value for key, value in entity.items() if key in names}
    if not kept:
        return None
    return {key: value for key, value in entity.items() if key in ("id", "type", "@context")} | kept


def _problem(item: Any) -> str:
    error = item.get("error") if isinstance(item, dict) else None
    if isinstance(error, dict):
        return scrubbed(str(error.get("detail") or error.get("title") or "The broker rejected this entity."))
    return "The broker rejected this entity."


def check_document(document: Any) -> None:
    """Refuses a document too deeply nested to handle, or holding text JSON can't carry to the broker.

    Walks it without recursion, and needs no parser's limit to hold: what follows can recurse safely.
    """
    stack = [(document, 1)]
    while stack:
        value, depth = stack.pop()
        if depth > MAX_DEPTH:
            raise invalid(f"The document is nested more than {MAX_DEPTH} levels deep.")
        if isinstance(value, dict):
            stack.extend((key, depth + 1) for key in value)
            stack.extend((item, depth + 1) for item in value.values())
        elif isinstance(value, list):
            stack.extend((item, depth + 1) for item in value)
        elif isinstance(value, str) and not _encodable(value):
            raise invalid("The document holds text that isn't valid Unicode, such as a lone surrogate.")


def _encodable(text: str) -> bool:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _inner_context(value: Any) -> bool:
    """Whether a value holds a context of its own anywhere, which the broker would act on."""
    if isinstance(value, dict):
        return any(key in ("@context", "@import") or _inner_context(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_inner_context(item) for item in value)
    return False


class ContextBroker:
    def __init__(
        self,
        settings: Settings,
        token: Callable[[], str | None],
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = settings.ngsi_url.rstrip("/")
        self._tenant = settings.ngsi_tenant
        self._context = settings.ngsi_context_url
        self._allowed_contexts = {
            url.strip() for url in (settings.ngsi_allowed_contexts or "").split(",") if url.strip()
        } | ({self._context} if self._context else set())
        self._token = token
        self._transport = transport
        self._entity_locks: dict[str, tuple[asyncio.Lock, int]] = {}
        self.on_write: Callable[[], None] | None = None

    @asynccontextmanager
    async def _editing(self, entity_id: str) -> AsyncIterator[None]:
        """One read-then-write at a time per entity, as the broker can't say that a write came too late.

        This covers this process, which is the only one in a deployment while the session is per process.
        Another writer can still change an attribute between the read and the write.
        """
        lock, users = self._entity_locks.get(entity_id, (asyncio.Lock(), 0))
        self._entity_locks[entity_id] = (lock, users + 1)
        try:
            async with lock:
                yield
        finally:
            lock, users = self._entity_locks[entity_id]
            if users == 1:
                del self._entity_locks[entity_id]
            else:
                self._entity_locks[entity_id] = (lock, users - 1)

    def _context_allowed(self, context: Any) -> bool:
        """Only known addresses: the broker fetches a context from inside the platform, unchecked."""
        if isinstance(context, str):
            return bool(_CORE_CONTEXT.fullmatch(context)) or context in self._allowed_contexts
        if isinstance(context, list):
            return all(self._context_allowed(item) for item in context)
        return isinstance(context, dict) and not _inner_context(context)

    def _context_problem(self, entity: dict[str, Any]) -> str | None:
        rest = {key: value for key, value in entity.items() if key != "@context"}
        if _inner_context(rest) or ("@context" in entity and not self._context_allowed(entity["@context"])):
            return CONTEXT_REFUSED
        return None

    def headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._tenant:
            headers["NGSILD-Tenant"] = self._tenant
        if token := self._token():
            headers["Authorization"] = f"Bearer {token}"
        # A body with its own context must not be sent with another one.
        if self._context and content_type != LD_TYPE:
            headers["Link"] = context_link(self._context)
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    async def send(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: Any = None,
        content_type: str = JSON_TYPE,
    ) -> httpx.Response:
        """One request. A failed answer raises the matching refusal."""
        headers = self.headers(content_type if body is not None else None)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.request(
                    method, f"{self._url}{BASE}{path}", params=params, json=body, headers=headers
                )
        except httpx.HTTPError as error:
            raise unreachable(SERVICE, error) from None
        if response.status_code >= 400:
            raise refusal(SERVICE, response)
        # The broker notifies changes, but not deletions.
        if self.on_write and method in ("PATCH", "POST") and _changes_entities(path) and _something_changed(response):
            self.on_write()
        return response

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self.send(method, path, **kwargs)
        try:
            return response.json()
        except ValueError:
            raise bad_gateway(f"{SERVICE} sent an answer that isn't JSON.") from None

    # Query and browse --------------------------------------------------------

    async def types(self) -> list[str]:
        answer = await self._json("GET", "/types")
        listed = answer.get("typeList") if isinstance(answer, dict) else None
        return sorted(_listed(listed))

    async def attributes(self) -> list[str]:
        answer = await self._json("GET", "/attributes")
        listed = answer.get("attributeList") if isinstance(answer, dict) else None
        return sorted(_listed(listed))

    async def _count(self, entity_type: str) -> int:
        # `limit=0` reports 0, whatever the count is.
        response = await self.send("GET", "/entities", params={"type": entity_type, "count": "true", "limit": 1})
        try:
            return int(response.headers.get("NGSILD-Results-Count", "0"))
        except ValueError:
            return 0

    async def stats(self) -> dict[str, Any]:
        names = await self.types()
        slots = asyncio.Semaphore(CONCURRENT_COUNTS)

        async def counted(name: str) -> dict[str, Any]:
            async with slots:
                return {"type": name, "count": await self._count(name)}

        by_type = await asyncio.gather(*(counted(name) for name in names))
        by_type = sorted(by_type, key=lambda item: (-item["count"], item["type"]))
        return {"entity_count": sum(item["count"] for item in by_type), "type_count": len(names), "by_type": by_type}

    async def query(
        self,
        *,
        entity_type: str | None = None,
        entity_id: str | None = None,
        id_pattern: str | None = None,
        q: str | None = None,
        limit: int = 100,
        offset: int = 0,
        attrs: str | None = None,
        has_attr: str | None = None,
    ) -> list[dict[str, Any]]:
        """Matching entities, from `offset` on. `attrs` keeps only those attributes, as the broker does;
        `has_attr` keeps entities that have that attribute, each whole unless `attrs` is given."""
        _checked_limit(limit)
        _checked_offset(offset)
        selected = _names(attrs)
        having = _names(has_attr)
        if len(having) > 1:
            raise invalid("Name one attribute for the has-attribute filter.")
        tree = parse(q)
        if id_pattern:
            compile_pattern(id_pattern, "The ID pattern")
        if not any((entity_type, entity_id, id_pattern, q and q.strip())):
            raise invalid("Name a type, an ID, an ID pattern or a query expression.")
        params: dict[str, Any] = {}
        if entity_type:
            params["type"] = entity_type
        if entity_id:
            params["id"] = entity_id
        if id_pattern:
            params["idPattern"] = id_pattern
        if not entity_type and not entity_id:
            params["type"] = "*"  # the broker refuses an ID pattern or expression alone
        page = _Page(limit, offset, selected, having[0] if having else None)
        if not broker_can_evaluate(tree):
            return await self._filtered(params, tree, page)
        if tree is not None:
            params["q"] = q
        try:
            return await self._paged(params, page)
        except Refused as refused:
            if tree is None or refused.kind not in ("invalid", "unavailable"):
                raise
            # The syntax was checked here, so this is the broker failing on it. If the broker is
            # really down, reading the entities fails too, and that failure is the answer.
            params.pop("q")
            return await self._filtered(params, tree, page)

    async def _paged(self, params: dict[str, Any], page: _Page) -> Limited:
        """The broker evaluates the query, pages it and counts it."""
        attrs = page.having or (",".join(page.selected) if page.selected else None)
        asked = {**params, "limit": page.limit, "offset": page.offset, "count": "true", **STABLE_ORDER}
        if attrs:
            asked["attrs"] = attrs
        response = await self.send("GET", "/entities", params=asked)
        try:
            found = response.json()
        except ValueError:
            raise bad_gateway(f"{SERVICE} sent an answer that isn't JSON.") from None
        found = [entity for entity in found if isinstance(entity, dict)] if isinstance(found, list) else []
        if page.having:
            found = await self._whole(found, page.selected)
        answer = Limited(found)
        total = _count_of(response)
        # Past the last match the broker counts 0, which isn't the total.
        answer.total = None if total == 0 and page.offset and not found else total
        return answer

    async def _whole(self, found: list[dict[str, Any]], selected: list[str]) -> list[dict[str, Any]]:
        """The entities found by their attribute, read again by ID: whole, or with the selected attributes."""
        ids = [entity["id"] for entity in found if isinstance(entity.get("id"), str)]
        if not ids:
            return []
        by_id: dict[Any, dict[str, Any]] = {}
        # In chunks, as all of a page's IDs in one address can be too long for the broker (HTTP 414).
        for start in range(0, len(ids), BATCH):
            chunk = ids[start : start + BATCH]
            asked: dict[str, Any] = {"id": ",".join(chunk), "type": "*", "limit": len(chunk)}
            if selected:
                asked["attrs"] = ",".join(selected)
            read = await self._json("GET", "/entities", params=asked)
            by_id.update((e.get("id"), e) for e in (read if isinstance(read, list) else []) if isinstance(e, dict))
        return [by_id[entity_id] for entity_id in ids if entity_id in by_id]

    async def _filtered(self, params: dict[str, Any], tree: Any, page: _Page) -> Limited:
        """Evaluates the expression here, over the first `MAX_SCANNED` entities, and says if there were more.

        Matching is on whole entities; the offset skips matches, and selected attributes are kept afterwards.
        The total is known when every entity was read.
        """
        wanted = page.offset + page.limit
        matched: list[dict[str, Any]] = []
        total = None
        complete = False
        for start in range(0, MAX_SCANNED, MAX_LIMIT):
            response = await self.send(
                "GET",
                "/entities",
                params={**params, "limit": MAX_LIMIT, "offset": start, "count": "true", **STABLE_ORDER},
            )
            try:
                read = response.json()
            except ValueError:
                raise bad_gateway(f"{SERVICE} sent an answer that isn't JSON.") from None
            read = read if isinstance(read, list) else []
            total = _count_of(response)
            for entity in read:
                if not isinstance(entity, dict) or not matches(entity, tree):
                    continue
                if page.having and page.having not in entity:
                    continue
                if page.selected and _projected(entity, page.selected) is None:
                    continue
                matched.append(entity)
            if len(read) < MAX_LIMIT:
                complete = True
                break
            if len(matched) > wanted:
                break
        answer = Limited(
            entity if not page.selected else _projected(entity, page.selected)
            for entity in matched[page.offset : wanted]
        )
        if complete:
            answer.total = len(matched)
        elif len(matched) <= wanted and (total is None or total > MAX_SCANNED):
            answer.limited = {"scanned": MAX_SCANNED, **({"total": total} if total is not None else {})}
        return answer

    async def entity(self, entity_id: str) -> dict[str, Any]:
        found = await self._json("GET", f"/entities/{_segment(entity_id)}")
        if not isinstance(found, dict):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return found

    async def _existing(self, entity_id: str) -> dict[str, Any]:
        try:
            return await self.entity(entity_id)
        except Refused as refused:
            if refused.kind == "not_found":
                raise not_found(f"There is no entity {entity_id}.") from None
            raise

    # Editing -----------------------------------------------------------------

    async def update_attributes(self, entity_id: str, attributes: dict[str, Any]) -> None:
        self._refuse_contexts(attributes)
        async with self._editing(entity_id):
            await self._update_attributes(entity_id, attributes)

    async def _update_attributes(self, entity_id: str, attributes: dict[str, Any]) -> None:
        current = await self._existing(entity_id)
        merge: dict[str, Any] = {}
        overwrite: dict[str, Any] = {}
        for name, fragment in attributes.items():
            if name in RESERVED or name not in current:
                raise not_found(f"{entity_id} has no attribute {name}.")
            if not isinstance(fragment, dict):
                raise invalid(f"Attribute {name} needs a value.")
            existing = current[name]
            if isinstance(existing, list):
                overwrite[name] = _merged_instance(name, existing, fragment)
            else:
                merge[name] = _merge_fragment(name, existing, fragment)
        if merge:
            await self.send("PATCH", f"/entities/{_segment(entity_id)}", body=merge)
        if overwrite:
            await self.send("POST", f"/entities/{_segment(entity_id)}/attrs", body=overwrite)

    def _refuse_contexts(self, attributes: dict[str, Any]) -> None:
        if _inner_context(attributes):
            raise invalid(CONTEXT_REFUSED)

    async def append_attributes(self, entity_id: str, attributes: dict[str, Any]) -> None:
        self._refuse_contexts(attributes)
        async with self._editing(entity_id):
            await self._append_attributes(entity_id, attributes)

    async def _append_attributes(self, entity_id: str, attributes: dict[str, Any]) -> None:
        current = await self._existing(entity_id)
        for name, attribute in attributes.items():
            if name in current:
                raise conflict(f"{entity_id} already has an attribute {name}.")
            if name in RESERVED or not isinstance(attribute, dict) or not isinstance(attribute.get("type"), str):
                raise invalid(f"Attribute {name} needs a type and a value.")
        await self.send(
            "POST", f"/entities/{_segment(entity_id)}/attrs", params={"options": "noOverwrite"}, body=attributes
        )

    async def delete_attribute(self, entity_id: str, name: str, sub_attribute: str | None = None) -> None:
        async with self._editing(entity_id):
            await self._delete_attribute(entity_id, name, sub_attribute)

    async def _delete_attribute(self, entity_id: str, name: str, sub_attribute: str | None) -> None:
        current = await self._existing(entity_id)
        if name in RESERVED or name not in current:
            raise not_found(f"{entity_id} has no attribute {name}.")
        path = f"/entities/{_segment(entity_id)}/attrs"
        if not sub_attribute:
            # Without `deleteAll`, the broker can't find an attribute with several datasets.
            await self.send("DELETE", f"{path}/{_attribute_segment(name)}", params={"deleteAll": "true"})
            return
        # The broker has no route for this, so the attribute is written again without it.
        existing = current[name]
        instances = existing if isinstance(existing, list) else [existing]
        holders = [item for item in instances if isinstance(item, dict) and sub_attribute in item]
        if not holders or sub_attribute in ("type", *VALUE_MEMBERS):
            raise not_found(f"{name} has no sub-attribute {sub_attribute}.")
        changed = [{k: v for k, v in item.items() if k != sub_attribute} for item in holders]
        await self.send("POST", path, body={name: changed[0] if len(changed) == 1 else changed})

    # Sub-attributes at a path ---------------------------------------------------

    async def update_at_path(
        self, entity_id: str, name: str, path: list[str], fragment: Any, dataset_id: str | None = None
    ) -> None:
        """Merges the fragment into the sub-attribute at the path below the attribute."""
        if not isinstance(fragment, dict) or not fragment:
            raise invalid(f"Attribute {_level_name(name, path)} needs a value.")
        self._refuse_contexts(fragment)

        def change(level: dict[str, Any]) -> None:
            _check_value(path[-1], level, fragment)
            level.update(_stamped(level, fragment))

        await self._edit_at_path(entity_id, name, path, dataset_id, change)

    async def append_at_path(
        self, entity_id: str, name: str, path: list[str], fragment: Any, dataset_id: str | None = None
    ) -> None:
        """Adds the fragment's sub-attributes to the sub-attribute at the path below the attribute."""
        if not isinstance(fragment, dict) or not fragment:
            raise invalid("Name at least one sub-attribute.")
        self._refuse_contexts(fragment)
        for sub, attribute in fragment.items():
            if not _sub_attribute_name(sub):
                raise invalid(f"{sub} is a member of the attribute itself, not a name for a sub-attribute.")
            if not isinstance(attribute, dict) or not isinstance(attribute.get("type"), str):
                raise invalid(f"Sub-attribute {sub} needs a type and a value.")

        def add(level: dict[str, Any]) -> None:
            for sub in fragment:
                if sub in level:
                    raise conflict(f"{_level_name(name, path)} already has a sub-attribute {sub}.")
            level.update(fragment)

        await self._edit_at_path(entity_id, name, path, dataset_id, add)

    async def delete_at_path(self, entity_id: str, name: str, path: list[str], dataset_id: str | None = None) -> None:
        """Removes the sub-attribute at the path from each dataset that has it, or from the one named."""
        if len(path) == 1 and dataset_id is None:
            await self.delete_attribute(entity_id, name, path[0])
            return
        async with self._editing(entity_id):
            instances = await self._instances(entity_id, name, dataset_id)
            holders = []
            reached = 0
            for instance in instances:
                found, depth = _walk(instance, path[:-1])
                if found is not None and _sub_attribute_name(path[-1]) and isinstance(found.get(path[-1]), dict):
                    holders.append((instance, found))
                else:
                    reached = max(reached, depth if found is None else len(path) - 1)
            if not holders:
                raise not_found(f"{_level_name(name, path[:reached])} has no sub-attribute {path[reached]}.")
            if len(path) == 1:
                # The broker's attribute-level PATCH can't take a top-level member away.
                changed = [{k: v for k, v in instance.items() if k != path[0]} for instance, _ in holders]
                await self.send(
                    "POST",
                    f"/entities/{_segment(entity_id)}/attrs",
                    body={name: changed[0] if len(changed) == 1 else changed},
                )
                return
            for instance, level in holders:
                del level[path[-1]]
                await self._write_attribute(entity_id, name, instance)

    async def _edit_at_path(
        self,
        entity_id: str,
        name: str,
        path: list[str],
        dataset_id: str | None,
        apply: Callable[[dict[str, Any]], None],
    ) -> None:
        async with self._editing(entity_id):
            instances = await self._instances(entity_id, name, dataset_id)
            if dataset_id is None and len(instances) > 1:
                instances = [i for i in instances if i.get("datasetId") is None]
            if len(instances) != 1:
                raise not_found(f"{name} has no instance with that dataset.")
            instance = instances[0]
            level, depth = _walk(instance, path)
            if level is None:
                raise not_found(f"{_level_name(name, path[:depth])} has no sub-attribute {path[depth]}.")
            apply(level)
            await self._write_attribute(entity_id, name, instance)

    async def _instances(self, entity_id: str, name: str, dataset_id: str | None) -> list[dict[str, Any]]:
        """The attribute's instances, every dataset, or the one named."""
        current = await self._existing(entity_id)
        if name in RESERVED or name not in current:
            raise not_found(f"{entity_id} has no attribute {name}.")
        existing = current[name]
        instances = [i for i in (existing if isinstance(existing, list) else [existing]) if isinstance(i, dict)]
        if dataset_id is not None:
            instances = [i for i in instances if i.get("datasetId") == dataset_id]
            if not instances:
                raise not_found(f"{name} has no instance with that dataset.")
        return instances

    async def _write_attribute(self, entity_id: str, name: str, instance: dict[str, Any]) -> None:
        """The whole instance, written back with an attribute-level PATCH: its `datasetId` says which."""
        await self.send("PATCH", f"/entities/{_segment(entity_id)}/attrs/{_attribute_segment(name)}", body=instance)

    async def delete_entity(self, entity_id: str) -> None:
        try:
            await self.send("DELETE", f"/entities/{_segment(entity_id)}")
        except Refused as refused:
            if refused.kind == "not_found":
                raise not_found(f"There is no entity {entity_id}.") from None
            raise

    # Import and bulk delete --------------------------------------------------

    async def _types_of(self, ids: list[str]) -> dict[str, Any]:
        """The types of those IDs that exist."""
        known: dict[str, Any] = {}
        for start in range(0, len(ids), BATCH):
            chunk = ids[start : start + BATCH]
            found = await self._json("GET", "/entities", params={"id": ",".join(chunk), "limit": MAX_LIMIT})
            for entity in found if isinstance(found, list) else []:
                known[entity.get("id")] = entity.get("type")
        return known

    async def import_entities(self, entities: list[Any]) -> list[dict[str, Any]]:
        """Creates or replaces entities. The result has one line per entry, in order."""
        results: list[dict[str, Any]] = [{"id": None, "result": "failed", "reason": None} for _ in entities]
        ready: list[int] = []
        for index, entity in enumerate(entities):
            problem = _import_problem(index, entity) or self._context_problem(entity)
            if isinstance(entity, dict) and isinstance(entity.get("id"), str):
                results[index]["id"] = entity["id"]
            if problem:
                results[index]["reason"] = problem
            else:
                ready.append(index)
        if not ready:
            return results
        # The broker's 207 doesn't tell created from updated, so that is read first.
        known = await self._types_of(list(dict.fromkeys(entities[i]["id"] for i in ready)))
        sendable = []
        for index in ready:
            entity = entities[index]
            if entity["id"] in known and not _same_type(known[entity["id"]], entity["type"]):
                results[index]["reason"] = f"An entity with this ID exists with the type {known[entity['id']]}."
            else:
                sendable.append(index)
        # The content type has to fit all of a request: a context in the body, or none.
        for with_context in (False, True):
            group = [i for i in sendable if ("@context" in entities[i]) == with_context]
            for start in range(0, len(group), BATCH):
                await self._upsert(entities, group[start : start + BATCH], with_context, known, results)
        return results

    async def _upsert(
        self,
        entities: list[Any],
        indexes: list[int],
        with_context: bool,
        known: dict[str, Any],
        results: list[dict[str, Any]],
    ) -> None:
        content_type = LD_TYPE if with_context else JSON_TYPE
        rejected: dict[str, str] = {}
        try:
            response = await self.send(
                "POST",
                "/entityOperations/upsert",  # without options: an existing entity is replaced
                body=[entities[i] for i in indexes],
                content_type=content_type,
            )
        except Refused as refused:
            # A later batch failing must not hide what earlier batches did.
            for i in indexes:
                results[i]["reason"] = scrubbed(refused.message)
            return
        if response.status_code == 207:
            try:
                answer = response.json()
            except ValueError:
                answer = {}
            for item in answer.get("errors", []) if isinstance(answer, dict) else []:
                if isinstance(item, dict):
                    rejected[str(item.get("entityId"))] = _problem(item)
        for i in indexes:
            entity_id = entities[i]["id"]
            if entity_id in rejected:
                results[i]["reason"] = rejected[entity_id]
            else:
                results[i].update(result="updated" if entity_id in known else "created", reason=None)

    async def delete_by_types(self, types: list[str]) -> list[dict[str, Any]]:
        # The broker reads `*`, `,`, `;` and `|` in a type as a query. Only a listed type may be
        # used, so that a request for "*" can't delete everything.
        listed = set(await self.types())
        counts: list[dict[str, Any]] = []
        for name in dict.fromkeys(types):
            count = await self._delete_type(name, sum(c["count"] for c in counts)) if name in listed else 0
            counts.append({"type": name, "count": count})
        return counts

    async def _delete_type(self, name: str, before: int) -> int:
        deleted = 0
        while True:
            try:
                page = await self._json("GET", "/entities", params={"type": name, "limit": MAX_LIMIT})
                ids = [e["id"] for e in page if isinstance(e, dict) and _same_type(e.get("type"), name) and e.get("id")]
                if not ids:
                    return deleted
                gone = await self._delete_batch(ids)
            except Refused as refused:
                total = before + deleted
                raise Refused(
                    refused.kind,
                    f"{refused.message} {total} {'entity was' if total == 1 else 'entities were'} deleted before this.",
                    status=refused.http_status,
                ) from None
            deleted += gone
            if not gone:
                raise bad_gateway(f"{SERVICE} deleted none of the {len(ids)} entities of type {name}.")

    async def _delete_batch(self, ids: list[str]) -> int:
        response = await self.send("POST", "/entityOperations/delete", body=ids)
        if response.status_code != 207:
            return len(ids)
        try:
            return len(response.json().get("success", []))
        except (ValueError, AttributeError):
            return 0


def _something_changed(response: httpx.Response) -> bool:
    """A 207 can say that nothing changed: an upsert with every entity rejected, so no notification follows."""
    if response.status_code != 207:
        return True
    try:
        body = response.json()
    except ValueError:
        return False
    return isinstance(body, dict) and bool(body.get("success") or body.get("updated"))


def _changes_entities(path: str) -> bool:
    return (
        path.endswith("/attrs")
        or path == "/entityOperations/upsert"
        or (path.startswith("/entities/") and "/" not in path.removeprefix("/entities/"))
    )


@dataclass(frozen=True)
class _Page:
    limit: int
    offset: int
    selected: list[str]
    having: str | None


def _count_of(response: httpx.Response) -> int | None:
    try:
        return int(response.headers["NGSILD-Results-Count"])
    except (KeyError, ValueError):
        return None


def _listed(value: Any) -> list[str]:
    """A list from the broker, which answers a single item without the list around it."""
    if value is None:
        return []
    return [item for item in (value if isinstance(value, list) else [value]) if isinstance(item, str)]


def _same_type(a: Any, b: Any) -> bool:
    return (b in a) if isinstance(a, list) else a == b


def _import_problem(index: int, entity: Any) -> str | None:
    if not isinstance(entity, dict):
        return f"Entry {index + 1} is not an entity."
    entity_id = entity.get("id")
    if not isinstance(entity_id, str) or not _URI.fullmatch(entity_id):
        return "The entity has no valid ID (URI)."
    if not isinstance(entity.get("type"), str) or not entity["type"]:
        return "The entity has no type."
    return None


def _check_value(name: str, existing: dict[str, Any], fragment: dict[str, Any]) -> None:
    if "value" not in fragment:
        return
    if fragment["value"] in ("", None):
        raise invalid(f"{name} cannot be empty.")
    if _is_number(existing.get("value")) and not _is_number(fragment["value"]):
        raise invalid(f"{name} must be a number.")


def _stamped(existing: dict[str, Any], fragment: dict[str, Any]) -> dict[str, Any]:
    """The fragment with the observation time, when it changes a value and doesn't state a time."""
    if "observedAt" not in fragment and any(member in fragment for member in VALUE_MEMBERS):
        return {**fragment, "observedAt": _now()}
    return fragment


def _merge_fragment(name: str, existing: Any, fragment: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(existing, dict):
        raise invalid(f"{name} cannot be changed this way.")
    _check_value(name, existing, fragment)
    # The broker's merge needs the type, and keeps the value only if it is there.
    kept = {m: existing[m] for m in VALUE_MEMBERS if m in existing and m not in fragment}
    return {"type": existing.get("type"), **kept, **_stamped(existing, fragment)}


# Members an attribute holds about itself (NGSI-LD core); they are never sub-attributes.
RESERVED_MEMBERS = (
    "type",
    "datasetId",
    "observedAt",
    "unitCode",
    "createdAt",
    "modifiedAt",
    "deletedAt",
    "instanceId",
    "lang",
    "objectType",
    "previousValue",
    "previousObject",
    "@context",
    "@id",
    "@type",
)


def _sub_attribute_name(name: str) -> bool:
    return name not in (*RESERVED_MEMBERS, *VALUE_MEMBERS)


def _walk(instance: dict[str, Any], path: list[str]) -> tuple[dict[str, Any] | None, int]:
    """The sub-attribute at the path, or None and the index of the first level that isn't there."""
    level = instance
    for depth, sub in enumerate(path):
        found = level.get(sub) if _sub_attribute_name(sub) else None
        if not isinstance(found, dict):
            return None, depth
        level = found
    return level, len(path)


def _level_name(name: str, path: list[str]) -> str:
    return ".".join([name, *path])


def _merged_instance(name: str, instances: list[Any], fragment: dict[str, Any]) -> dict[str, Any]:
    wanted = fragment.get("datasetId")
    for instance in instances:
        if isinstance(instance, dict) and instance.get("datasetId") == wanted:
            _check_value(name, instance, fragment)
            return {**instance, **_stamped(instance, fragment)}
    raise not_found(f"{name} has no instance with that dataset.")
