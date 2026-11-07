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
"""The NGSI-LD query language (`q`), as `frontend/docs/data-interface.md` documents it.

The backend checks every expression before sending it, because the broker answers a syntax
error with an internal error. It also evaluates expressions itself where the broker can't: on
reconstructed entities, and for what `broker_can_evaluate` says no to. Patterns run on RE2, whose
time is linear in the text, so that no pattern can hold up the backend.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import re2

from app.errors import invalid

_COMPARISONS = ("==", "!=", ">=", "<=", "!~=", "~=", ">", "<")
_TOKEN = re.compile(r"[A-Za-z_@][\w@:/#%+.\-]*")
_PLAIN_KEY = re.compile(r"[A-Za-z_@][\w@:\-]*")
# Identifiers, numbers, ranges and dates. Anything else has to be quoted.
_BARE_VALUE = re.compile(r"[\w:/#%+.\-@~* ]+")
_NUMBER = re.compile(r"-?\d+(\.\d+)?")
_RANGE = re.compile(r"(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)")
_HAS_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:")
_NEXT_IRI = re.compile(r"\.(?=[A-Za-z][A-Za-z0-9+\-]*:)")
MAX_PATTERN = 200


@dataclass(frozen=True)
class Path:
    attribute: str
    subs: tuple[str, ...] = ()
    key: str | None = None


@dataclass(frozen=True)
class Comparison:
    path: Path
    op: str  # one of _COMPARISONS, `exists` or `missing`
    value: Any = None


@dataclass(frozen=True)
class Combined:
    op: str  # `and` or `or`
    terms: tuple[Any, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ValueRange:
    low: float
    high: float


@dataclass(frozen=True)
class ValueList:
    items: tuple[Any, ...]


class _Parser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.at = 0

    def fail(self, what: str) -> None:
        raise invalid(f"The query expression is not valid: {what} at position {self.at + 1}.")

    def peek(self) -> str:
        return self.text[self.at] if self.at < len(self.text) else ""

    def blanks(self) -> None:
        while self.peek() == " ":
            self.at += 1

    def expression(self) -> Any:
        terms = [self.conjunction()]
        self.blanks()
        while self.peek() == "|":
            self.at += 1
            terms.append(self.conjunction())
            self.blanks()
        return terms[0] if len(terms) == 1 else Combined("or", tuple(terms))

    def conjunction(self) -> Any:
        terms = [self.term()]
        self.blanks()
        while self.peek() == ";":
            self.at += 1
            terms.append(self.term())
            self.blanks()
        return terms[0] if len(terms) == 1 else Combined("and", tuple(terms))

    def term(self) -> Any:
        self.blanks()
        if self.peek() == "(":
            self.at += 1
            inner = self.expression()
            self.blanks()
            if self.peek() != ")":
                self.fail('missing ")"')
            self.at += 1
            return inner
        if self.peek() == "!":
            self.at += 1
            return Comparison(self.path(), "missing")
        path = self.path()
        self.blanks()
        for op in _COMPARISONS:
            if self.text.startswith(op, self.at):
                self.at += len(op)
                self.blanks()
                return Comparison(path, op, self.value())
        return Comparison(path, "exists")

    def path(self) -> Path:
        match = _TOKEN.match(self.text, self.at)
        if not match:
            self.fail("expected an attribute name")
        self.at = match.end()
        token = match.group()
        # In an IRI, a dot is usually part of the host. Only a dot before another IRI separates a sub-attribute.
        parts = _NEXT_IRI.split(token) if _HAS_SCHEME.match(token) else token.split(".")
        if not all(parts):
            self.at = match.start()
            self.fail("expected an attribute name")
        key = None
        if self.peek() == "[":
            self.at += 1
            found = _PLAIN_KEY.match(self.text, self.at)
            if not found:
                self.fail("expected a key")
            key = found.group()
            self.at = found.end()
            if self.peek() != "]":
                self.fail('missing "]"')
            self.at += 1
        return Path(parts[0], tuple(parts[1:]), key)

    def single(self) -> Any:
        self.blanks()
        if self.peek() == '"':
            self.at += 1
            out: list[str] = []
            while self.at < len(self.text) and self.text[self.at] != '"':
                if self.text[self.at] == "\\" and self.at + 1 < len(self.text):
                    self.at += 1
                out.append(self.text[self.at])
                self.at += 1
            if self.peek() != '"':
                self.fail("unterminated text value")
            self.at += 1
            return "".join(out)
        match = _BARE_VALUE.match(self.text, self.at)
        if not match or not match.group().strip():
            self.fail("expected a value")
        self.at = match.end()
        raw = match.group().strip()
        if raw in ("true", "false"):
            return raw == "true"
        return float(raw) if _NUMBER.fullmatch(raw) else raw

    def value(self) -> Any:
        first = self.single()
        if isinstance(first, str) and (span := _RANGE.fullmatch(first)):
            return ValueRange(float(span[1]), float(span[2]))
        items = [first]
        while self.peek() == ",":
            self.at += 1
            items.append(self.single())
        return first if len(items) == 1 else ValueList(tuple(items))


def parse(text: str | None) -> Any:
    """The expression's tree, or None when it is empty. Raises `invalid` with the position."""
    if not text or not text.strip():
        return None
    parser = _Parser(text)
    tree = parser.expression()
    parser.blanks()
    if parser.at < len(text):
        parser.fail(f'unexpected "{text[parser.at]}"')
    _check_patterns(tree)
    return tree


