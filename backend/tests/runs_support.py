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
"""An app wired to the scripted model and fake sources, with a fresh memory database."""

from __future__ import annotations

import asyncio
import contextlib
import threading
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import psycopg
from fastapi import FastAPI

from app.main import AgentDeps, create_app
from app.runs.machines import MachineResolver
from tests.conftest import CLOSED_HTTP, make_settings
from xana_agent.testing import FakeContextSource, FakeHistorySource, StepScript, sample_entities, sample_history

MACHINE = "urn:ngsi-ld:Machine:press-01"
OTHER_MACHINE = "urn:ngsi-ld:Machine:press-02"
GATED = "urn:ngsi-ld:Machine:gated"
LATHE = "urn:ngsi-ld:Machine:lathe-01"
FAIL = "FAIL-THIS-ROUND"


class Script(StepScript):
    """`clarified` answers: a question first, a confident diagnosis once the operator clarified.

    An issue containing `FAIL` makes hypothesize answer wrongly twice, so the round fails.
    `gates` holds a threading.Event per answer schema name; that answer waits until it is set.
    """

    def __init__(self, mode: str = "clarified") -> None:
        super().__init__(mode)
        self.gates: dict[str, threading.Event] = {}
        self.waiting: set[str] = set()

    def answers(self) -> dict[type, Any]:
        return {schema: self._wrap(schema.__name__, fn) for schema, fn in super().answers().items()}

    def _wrap(self, name: str, fn: Callable[[Any], Any]) -> Callable[[Any], Any]:
        def answer(prompt: Any) -> Any:
            if name == "HypothesisList" and FAIL in str(prompt):
                return {"hypotheses": []}
            gate = self.gates.get(name)
            if gate is None:
                return fn(prompt)

            async def later() -> Any:
                self.waiting.add(name)
                await asyncio.to_thread(gate.wait)
                self.waiting.discard(name)
                return fn(prompt)

            return later()

        return answer


class GatedContext(FakeContextSource):
    """Reading the machine `GATED` waits until `gate` is set; `started` counts the reads that began."""

    def __init__(self, entities: list[dict[str, Any]]) -> None:
        lathe = {"id": LATHE, "type": "Machine", "machineType": {"type": "Property", "value": "Lathe"}}
        super().__init__([*entities, {"id": GATED, "type": "Machine"}, lathe])
        self.gate = threading.Event()
        self.started: list[str] = []

    async def get(self, entity_id: str) -> dict[str, Any] | None:
        self.started.append(entity_id)
        if entity_id == GATED:
            await asyncio.to_thread(self.gate.wait)
        return await super().get(entity_id)


TYPES = ["Machine", "Component"]


def broker(matches: dict[str, list[str]] | None = None, down: bool = False) -> httpx.MockTransport:
    """A broker answering `idPattern` queries with `matches[name]`; like Scorpio, a type is required."""

    def handle(request: httpx.Request) -> httpx.Response:
        if down:
            raise httpx.ConnectError("connection refused")
        if request.url.path == "/ngsi-ld/v1/types":
            return httpx.Response(200, json={"id": "urn:types", "type": "EntityTypeList", "typeList": TYPES})
        if request.url.params.get("type") != ",".join(TYPES):
            return httpx.Response(400, json={"title": "Bad Request Data."})
        pattern = request.url.params["idPattern"]
        name = pattern.removeprefix(".*:").removesuffix("$").replace("\\", "")
        return httpx.Response(200, json=[{"id": i, "type": "Machine"} for i in (matches or {}).get(name, [])])

    return httpx.MockTransport(handle)


def make_app(
    url: str,
    script: Script | None = None,
    context: FakeContextSource | None = None,
    transport: httpx.MockTransport | None = None,
    **settings: Any,
) -> FastAPI:
    script = script or Script()
    agent = AgentDeps(
        llm=script.model(),
        context=context or GatedContext(sample_entities()),
        history=FakeHistorySource(sample_history()),
        machines=MachineResolver(CLOSED_HTTP, transport=transport or broker(down=True)),
    )
    app = create_app(make_settings(postgres_memory_url=url, **settings), agent=agent)
    app.state.script = script
    app.state.context = agent.context
    return app


@contextlib.asynccontextmanager
async def running(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    """Runs the app's startup and shutdown around an HTTP client in the test's event loop."""
    try:
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                yield client
    finally:
        # After shutdown, so a released answer cannot complete a step the shutdown interrupted.
        release(app)


def release(app: FastAPI) -> None:
    """Opens every gate, so no waiting thread outlives the test."""
    gate = getattr(app.state.context, "gate", None)
    if gate is not None:
        gate.set()
    for gate in app.state.script.gates.values():
        gate.set()


async def start(client: httpx.AsyncClient, machine_id: str = MACHINE, issue: str = "Spindle vibration") -> str:
    response = await client.post("/api/agent/run", json={"machine_id": machine_id, "issue": issue})
    assert response.status_code == 202, response.text
    return response.json()["run_id"]


async def until(client: httpx.AsyncClient, run_id: str, *statuses: str, within: float = 10) -> dict[str, Any]:
    """Polls the run until it is in one of `statuses` (default: not running)."""
    deadline = time.monotonic() + within
    while True:
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        if (run["status"] in statuses) if statuses else run["status"] != "running":
            return run
        if time.monotonic() > deadline:
            raise AssertionError(f"run stayed {run['status']}: {run}")
        await asyncio.sleep(0.02)


async def eventually(check: Callable[[], bool], within: float = 5) -> None:
    deadline = time.monotonic() + within
    while not check():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.01)


async def to_confirmation(client: httpx.AsyncClient, machine_id: str = MACHINE, issue: str = "Oil too hot") -> str:
    run_id = await start(client, machine_id, issue)
    await until(client, run_id, "awaiting_input")
    await clarify(client, run_id)
    await until(client, run_id, "awaiting_confirmation")
    return run_id


async def clarify(client: httpx.AsyncClient, run_id: str, text: str = "The filter was changed yesterday") -> None:
    response = await client.post(f"/api/agent/clarify/{run_id}", json={"text": text})
    assert response.status_code == 200, response.text


async def confirm(client: httpx.AsyncClient, run_id: str) -> dict[str, Any]:
    response = await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": True})
    assert response.status_code == 200, response.text
    return await until(client, run_id, "completed", "failed")


def rows(url: str, query: str, *params: Any) -> list[tuple]:
    with psycopg.connect(url) as conn:
        return conn.execute(query, params).fetchall()
