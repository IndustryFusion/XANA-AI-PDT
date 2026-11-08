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
"""Finished runs move to incident history by themselves after a time without a change."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.memory.store import StoreUnavailable
from app.runs.model import _builder
from tests.runs_support import FAIL, GATED, make_app, rows, running, start, to_confirmation, until

pytestmark = pytest.mark.db

HOUR = 3600


@pytest.fixture
def url(fresh_database):
    return fresh_database()


class Clock:
    """The manager's clock, moved on by the test."""

    def __init__(self) -> None:
        self.offset = timedelta()

    def __call__(self) -> datetime:
        return datetime.now(UTC) + self.offset


def with_clock(app) -> Clock:
    clock = Clock()
    app.state.runs._now = clock
    return clock


async def listed(client) -> list[str]:
    return [r["run_id"] for r in (await client.get("/api/agent/runs")).json()]


def in_history(url: str, run_id: str) -> list[tuple]:
    return rows(url, "SELECT id, outcome FROM incidents WHERE run_id = %s", run_id)


async def finished_runs(client) -> dict[str, str]:
    """One run in each finished state reachable by hand: completed, failed and stopped."""
    completed = await to_confirmation(client)
    response = await client.post(f"/api/agent/confirm-resolution/{completed}", json={"confirmed": True})
    assert response.status_code == 200, response.text
    await until(client, completed, "completed")
    failed = await start(client, issue=FAIL)
    await until(client, failed, "failed")
    stopped = await start(client)
    await until(client, stopped, "awaiting_input")
    assert (await client.post(f"/api/agent/stop/{stopped}", json={"reason": "Fixed"})).status_code == 200
    return {"completed": completed, "failed": failed, "stopped": stopped}


# ── Which runs, and when ────────────────────────────────────────────────────


async def test_finished_runs_are_archived_after_the_delay_with_their_record(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        runs = await finished_runs(client)
        records = {name: (await client.get(f"/api/agent/status/{run}")).json() for name, run in runs.items()}
        clock.offset = timedelta(seconds=HOUR - 5)
        assert await app.state.runs.archive_due() == []
        assert set(await listed(client)) == set(runs.values())
        clock.offset = timedelta(seconds=HOUR + 1)
        assert set(await app.state.runs.archive_due()) == set(runs.values())
        assert await listed(client) == []
        for name, run in runs.items():
            [(incident, _)] = in_history(url, run)
            detail = (await client.get(f"/api/incidents/{incident}")).json()
            assert detail["outcome"] == name
            assert len(detail["trace"]) == len(records[name]["steps"])


async def test_a_run_closed_by_the_machine_builder_is_archived(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client)
        await until(client, run, "awaiting_input")
        rec = app.state.runs.record(run)
        async with rec.lock:
            await app.state.runs.change(rec, status="mb_closed", data={"outcome": "resolved", "reason": "Done"})
        clock.offset = timedelta(seconds=HOUR + 1)
        assert await app.state.runs.archive_due() == [run]
        assert in_history(url, run)


@pytest.mark.parametrize(
    "status",
    [
        "awaiting_input",
        "awaiting_confirmation",
        "awaiting_machine_builder",
        "awaiting_operator_approval",
        "awaiting_recommendation_review",
    ],
)
async def test_waiting_runs_are_never_archived(url, status):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client)
        await until(client, run, "awaiting_input")
        rec = app.state.runs.record(run)
        async with rec.lock:
            await app.state.runs.change(rec, status=status)
        clock.offset = timedelta(days=30)
        assert await app.state.runs.archive_due() == []
        assert await listed(client) == [run]


async def test_a_running_run_is_never_archived(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client, machine_id=GATED)
        clock.offset = timedelta(days=30)
        assert await app.state.runs.archive_due() == []
        assert (await client.get(f"/api/agent/status/{run}")).json()["status"] == "running"


async def test_a_pending_close_is_not_archived_and_the_delay_counts_from_its_going_out(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client)
        await until(client, run, "awaiting_input")
        rec = app.state.runs.record(run)
        async with rec.lock:
            await app.state.runs.change(rec, status="stopped", data={"close_pending": True, "outcome": "withdrawn"})
        clock.offset = timedelta(days=2)
        assert await app.state.runs.archive_due() == []
        async with rec.lock:  # the close goes out now, two days on
            await app.state.runs.change(rec, data={"outcome": "withdrawn"})
        clock.offset = timedelta(days=2, seconds=HOUR - 5)
        assert await app.state.runs.archive_due() == []
        clock.offset = timedelta(days=2, seconds=HOUR + 5)
        assert await app.state.runs.archive_due() == [run]