@lru_cache(maxsize=256)
def _compiled(pattern: str) -> Any:
    options = re2.Options()
    options.log_errors = False
    return re2.compile(pattern, options)


def compile_pattern(pattern: str, what: str) -> Any:
    if len(pattern) > MAX_PATTERN:
        raise invalid(f"{what} is longer than {MAX_PATTERN} characters.")
    try:
        return _compiled(pattern)
    except re2.error:
        raise invalid(
            f'{what} "{pattern}" is not a valid regular expression, or it needs look-around or back-references.'
        ) from None


def _check_patterns(tree: Any) -> None:
    if isinstance(tree, Combined):
        for term in tree.terms:
            _check_patterns(term)
    elif tree.op in ("~=", "!~="):
        compile_pattern(str(tree.value), "The pattern")


def broker_can_evaluate(tree: Any) -> bool:
    """Whether the broker answers this expression correctly. Measured on Scorpio 6.0.2.

    It refuses `~=`, `!~=` and ranges, fails on `!attr`, and silently finds nothing for an IRI with
    a dot, because it splits `q` paths at every dot.
    """
    if tree is None:
        return True
    if isinstance(tree, Combined):
        return all(broker_can_evaluate(term) for term in tree.terms)
    if tree.op in ("~=", "!~=", "missing") or isinstance(tree.value, ValueRange):
        return False
    if isinstance(tree.value, ValueList) and any(isinstance(item, ValueRange) for item in tree.value.items):
        return False
    names = (tree.path.attribute, *tree.path.subs)
    return not any(_HAS_SCHEME.match(name) and "." in name for name in names)


def _plain(instance: Any) -> list[Any]:
    """The values one attribute instance holds, for comparing."""
    if not isinstance(instance, dict):
        return []
    if instance.get("type") == "GeoProperty":
        return []
    for member in ("object", "vocab", "valueList", "json", "value"):
        if member in instance:
            value = instance[member]
            break
    else:
        languages = instance.get("languageMap")
        if not isinstance(languages, dict):
            return []
        value = list(languages.values())
    if isinstance(value, dict) and "@id" in value:
        value = value["@id"]
    return value if isinstance(value, list) else [value]


def _values(entity: dict[str, Any], path: Path) -> list[Any]:
    attribute = entity.get(path.attribute)
    found: list[Any] = []
    for instance in attribute if isinstance(attribute, list) else [attribute]:
        for sub in path.subs:
            instance = instance.get(sub) if isinstance(instance, dict) else None
        for value in _plain(instance):
            if path.key is not None:
                if not isinstance(value, dict) or path.key not in value:
                    continue
                value = value[path.key]
            found.append(value)
    return found


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _equal(a: Any, b: Any) -> bool:
    if isinstance(b, ValueRange):
        return _number(a) and b.low <= a <= b.high
    if isinstance(b, ValueList):
        return any(_equal(a, item) for item in b.items)
    return a == b if _number(a) and _number(b) else _text(a) == _text(b)


def _holds(a: Any, op: str, b: Any) -> bool:
    if op == "==":
        return _equal(a, b)
    if op == "!=":
        return not _equal(a, b)
    if op in ("~=", "!~="):
        found = compile_pattern(str(b), "The pattern").search(_text(a)) is not None
        return found == (op == "~=")
    same_kind = (_number(a) and _number(b)) or (isinstance(a, str) and isinstance(b, str))
    if not same_kind:
        return False
    return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b}[op]


def matches(entity: dict[str, Any], tree: Any) -> bool:
    if tree is None:
        return True
    if isinstance(tree, Combined):
        results = (matches(entity, term) for term in tree.terms)
        return all(results) if tree.op == "and" else any(results)
    present = tree.path.attribute in entity
    values = _values(entity, tree.path)
    deep = bool(tree.path.subs) or tree.path.key is not None
    if tree.op == "exists":
        return present and (bool(values) if deep else True)
    if tree.op == "missing":
        return not present or (deep and not values)
    if tree.op in ("!=", "!~="):
        return bool(values) and all(_holds(value, tree.op, tree.value) for value in values)
    return any(_holds(value, tree.op, tree.value) for value in values)
