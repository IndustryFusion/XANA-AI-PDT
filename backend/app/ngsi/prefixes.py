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
"""The prefixes that the configured JSON-LD context defines, for short names in the explorer.

Only `NGSI_CONTEXT_URL` is read: it comes from the configuration, so it may be an internal address.
The remote contexts it names are followed, depth-first, up to `MAX_LEVELS` levels and `MAX_DOCUMENTS`
documents in all, and only as the URL import would fetch them: http(s), and never an internal address.

A failure gives no prefixes and a reason, which holds neither an address nor a token.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.errors import Refused
from app.ngsi.failures import scrubbed
from app.ngsi.fetch import REFUSED, Resolver, fetch_document, resolve

CACHE_S = 600
MAX_LEVELS = 2
MAX_DOCUMENTS = 8
_IRI = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*:\S+")
NO_CONTEXT = "The configured context is not an http(s) address."
NOT_A_CONTEXT = "The configured context is not a JSON-LD context."
NOT_READ = "The configured context could not be read"
REMOTE_NOT_READ = "A context that the configured context names was not read"


class ContextPrefixes:
    def __init__(
        self,
        context_url: str | None,
        transport: httpx.AsyncBaseTransport | None = None,
        resolver: Resolver = resolve,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = (context_url or "").strip() or None
        self._transport = transport
        self._resolver = resolver
        self._clock = clock
        self._cached: tuple[float, dict[str, Any]] | None = None
        self._lock = asyncio.Lock()

    async def prefixes(self) -> dict[str, Any]:
        """`{prefixes: [{prefix, namespace}], detail}`, read at most once per `CACHE_S`."""
        if self._url is None:
            return {"prefixes": [], "detail": None}
        async with self._lock:
            if self._cached is None or self._clock() - self._cached[0] >= CACHE_S:
                self._cached = (self._clock(), await self._read())
            return self._cached[1]

    async def _read(self) -> dict[str, Any]:
        if urlsplit(self._url).scheme not in ("http", "https"):
            return {"prefixes": [], "detail": NO_CONTEXT}
        try:
            document = await self.fetch(self._url, public_only=False)
        except Refused as refused:
            return {"prefixes": [], "detail": f"{NOT_READ}: {scrubbed(refused.message)}"}
        if not isinstance(document, dict) or "@context" not in document:
            return {"prefixes": [], "detail": NOT_A_CONTEXT}
        reading = _Reading(self, self._url)
        await reading.context(document["@context"], self._url, 0)
        found = sorted(reading.terms.items())
        return {"prefixes": [{"prefix": p, "namespace": n} for p, n in found], "detail": reading.problem}

    async def fetch(self, url: str, public_only: bool) -> Any:
        answer = await fetch_document(url, self._resolver, self._transport, public_only=public_only)
        return answer["document"]


class _Reading:
    """One walk through the context and the remote contexts it names, in the order they apply."""

    def __init__(self, owner: ContextPrefixes, url: str) -> None:
        self._owner = owner
        self._seen = {url}
        self.terms: dict[str, str] = {}
        self.problem: str | None = None

    async def context(self, context: Any, base: str, level: int) -> None:
        for item in context if isinstance(context, list) else [context]:
            if isinstance(item, dict):
                self._definitions(item)
            elif isinstance(item, str):
                await self._remote(urljoin(base, item), level + 1)

    async def _remote(self, url: str, level: int) -> None:
        if level > MAX_LEVELS or len(self._seen) >= MAX_DOCUMENTS or url in self._seen:
            return
        self._seen.add(url)
        if urlsplit(url).scheme not in ("http", "https"):
            self._missed("it is not an http(s) address.")
            return
        try:
            document = await self._owner.fetch(url, public_only=True)
        except Refused as refused:
            internal = refused.message == REFUSED
            self._missed("it is an internal address." if internal else scrubbed(refused.message))
            return
        if not isinstance(document, dict) or "@context" not in document:
            self._missed("it is not a JSON-LD context.")
            return
        await self.context(document["@context"], url, level)

    def _definitions(self, definitions: dict[str, Any]) -> None:
        for term, value in definitions.items():
            if term.startswith("@") or ":" in term:
                continue
            namespace = value.get("@id") if isinstance(value, dict) else value
            # A later definition of a term replaces an earlier one, as in JSON-LD.
            if isinstance(namespace, str) and _IRI.fullmatch(namespace) and namespace.endswith(("/", "#")):
                self.terms[term] = namespace
            else:
                self.terms.pop(term, None)

    def _missed(self, why: str) -> None:
        if self.problem is None:
            self.problem = f"{REMOTE_NOT_READ}: {why}"