async def test_zero_turns_it_off(url):
    app = make_app(url, auto_archive_after_s=0)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        clock.offset = timedelta(days=400)
        assert await app.state.runs.archive_due() == []
        assert await listed(client) == [run]
    assert app.state.runs._sweep_task is None


async def test_the_sweep_runs_by_itself(url):
    app = make_app(url, auto_archive_after_s=1)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        for _ in range(400):
            if not await listed(client):
                break
            await asyncio.sleep(0.01)
        assert await listed(client) == [] and in_history(url, run)


# ── Restart ─────────────────────────────────────────────────────────────────


async def test_after_a_restart_the_delay_counts_from_the_stored_change(url):
    async with running(make_app(url, auto_archive_after_s=0)) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
    rows(url, "UPDATE runs SET updated_at = now() - interval '50 minutes' RETURNING 1")
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        assert await app.state.runs.archive_due() == []  # not at once
        clock.offset = timedelta(minutes=9)
        assert await app.state.runs.archive_due() == []
        clock.offset = timedelta(minutes=11)
        assert await app.state.runs.archive_due() == [run]  # not a full hour later
        assert in_history(url, run)


# ── At the same moment ──────────────────────────────────────────────────────


async def test_a_run_reopened_while_the_sweep_waits_stays(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client)
        await until(client, run, "awaiting_input")
        rec = app.state.runs.record(run)
        async with rec.lock:
            await app.state.runs.change(rec, status="stopped")
        clock.offset = timedelta(seconds=HOUR + 1)
        async with rec.lock:
            sweep = asyncio.create_task(app.state.runs.archive_due())
            await asyncio.sleep(0.05)  # the sweep has found the run due, and waits for its lock
            await app.state.runs.change(rec, status="awaiting_machine_builder")  # reopened meanwhile
        assert await sweep == []
        assert await listed(client) == [run]


async def test_a_run_changed_while_the_sweep_waits_starts_its_delay_again(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        rec = app.state.runs.record(run)
        clock.offset = timedelta(seconds=HOUR + 1)
        async with rec.lock:
            sweep = asyncio.create_task(app.state.runs.archive_due())
            await asyncio.sleep(0.05)
            await app.state.runs.change(rec, data={**rec.state.data, "note": "a late message"})  # still failed
        assert await sweep == []
        assert await listed(client) == [run]


async def test_an_operator_archive_and_the_sweep_at_once_archive_once(url):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        clock.offset = timedelta(seconds=HOUR + 1)
        operator, swept, again = await asyncio.gather(
            client.post(f"/api/agent/archive/{run}"), app.state.runs.archive_due(), app.state.runs.archive_due()
        )
        assert operator.status_code in (204, 404), operator.text
        assert (operator.status_code == 204) + len(swept) + len(again) == 1
        assert len(in_history(url, run)) == 1


async def test_two_operator_archives_at_once(url):
    app = make_app(url)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        answers = await asyncio.gather(*(client.post(f"/api/agent/archive/{run}") for _ in range(3)))
        assert sorted(a.status_code for a in answers) == [204, 404, 404]


async def test_a_failed_write_leaves_the_run_for_the_next_sweep(url, monkeypatch):
    app = make_app(url, auto_archive_after_s=HOUR)
    clock = with_clock(app)
    async with running(app) as client:
        run = await start(client, issue=FAIL)
        await until(client, run, "failed")
        clock.offset = timedelta(seconds=HOUR + 1)
        store = app.state.runs._incidents
        real = store.archive

        async def down(*args, **kwargs):
            raise StoreUnavailable("The memory database is not reachable.")

        monkeypatch.setattr(store, "archive", down)
        assert await app.state.runs.archive_due() == []
        assert await listed(client) == [run]
        monkeypatch.setattr(store, "archive", real)
        assert await app.state.runs.archive_due() == [run]


# ── The machine builder in the list ─────────────────────────────────────────


async def test_the_list_names_an_escalated_runs_builder(url):
    app = make_app(url)
    async with running(app) as client:
        plain = await start(client)
        escalated = await start(client)
        await until(client, escalated, "awaiting_input")
        rec = app.state.runs.record(escalated)
        recipient = {"id": "urn:example:builder", "name": "Builder GmbH"}
        async with rec.lock:
            await app.state.runs.change(rec, escalation={"ref": "r1", "recipient": recipient})
        entries = {r["run_id"]: r for r in (await client.get("/api/agent/runs")).json()}
        assert entries[escalated]["machine_builder"] == recipient
        assert entries[plain]["machine_builder"] is None


def test_a_builder_without_a_name():
    assert _builder({"recipient": {"id": "urn:b", "name": ""}}) == {"id": "urn:b", "name": None}
    assert _builder({"recipient": None}) is None and _builder(None) is None
