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
"""One watcher of a run's stream: a bounded queue the run publishes into without waiting."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

QUEUE_LIMIT = 256
# WebSocket close codes.
TRY_AGAIN_LATER = 1013
GOING_AWAY = 1001
UNKNOWN_RUN = 4404


@dataclass(frozen=True)
class Close:
    """The last item of a closed subscriber: the close code and an optional error event to send first."""

    code: int
    error: dict[str, Any] | None = None


class Subscriber:
    def __init__(self, limit: int = QUEUE_LIMIT) -> None:
        self._queue: asyncio.Queue[dict[str, Any] | Close] = asyncio.Queue(limit)
        self.closed = False

    def push(self, event: dict[str, Any]) -> bool:
        """Queues `event`. A full queue closes the subscriber, so a slow reader never holds up the run."""
        if self.closed:
            return False
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull:
            self.close(TRY_AGAIN_LATER)
            return False
        return True

    def close(self, code: int, error: dict[str, Any] | None = None) -> None:
        """Drops the backlog and queues the close; the reader reconnects for a fresh snapshot."""
        if self.closed:
            return
        self.closed = True
        while not self._queue.empty():
            self._queue.get_nowait()
        self._queue.put_nowait(Close(code, error))

    async def get(self) -> dict[str, Any] | Close:
        return await self._queue.get()

    def backlog(self) -> int:
        return self._queue.qsize()
