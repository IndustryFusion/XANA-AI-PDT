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
"""Attribute history and entity lifecycle through PostgREST, in the platform's table layout.

`attributes` has one row per observation: `id` (unique per attribute and dataset), `parentId`,
`observedAt`, `entityId`, `attributeId`, `attributeType`, `datasetId`, `nodeType`, `value` as text,
`valueType`, `unitCode`, `lang` and `deleted`, which may be null. `entities` has `id`, `observedAt`,
`type` and `deleted`.

Values go into filters as parameters. Inside `or=(...)` and `in.(...)` they are always quoted,
as a comma or bracket would otherwise change the filter.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings
from app.errors import Refused, bad_gateway, invalid, unauthorized
from app.ngsi.broker import Limited
from app.ngsi.failures import reason_from, unreachable

SERVICE = "The history service (PostgREST)"
TIMEOUT_S = 15
MAX_ROWS = 5000
PAGE = 1000
MAX_ENTITY_ROWS = 100_000
MAX_PARENT_IDS = 100
DEFAULT_VOCAB = "https://uri.etsi.org/ngsi-ld/default-context/"
NOT_DELETED = "not.is.true"
ROW_COLUMNS = (
    "id,parentId,observedAt,attributeId,attributeType,datasetId,nodeType,value,valueType,unitCode,lang,deleted"
)
_HAS_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:")
_TEXT_TYPE = re.compile(r"(#|/)(string|anyURI)$")
_NUMBER_TEXT = re.compile(r"[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?")


def quoted(value: str) -> str:
    """A value for inside `or=(...)` and `in.(...)`."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def timestamp(text: str, what: str = "The time") -> str:
    """An ISO 8601 time in UTC. Anything else is refused, so that it can't add to a filter."""
    try:
        moment = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        raise invalid(f"{what} is not a valid date and time.") from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).isoformat()


def past_moment(text: str) -> str:
    moment = timestamp(text, "The moment")
    if datetime.fromisoformat(moment) > datetime.now(UTC):
        raise invalid("The moment must be in the past.")
    return moment


def typed_value(value: str | None, value_type: str | None, attribute_type: str | None = None) -> Any:
    """A stored text value as what it was. Relationships and declared text stay text."""
    if value is None or (attribute_type or "").endswith("Relationship"):
        return value
    declared = value_type or ""
    if _TEXT_TYPE.search(declared):
        return value
    if declared.endswith("boolean") and value in ("true", "false"):
        return value == "true"
    if _NUMBER_TEXT.fullmatch(value.strip()):
        number = float(value)
        return int(number) if number.is_integer() and "." not in value and "e" not in value.lower() else number
    return value


def attribute_filter(name: str) -> tuple[str, str]:
    """The filter for an attribute: exactly an IRI, or a short name at the end of one."""
    if _HAS_SCHEME.match(name):
        return ("attributeId", f"eq.{name}")
    if "*" in name:
        raise invalid("An attribute name can't hold *.")
    literal = name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    options = [f"attributeId.eq.{quoted(name)}"]
    options += [f"attributeId.like.{quoted(f'*{mark}{literal}')}" for mark in "/#"]
    return ("or", f"({','.join(options)})")


def compact(name: str) -> str:
    """A name as the broker shows it: the default context's prefix is left out."""
    return name.removeprefix(DEFAULT_VOCAB)


