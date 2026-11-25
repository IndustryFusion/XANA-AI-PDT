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
"""Where an entity refers to another one: the reverse of following a relationship."""

from __future__ import annotations

from typing import Any

_ENTITY_MEMBERS = {"id", "type", "@context", "scope", "createdAt", "modifiedAt", "deletedAt"}
_VALUE_MEMBERS = {
    "type",
    "value",
    "object",
    "objectList",
    "json",
    "languageMap",
    "valueList",
    "vocab",
    "observedAt",
    "unitCode",
    "datasetId",
    "lang",
    "createdAt",
    "modifiedAt",
    "deletedAt",
    "instanceId",
    "objectType",
    "previousValue",
    "previousObject",
}


def _iri(value: dict[str, Any]) -> Any:
    """The IRI of an IRI object: Scorpio answers `{"@id": …}` as `{"id": …}`, as its core context names it. An
    object with more than an `id` is a value of its own kind."""
    return value["id"] if list(value) == ["id"] else value.get("@id")


def _targets(instance: dict[str, Any]) -> list[Any]:
    """What an attribute instance points to: a relationship's objects, or the IRI a property holds."""
    found: list[Any] = []
    for member in ("object", "objectList", "value"):
        value = instance.get(member)
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, dict):
                item = item.get("object") if member == "objectList" else _iri(item)
            found.append(item)
    return found


def references(entity: dict[str, Any], target: str) -> list[dict[str, Any]]:
    """The places where the entity refers to `target`, in its own order: the path of attribute names down to
    each, and the dataset of the attribute's instance when it has one. An attribute is a place of its own per
    dataset; sub-attributes count at any depth (the broker's documents are never deep)."""
    found: list[dict[str, Any]] = []

    def visit(attribute: Any, path: list[str], dataset: str | None) -> None:
        for instance in attribute if isinstance(attribute, list) else [attribute]:
            if not isinstance(instance, dict):
                continue
            own = instance.get("datasetId", dataset) if len(path) == 1 else dataset
            if target in _targets(instance):
                place: dict[str, Any] = {"path": path}
                if own:
                    place["datasetId"] = own
                if place not in found:
                    found.append(place)
            for name, below in instance.items():
                if name not in _VALUE_MEMBERS:
                    visit(below, [*path, name], own)

    for name, attribute in entity.items():
        if name not in _ENTITY_MEMBERS:
            visit(attribute, [name], None)
    return found
