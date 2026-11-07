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
"""Runs survive a restart: a second app instance on the same memory database."""

import asyncio
import threading

import pytest

from app.memory.migrate import MIGRATIONS_DIR, Migrator
from tests.runs_support import (
    MACHINE,
    Script,
    clarify,
    eventually,
    make_app,
    rows,
    running,
    start,
    to_confirmation,
    until,
)

pytestmark = pytest.mark.db


@pytest.fixture
def url(fresh_database):
    return fresh_database()


def stored_steps(url, run_id):
    [(status, steps)] = rows(url, "SELECT status, steps FROM runs WHERE run_id = %s", run_id)
    return status, [(s["node"], s["round"]) for s in steps]


async def test_paused_run_is_restored_and_can_be_clarified(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        before = await until(client, run_id, "awaiting_input")

    async with running(make_app(url)) as client:
        listed = (await client.get("/api/agent/runs")).json()
        after = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert [r["run_id"] for r in listed] == [run_id]
        assert after == before
        await clarify(client, run_id)
        run = await until(client, run_id, "awaiting_confirmation")
    assert run["incident_id"] == before["incident_id"]


async def test_round_interrupted_between_validate_and_decide_runs_again(url):
    script = Script()
    script.gates["Decision"] = threading.Event()
    async with running(make_app(url, script=script)) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        await clarify(client, run_id)
        await eventually(lambda: "Decision" in script.waiting)
    status, steps = stored_steps(url, run_id)
    assert status == "running"
    assert steps[4:] == [("clarification", 1), ("observe", 2), ("hypothesize", 2), ("validate", 2)]

    async with running(make_app(url)) as client:
        run = await until(client, run_id)
    assert run["status"] == "awaiting_confirmation"
    assert [(s["node"], s["round"]) for s in run["steps"]] == [
        ("observe", 1),
        ("hypothesize", 1),
        ("validate", 1),
        ("decide", 1),
        ("clarification", 1),
        ("observe", 2),
        ("hypothesize", 2),
        ("validate", 2),
        ("decide", 2),
    ]


class StoreThenWait:
    """Incident memory that stores, then waits: the backend stops before the act step is recorded."""

    def __init__(self, inner, gate):
        self.inner = inner
        self.gate = gate
        self.stored = False

    async def similar(self, *args):
        return await self.inner.similar(*args)

    async def store(self, record):
        incident_id = await self.inner.store(record)
        self.stored = True
        await asyncio.to_thread(self.gate.wait)
        return incident_id


async def test_interrupted_act_runs_again_and_stores_once(url):
    app = make_app(url)
    gate = threading.Event()
    memories = []
    incidents = app.state.incidents
    memory_for = incidents.memory_for

    def blocking(run):
        memories.append(StoreThenWait(memory_for(run), gate))
        return memories[-1]

    incidents.memory_for = blocking
    try:
        async with running(app) as client:
            run_id = await to_confirmation(client)
            await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": True})
            await eventually(lambda: any(m.stored for m in memories))
    finally:
        gate.set()
    status, steps = stored_steps(url, run_id)
    assert status == "running"
    assert steps[-1] == ("resolution", 2)

    async with running(make_app(url)) as client:
        run = await until(client, run_id)
    assert run["status"] == "completed"
    assert [s["node"] for s in run["steps"]].count("act") == 1
    assert [s["node"] for s in run["steps"]][-2:] == ["resolution", "act"]
    assert rows(url, "SELECT count(*), bool_and(confirmed) FROM incidents WHERE run_id = %s", run_id) == [(1, True)]


async def test_memory_unavailable_refuses_to_start(fresh_database):
    async with running(make_app(fresh_database(create=False), health_timeout_s=1)) as client:
        started = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "Noise"})
        listed = await client.get("/api/agent/runs")
    assert started.status_code == listed.status_code == 503
    assert started.json()["error"] == {
        "kind": "unavailable",
        "message": "The memory database is not reachable, so runs cannot be stored.",
    }


async def test_runs_work_once_memory_becomes_reachable(fresh_database):
    url = fresh_database(create=False)
    async with running(make_app(url, health_timeout_s=1)) as client:
        assert (await client.get("/api/agent/runs")).status_code == 503
        fresh_database.create_later(url)
        assert (await client.get("/api/agent/runs")).json() == []
        await until(client, await start(client), "awaiting_input")


async def test_migrations_apply_on_a_database_at_001(url, tmp_path):
    first = tmp_path / "001_schema_migrations.sql"
    first.write_text((MIGRATIONS_DIR / first.name).read_text())
    assert await Migrator(url, tmp_path).apply() == ["001_schema_migrations.sql"]
    assert (await Migrator(url).apply())[:2] == ["002_runs.sql", "003_incidents.sql"]
    async with running(make_app(url)) as client:
        await until(client, await start(client))
