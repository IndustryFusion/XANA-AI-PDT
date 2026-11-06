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
"""Entities as they were at a past moment, reconstructed from the history tables."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.errors import invalid
from app.ngsi.broker import MAX_LIMIT
from app.ngsi.history import AttributeHistory, compact, parsed_json, past_moment, typed_value
from app.ngsi.query import compile_pattern, matches, parse

CONCURRENT = 8
_MEMBER = {
    "Relationship": "object",
    "GeoProperty": "value",
    "JsonProperty": "json",
    "ListProperty": "valueList",
    "LanguageProperty": "languageMap",
    "VocabularyProperty": "vocab",
}
_PARSED = {"GeoProperty", "JsonProperty", "ListProperty", "LanguageProperty"}


def _attribute(row: dict[str, Any]) -> dict[str, Any]:
    kind = re.split(r"[/#]", row.get("attributeType") or "Property")[-1]
    raw = row.get("value")
    attribute: dict[str, Any] = {"type": kind}
    if kind in _PARSED:
        attribute[_MEMBER[kind]] = parsed_json(raw)
    elif kind in _MEMBER:
        attribute[_MEMBER[kind]] = raw
    elif row.get("nodeType") == "@id":
        attribute["value"] = {"@id": raw}
    else:
        attribute["value"] = typed_value(raw, row.get("valueType"), kind)
    attribute["observedAt"] = row.get("observedAt")
    if row.get("unitCode"):
        attribute["unitCode"] = row["unitCode"]
    if row.get("lang"):
        attribute["lang"] = row["lang"]
    if row.get("datasetId") not in (None, "@none"):
        attribute["datasetId"] = row["datasetId"]
    return attribute


def _add(holder: dict[str, Any], name: str, attribute: dict[str, Any]) -> None:
    """Several datasets of one name become a list, as the broker shows them."""
    if name not in holder:
        holder[name] = attribute
    elif isinstance(holder[name], list):
        holder[name].append(attribute)
    else:
        holder[name] = [holder[name], attribute]


def rebuild(entity_id: str, entity_type: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """An entity from the latest row per attribute. Deleted rows drop out, with what hangs below them."""
    live = {row.get("id"): row for row in rows if row.get("deleted") is not True}
    children: dict[str, list[dict[str, Any]]] = {}
    for row in live.values():
        children.setdefault(row.get("parentId"), []).append(row)

    def attach(holder: dict[str, Any], parent: str | None) -> None:
        for row in sorted(
            children.get(parent, []), key=lambda r: (r.get("attributeId") or "", r.get("datasetId") or "")
        ):
            attribute = _attribute(row)
            attach(attribute, row.get("id"))
            _add(holder, compact(row.get("attributeId") or ""), attribute)

    entity: dict[str, Any] = {"id": entity_id, "type": entity_type}
    attach(entity, None)
    return entity


class TimeShift:
    def __init__(self, history: AttributeHistory) -> None:
        self._history = history

    async def types(self, at: str) -> list[str]:
        return sorted({entity["type"] for entity in await self._history.entities_at(past_moment(at))})

    async def query(
        self,
        at: str,
        *,
        entity_type: str | None = None,
        entity_id: str | None = None,
        id_pattern: str | None = None,
        q: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        moment = past_moment(at)
        if not 1 <= limit <= MAX_LIMIT:
            raise invalid(f"The limit must be a whole number from 1 to {MAX_LIMIT}.")
        tree = parse(q)
        pattern = compile_pattern(id_pattern, "The ID pattern") if id_pattern else None
        types = {compact(t.strip()) for t in entity_type.split(",") if t.strip()} if entity_type else None
        ids = {i.strip() for i in entity_id.split(",") if i.strip()} if entity_id else None
        candidates = [
            entity
            for entity in sorted(await self._history.entities_at(moment), key=lambda e: e["id"])
            if (types is None or entity["type"] in types)
            and (ids is None or entity["id"] in ids)
            and (pattern is None or pattern.search(entity["id"]))
        ]
        slots = asyncio.Semaphore(CONCURRENT)

        async def built(entity: dict[str, Any]) -> dict[str, Any]:
            async with slots:
                return rebuild(entity["id"], entity["type"], await self._history.rows_at(entity["id"], moment))

        found: list[dict[str, Any]] = []
        for start in range(0, len(candidates), CONCURRENT):
            batch = await asyncio.gather(*(built(e) for e in candidates[start : start + CONCURRENT]))
            found.extend(entity for entity in batch if matches(entity, tree))
            if len(found) >= limit:
                break
        return found[:limit]
