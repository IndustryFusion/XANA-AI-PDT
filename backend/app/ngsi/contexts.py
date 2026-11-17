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
"""The JSON-LD contexts an imported entity may name.

The context broker fetches a context named by URL itself, from inside the platform and unchecked, so
only allowed ones are let through: the NGSI-LD core context; the built-in ones, such as the IFF
contexts on GitHub; the deployment's (`NGSI_CONTEXT_URL`, `NGSI_ALLOWED_CONTEXTS`); and those an
operator added in the System area, kept in the memory database. An entry ending in `/` allows every
context below it.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import unquote, urlsplit

from app.errors import invalid, not_found, unavailable
from app.memory.store import Database
from app.ngsi.fetch import Resolver, is_public, resolve

log = logging.getLogger(__name__)

CORE_CONTEXT = re.compile(r"https://uri\.etsi\.org/ngsi-ld/v1/ngsi-ld-core-context(-v[0-9.]+)?\.jsonld")
CORE_LABEL = "https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context*.jsonld"
# Maintained here: contexts of the IFF platform and its tools.
BUILT_IN: tuple[str, ...] = ("https://industryfusion.github.io/contexts/",)
MAX_URL = 2000
# The added ones are read again at most this often, so another backend's change shows up.
FRESH_S = 30.0

UNENCRYPTED = "It is plain http: anyone on the way can change what the broker gets."
INTERNAL = (
    "It is, or resolves to, an address inside the network: the broker would fetch from a service of "
    "the platform or the network around it."
)
UNRESOLVED = "Its host can't be resolved from here, so where it points can't be checked."


def deployment_contexts(settings: Any) -> list[str]:
    """The contexts the deployment allows: its configured context and `NGSI_ALLOWED_CONTEXTS`."""
    listed = [url.strip() for url in (settings.ngsi_allowed_contexts or "").split(",") if url.strip()]
    return [settings.ngsi_context_url, *listed] if settings.ngsi_context_url else listed


async def _always_ready() -> None:
    return None


def _dot_segments(url: str) -> bool:
    """Whether the URL's path has a `.` or `..` segment, plain or percent-encoded, which would lead a
    fetch somewhere else than the text says."""
    try:
        path = urlsplit(url).path
    except ValueError:
        return True
    return any(segment in (".", "..") for segment in unquote(path).replace("\\", "/").split("/"))


def allows(entry: str, url: str) -> bool:
    """An entry allows the same URL, or, ending in `/`, every URL below it: one without `.` or `..`
    segments, so that nothing above the entry can be reached through it."""
    return url == entry or (entry.endswith("/") and url.startswith(entry) and not _dot_segments(url))


class ContextAllowList:
    def __init__(
        self,
        db: Database | None,
        deployment: list[str],
        ready: Callable[[], Awaitable[None]] = _always_ready,
        resolver: Resolver = resolve,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._db = db
        self._ready = ready
        self._deployment = [url for url in dict.fromkeys(deployment) if url]
        self._resolver = resolver
        self._clock = clock
        self._added: list[str] = []
        self._read_at: float | None = None
        self._problem: str | None = None
        # One read at a time, and a read that overlapped a change here counts as stale: it must not
        # put back what the change removed, or hold back what it added.
        self._reading = asyncio.Lock()
        self._changes = 0

    # Checking -----------------------------------------------------------------------------

    def allowed(self, url: str) -> bool:
        if CORE_CONTEXT.fullmatch(url):
            return True
        return any(allows(entry, url) for entry in (*BUILT_IN, *self._deployment, *self._added))

    async def refresh(self) -> None:
        """Reads the added contexts, at most every `FRESH_S`. When the database can't be read, the
        ones read last stay in force, and the problem is reported with the list."""
        if self._db is None:
            return
        async with self._reading:
            if self._read_at is not None and self._clock() - self._read_at < FRESH_S:
                return
            await self._read()

    async def _read(self) -> None:
        changes = self._changes
        try:
            await self._ready()
            async with self._db.transaction() as conn:
                cur = await conn.execute("SELECT url FROM allowed_contexts ORDER BY url")
                rows = await cur.fetchall()
            self._added = [row["url"] for row in rows]
            self._problem = None
        except Exception as error:  # noqa: BLE001 - the store is optional; the others still apply
            log.warning("The allowed contexts could not be read: %s", type(error).__name__)
            self._problem = "The contexts added here can't be read right now; the others apply."
        self._read_at = self._clock() if changes == self._changes else None

    # The list -----------------------------------------------------------------------------

    async def entries(self) -> dict[str, Any]:
        await self.refresh()
        listed = [{"url": CORE_LABEL, "source": "core", "removable": False}]
        listed += [{"url": url, "source": "built_in", "removable": False} for url in BUILT_IN]
        listed += [{"url": url, "source": "deployment", "removable": False} for url in self._deployment]
        listed += [{"url": url, "source": "added", "removable": True} for url in self._added]
        return {"contexts": listed, "editable": self._db is not None, "detail": self._problem}

    async def risks(self, url: str) -> list[str]:
        """What allowing the URL risks, beyond trusting whoever controls it."""
        host = _checked(url)
        found = [UNENCRYPTED] if url.startswith("http://") else []
        try:
            addresses = await self._resolver(host, 443)
        except (OSError, UnicodeError):
            return [*found, UNRESOLVED]
        if not addresses or not all(is_public(address) for address in addresses):
            found.append(INTERNAL)
        return found

    async def add(self, url: str, by: str | None) -> dict[str, Any]:
        url = url.strip()
        _checked(url)
        if self.allowed(url):
            raise invalid("That context is allowed already.")
        if self._db is None:
            raise unavailable("Contexts can't be added here: the backend has no memory database.")
        try:
            await self._ready()
            async with self._db.transaction() as conn:
                await conn.execute(
                    "INSERT INTO allowed_contexts (url, added_by) VALUES (%s, %s) ON CONFLICT (url) DO NOTHING",
                    (url, by),
                )
        except Exception as error:  # noqa: BLE001 - said as unavailable, without the database's message
            log.warning("A context could not be added: %s", type(error).__name__)
            raise unavailable("The memory database can't be used right now.") from None
        log.info("A context was allowed for import.")
        self._changes += 1
        self._read_at = None
        return await self.entries()

    async def remove(self, url: str) -> dict[str, Any]:
        if self._db is None:
            raise unavailable("Contexts can't be removed here: the backend has no memory database.")
        try:
            await self._ready()
            async with self._db.transaction() as conn:
                cur = await conn.execute("DELETE FROM allowed_contexts WHERE url = %s", (url.strip(),))
                removed = cur.rowcount
        except Exception as error:  # noqa: BLE001 - said as unavailable, without the database's message
            log.warning("A context could not be removed: %s", type(error).__name__)
            raise unavailable("The memory database can't be used right now.") from None
        self._changes += 1
        self._read_at = None
        if not removed:
            raise not_found("That context isn't among the ones added here.")
        return await self.entries()


_INTERNAL_SUFFIXES = (".local", ".internal", ".svc", ".cluster.local", ".lan", ".home", "localhost")


def looks_external(url: str) -> bool:
    """Whether a refused context's URL may be repeated to the caller: not an address that tells about
    the platform's inside, such as a private IP, a name without a dot or a cluster-internal name."""
    try:
        # A name or address with the root's dot, `localhost.` or `10.0.0.5.`, is the same host.
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    if not host or any(c.isspace() for c in url):
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return "." in host and not host.endswith(_INTERNAL_SUFFIXES)
    return is_public(host)


def _checked(url: str) -> str:
    """The URL's host; refuses anything but a plain http(s) URL."""
    if not isinstance(url, str) or len(url) > MAX_URL:
        raise invalid("Enter a complete URL, for example https://…")
    try:
        parts = urlsplit(url.strip())
        parts.port  # noqa: B018 - raises for a port that isn't a number from 0 to 65535
    except ValueError:
        raise invalid("Enter a complete URL, for example https://…") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise invalid("Enter a complete http or https URL, for example https://…")
    if parts.username or parts.password or any(c.isspace() for c in url.strip()):
        raise invalid("A context's URL can't hold a user name, a password or spaces.")
    return parts.hostname