class AttributeHistory:
    def __init__(
        self,
        settings: Settings,
        token: Callable[[], str | None],
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._url = settings.pgrest_url.rstrip("/")
        self._attributes = settings.timescale_table
        self._entities = settings.timescale_entity_table
        self._token = token
        self._transport = transport

    async def read(self, table: str, params: list[tuple[str, str | int]]) -> list[dict[str, Any]]:
        schema, _, name = table.rpartition(".")
        headers = {"Accept": "application/json"}
        if schema:
            headers["Accept-Profile"] = schema
        if token := self._token():
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.get(f"{self._url}/{name}", params=params, headers=headers)
        except httpx.HTTPError as error:
            raise unreachable(SERVICE, error) from None
        if response.status_code >= 400:
            raise _refusal(response)
        try:
            rows = response.json()
        except ValueError:
            raise bad_gateway(f"{SERVICE} sent an answer that isn't JSON.") from None
        if not isinstance(rows, list):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return rows

    async def values(
        self,
        entity_id: str,
        attribute: str,
        start: str | None = None,
        end: str | None = None,
        dataset_id: str | None = None,
        path: list[str] | None = None,
    ) -> Limited:
        """Values oldest first, the newest `MAX_ROWS` of them, saying so if there may be more.

        With `path`, the values of the sub-attribute at that path of names below the attribute.
        """
        parents: list[str] | None = None
        if path:
            parents = await self._parent_ids(entity_id, [attribute, *path[:-1]], dataset_id)
            if not parents:
                return Limited()
        params: list[tuple[str, str | int]] = [
            ("entityId", f"eq.{entity_id}"),
            attribute_filter(path[-1] if path else attribute),
            ("deleted", NOT_DELETED),
            ("select", "observedAt,value,valueType,attributeType,datasetId"),
            ("order", "observedAt.desc"),
            ("limit", MAX_ROWS),
        ]
        if start:
            params.append(("observedAt", f"gte.{timestamp(start, 'The start of the range')}"))
        if end:
            params.append(("observedAt", f"lte.{timestamp(end, 'The end of the range')}"))
        if parents is not None:
            # The dataset named is the attribute's, so it was applied at the top level.
            rows = await self.read(self._attributes, [*params, ("parentId", _any_of(parents))])
        else:
            if dataset_id:
                params.append(("datasetId", f"eq.{dataset_id}"))
            # A sub-attribute may share its name with an attribute, which then comes first.
            rows = await self.read(self._attributes, [*params, ("parentId", "is.null")])
            if not rows:
                rows = await self.read(self._attributes, params)
        points = Limited()
        if len(rows) >= MAX_ROWS:
            points.limited = {"newest": MAX_ROWS}
        for row in reversed(rows):
            point = {
                "at": row.get("observedAt"),
                "value": typed_value(row.get("value"), row.get("valueType"), row.get("attributeType")),
            }
            if row.get("datasetId") not in (None, "@none"):
                point["datasetId"] = row["datasetId"]
            points.append(point)
        return points

    async def _parent_ids(self, entity_id: str, names: list[str], dataset_id: str | None) -> list[str]:
        """The row ids of the last of the names, found level by level from the top-level attribute."""
        ids: list[str] | None = None
        for name in names:
            condition = ("parentId", "is.null") if ids is None else ("parentId", _any_of(ids))
            params: list[tuple[str, str | int]] = [("entityId", f"eq.{entity_id}"), attribute_filter(name), condition]
            if ids is None and dataset_id:
                params.append(("datasetId", f"eq.{dataset_id}"))
            ids = await self._distinct_ids(params)
            if not ids:
                return []
        return ids or []

    async def _distinct_ids(self, params: list[tuple[str, str | int]]) -> list[str]:
        """Each `id` once. A row per observation shares its `id`, so reading goes on past the last one seen."""
        found: list[str] = []
        while True:
            asked = [*params, ("select", "id"), ("order", "id.asc"), ("limit", PAGE)]
            if found:
                asked.append(("id", f"gt.{found[-1]}"))
            rows = await self.read(self._attributes, asked)
            for row in rows:
                if isinstance(row.get("id"), str) and (not found or row["id"] != found[-1]):
                    found.append(row["id"])
            if len(found) > MAX_PARENT_IDS:
                raise bad_gateway(
                    f"{SERVICE} holds more than {MAX_PARENT_IDS} instances of one sub-attribute's parent."
                )
            if len(rows) < PAGE:
                return found

    async def status(self, entity_id: str) -> dict[str, dict[str, Any]]:
        """The latest recorded state per attribute, under the name the store holds."""
        latest: dict[str, dict[str, Any]] = {}
        after: str | None = None
        while True:
            params: list[tuple[str, str | int]] = [
                ("entityId", f"eq.{entity_id}"),
                ("parentId", "is.null"),
                ("select", "attributeId,deleted,observedAt"),
                ("order", "attributeId.asc,observedAt.desc"),
                ("limit", PAGE),
            ]
            if after is not None:
                params.append(("attributeId", f"gt.{after}"))
            rows = await self.read(self._attributes, params)
            for row in rows:
                name = row.get("attributeId")
                if name not in latest:
                    latest[name] = {"deleted": row.get("deleted") is True, "observedAt": row.get("observedAt")}
            if len(rows) < PAGE:
                return {compact(name): state for name, state in latest.items()}
            after = rows[-1]["attributeId"]

    # Time-shift ---------------------------------------------------------------

    async def entities_at(self, moment: str) -> list[dict[str, Any]]:
        """Entities that existed at the moment: `{id, type}`, by ID."""
        latest: dict[str, dict[str, Any]] = {}
        for offset in range(0, MAX_ENTITY_ROWS, PAGE):
            rows = await self.read(
                self._entities,
                [
                    ("observedAt", f"lte.{moment}"),
                    ("select", "id,type,deleted"),
                    ("order", "id.asc,observedAt.desc"),
                    ("limit", PAGE),
                    ("offset", offset),
                ],
            )
            for row in rows:
                latest.setdefault(row.get("id"), row)
            if len(rows) < PAGE:
                break
        else:
            raise bad_gateway(f"{SERVICE} holds more than {MAX_ENTITY_ROWS} entity rows up to this moment.")
        return [
            {"id": row["id"], "type": compact(row.get("type") or "")}
            for row in latest.values()
            if row.get("deleted") is not True
        ]

    async def rows_at(self, entity_id: str, moment: str) -> list[dict[str, Any]]:
        """The latest row per attribute and dataset up to the moment.

        Rows of one `id` are in a block, newest first. Continuing past the last `id` seen means
        that a signal with thousands of rows costs one request.
        """
        latest: dict[str, dict[str, Any]] = {}
        after: str | None = None
        while True:
            params: list[tuple[str, str | int]] = [
                ("entityId", f"eq.{entity_id}"),
                ("observedAt", f"lte.{moment}"),
                (
                    "select",
                    "id,parentId,observedAt,attributeId,attributeType,datasetId,nodeType,value,valueType,unitCode,lang,deleted",
                ),
                ("order", "id.asc,observedAt.desc"),
                ("limit", PAGE),
            ]
            if after is not None:
                params.append(("id", f"gt.{after}"))
            rows = await self.read(self._attributes, params)
            for row in rows:
                latest.setdefault(row.get("id"), row)
            if len(rows) < PAGE:
                return list(latest.values())
            after = rows[-1]["id"]


def _refusal(response: httpx.Response) -> Refused:
    status = response.status_code
    if status in (401, 403):
        return unauthorized(f"{SERVICE} refused the request (HTTP {status}); check the operator's sign-in and roles.")
    if status == 404:
        return bad_gateway(f"{SERVICE} doesn't offer the history table.")
    if status >= 500:
        return bad_gateway(f"{SERVICE} failed (HTTP {status}).")
    reason = reason_from(response)
    return invalid(f"{SERVICE} refused the request: {reason}" if reason else f"{SERVICE} answered HTTP {status}.")


def _any_of(ids: list[str]) -> str:
    return f"in.({','.join(quoted(i) for i in ids)})"


def parsed_json(value: str | None) -> Any:
    try:
        return json.loads(value) if value is not None else None
    except ValueError:
        return value
