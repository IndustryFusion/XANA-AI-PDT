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
"""Polls the dataspace's inbox, and hands each message to the conversation desk."""

from __future__ import annotations

import asyncio
import logging

from app.dataspace.gateway import GatewayClient
from app.errors import Refused
from app.memory.store import StoreUnavailable
from app.runs.conversation import ConversationDesk

log = logging.getLogger(__name__)


class InboxPoller:
    def __init__(self, gateway: GatewayClient, desk: ConversationDesk, interval_s: float) -> None:
        self._gateway = gateway
        self._desk = desk
        self._interval = interval_s
        self._one_at_a_time = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="inbox")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _loop(self) -> None:
        while True:
            try:
                await self.poll_once()
            except Exception:
                log.exception("The inbox could not be polled")
            await asyncio.sleep(self._interval)

    async def poll_once(self) -> int:
        """Handles what is ready, oldest first. The number acknowledged. What fails waits for the next poll."""
        if self._gateway.connection.token() is None:
            return 0
        async with self._one_at_a_time:
            await self._desk.on_start()
            await self._desk.retry_closes()
            try:
                messages = await self._gateway.inbox("received")
            except Refused as refused:
                log.info("The inbox can't be read: %s", refused.message)
                return 0
            messages.sort(key=lambda m: str(m.get("created_at") or ""))
            done = 0
            for message in messages:
                try:
                    if await self._desk.receive(message):
                        await self._gateway.ack(message["message_id"])
                        done += 1
                except (Refused, StoreUnavailable) as problem:
                    log.warning("A message waits for the next poll: %s", problem)
            return done
