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
"""Context source over the NGSI-LD API of a context broker. Only GET requests are sent."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

import httpx

from xana_agent.sources.base import SourceUnavailable

ENTITIES = "/ngsi-ld/v1/entities"
DEFAULT_INVERSE_RELATIONSHIPS = ("partOf", "measures")


class NgsiContextSource:
    """Reads entities from an NGSI-LD context broker.

    `inverse_relationships` names the relationships through which other entities
    point to a machine (for example a component's `partOf`); NGSI-LD has no query
    for "any relationship pointing here".
    """

    def __init__(
        self,
        url: str,
        tenant: str | None = None,
        timeout_s: float = 10,
        inverse_relationships: tuple[str, ...] = DEFAULT_INVERSE_RELATIONSHIPS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"Accept": "application/json"}
        if tenant:
            headers["NGSILD-Tenant"] = tenant
        self._client_args: dict[str, Any] = {
            "base_url": url.rstrip("/"),
            "headers": headers,
            "timeout": timeout_s,
            "transport": transport,
        }
        self.inverse_relationships = inverse_relationships

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response | None:
        try:
            async with httpx.AsyncClient(**self._client_args) as client:
                response = await client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise SourceUnavailable(f"Context broker not reachable ({type(exc).__name__}).") from None
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise SourceUnavailable(f"Context broker answered HTTP {response.status_code}.")
        return response

    async def get(self, entity_id: str) -> dict[str, Any] | None:
        response = await self._get(f"{ENTITIES}/{quote(entity_id, safe=':')}")
        return _json(response) if response is not None else None

    async def query(self, q: str, limit: int) -> list[dict[str, Any]]:
        response = await self._get(ENTITIES, {"q": q, "limit": limit})
        result = _json(response) if response is not None else []
        return result if isinstance(result, list) else []

    async def related(self, entity: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        own_id = entity["id"]
        found: dict[str, dict[str, Any]] = {}
        for target in relationship_objects(entity):
            if len(found) >= limit:
                break
            if target != own_id and target not in found and (other := await self.get(target)) is not None:
                found[target] = other
        for name in self.inverse_relationships:
            if len(found) >= limit:
                break
            for other in await self.query(f"{name}=={json.dumps(own_id)}", limit):
                if other.get("id") not in (own_id, None):
                    found.setdefault(other["id"], other)
        return list(found.values())[:limit]


def relationship_objects(entity: dict[str, Any]) -> list[str]:
    """IDs that the entity's top-level Relationship attributes point to."""
    targets: list[str] = []
    for value in entity.values():
        for attribute in value if isinstance(value, list) else [value]:
            if isinstance(attribute, dict) and attribute.get("type") == "Relationship":
                objects = attribute.get("object")
                for target in objects if isinstance(objects, list) else [objects]:
                    if isinstance(target, str) and target not in targets:
                        targets.append(target)
    return targets


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        raise SourceUnavailable("Context broker answered with invalid JSON.") from None
