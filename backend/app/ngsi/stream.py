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
"""What the live updates stream needs of the connection under it."""

from __future__ import annotations

import contextlib
import socket
import struct
from typing import Any
from urllib.parse import urlsplit

TRANSPORT = "xana.transport"


class ConnectionInScope:
    """Keeps a WebSocket's transport in its scope, so that a stalled connection can be dropped.

    ASGI has no way to do that. A close frame can't get out through a full socket, and closing the
    transport waits for what is queued to be sent, which is never.
    """

    def __init__(self, app: Any) -> None:
        self._app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "websocket":
            scope[TRANSPORT] = getattr(getattr(send, "__self__", None), "transport", None)
        await self._app(scope, receive, send)


def drop_connection(websocket: Any) -> None:
    """Ends the connection at once with a reset. Without one, the kernel holds what is queued for a client
    that doesn't read, and the client never learns."""
    transport = websocket.scope.get(TRANSPORT)
    if transport is None:
        return
    connection = transport.get_extra_info("socket")
    if connection is not None:
        with contextlib.suppress(OSError):
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    transport.abort()


def origin_allowed(origin: str | None, host: str | None, allowed: str | None) -> bool:
    """Whether a browser page from `origin` may open this stream.

    Browsers send the origin and don't apply the same-origin rule to WebSockets, so without this any
    page could read live data. A client without an origin isn't a web page.
    """
    if origin is None:
        return True
    if origin in {item.strip() for item in (allowed or "").split(",") if item.strip()}:
        return True
    try:
        return bool(host) and urlsplit(origin).netloc == host
    except ValueError:
        return False
