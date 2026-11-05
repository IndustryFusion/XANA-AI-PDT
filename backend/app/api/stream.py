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
"""The live stream of a run: `/ws/run/{run_id}`.

The first message is the run's current state (`snapshot`), then every `step` and
`status` in order. A `keepalive` message is sent whenever the run has been quiet
for the keep-alive interval.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.errors import Refused
from app.runs.stream import UNKNOWN_RUN, Close, Subscriber

router = APIRouter(tags=["runs"])

KEEPALIVE_S = 20.0
SERVER_ERROR = 1011


@router.websocket("/ws/run/{run_id}")
async def run_stream(websocket: WebSocket, run_id: str) -> None:
    runs = websocket.app.state.runs
    await websocket.accept()
    try:
        snapshot, sub = await runs.subscribe(run_id)
    except Refused as refused:
        await websocket.send_json({"type": "error", "error": refused.as_dict()})
        await websocket.close(UNKNOWN_RUN if refused.kind == "not_found" else SERVER_ERROR)
        return
    keepalive = getattr(websocket.app.state, "stream_keepalive_s", KEEPALIVE_S)
    sender = asyncio.create_task(_send(websocket, snapshot, sub, keepalive))
    receiver = asyncio.create_task(_receive(websocket))
    try:
        await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        runs.unsubscribe(run_id, sub)
        for task in (sender, receiver):
            task.cancel()
        # asyncio.wait, not gather: a cancellation of this handler passes through unchanged.
        await asyncio.wait({sender, receiver})


async def _send(websocket: WebSocket, snapshot: dict, sub: Subscriber, keepalive: float) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        await websocket.send_json({"type": "snapshot", "run": snapshot})
        while True:
            try:
                event = await asyncio.wait_for(sub.get(), keepalive)
            except TimeoutError:
                await websocket.send_json({"type": "keepalive", "at": datetime.now(UTC).isoformat()})
                continue
            if isinstance(event, Close):
                if event.error:
                    await websocket.send_json({"type": "error", "error": event.error})
                await websocket.close(event.code)
                return
            await websocket.send_json(event)


async def _receive(websocket: WebSocket) -> None:
    """Waits until the client leaves. Clients send nothing else."""
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while (await websocket.receive())["type"] != "websocket.disconnect":
            pass
