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
"""Declared NGSI-LD values read as their values (#84, gh-84-read-declared-values).

The IFF Digital Twin platform declares its doubles, and the context broker
returns such a value as a JSON-LD value object, its `@type` compacted to
`type`: ``{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}``.
The broker's merge keeps the stored type and replaces only `@value`, so a live
value can come back as ``{"type": "…#double", "@value": "42.5"}``; a replacing
update drops the type again. Every form is read the same way here: a value
object as its `@value`, a number string under a numeric datatype as that number,
anything else -- plain values, IRI references, language maps -- as it is.
"""
from __future__ import annotations

from typing import Any

XSD = "http://www.w3.org/2001/XMLSchema#"
_INTEGERS = {"integer", "int", "long", "short", "byte", "nonNegativeInteger", "positiveInteger",
             "nonPositiveInteger", "negativeInteger", "unsignedLong", "unsignedInt",
             "unsignedShort", "unsignedByte"}
_DECIMALS = {"double", "float", "decimal"}
_VALUE_OBJECT_KEYS = {"@value", "@type", "type", "@language"}


def _local(datatype: Any) -> str | None:
    """`double` for the XSD double, however it is written; None for anything else."""
    if not isinstance(datatype, str):
        return None
    if datatype.startswith(XSD):
        return datatype[len(XSD):]
    if datatype.startswith("xsd:"):
        return datatype[4:]
    return None


def is_value_object(value: Any) -> bool:
    """A JSON-LD value object: `@value`, with at most a datatype or a language beside it."""
    return isinstance(value, dict) and "@value" in value and not set(value) - _VALUE_OBJECT_KEYS


def datatype(value: Any) -> str | None:
    """The datatype a value object declares, as a full IRI where it is an XSD type."""
    if not is_value_object(value):
        return None
    declared = value.get("@type") or value.get("type")
    local = _local(declared)
    return XSD + local if local else declared


def literal(value: Any) -> Any:
    """`value` as its plain value: a declared value as its `@value`, coerced to a
    number (or a boolean) when it is written as a string under such a datatype."""
    if not is_value_object(value):
        return value
    inner = value["@value"]
    if not isinstance(inner, str):
        return inner
    local = _local(value.get("@type") or value.get("type"))
    text = inner.strip()
    try:
        if local in _INTEGERS:
            return int(text)
        if local in _DECIMALS:
            return float(text)
    except ValueError:
        return inner
    if local == "boolean" and text.lower() in ("true", "false"):
        return text.lower() == "true"
    return inner


def declared(number: Any, like: Any) -> Any:
    """`number` declared with the datatype of `like`, when `like` is a declared value;
    else `number` as it is. Used to keep a value's datatype on an edit."""
    stored = datatype(like)
    if stored is None or isinstance(number, bool) or not isinstance(number, int | float):
        return number
    return {"@value": number, "@type": stored}
