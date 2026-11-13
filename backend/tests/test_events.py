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
"""Machine events: who may call, what starts a run, what doesn't, and what happens when something fails."""

import asyncio
import contextlib
import json
import logging
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import psycopg
import pytest

from app.config import ConfigError, load_settings
from app.errors import Refused, invalid
from app.events.identity import ServiceIdentity
from app.events.subscription import (
    ACTIVE,
    BROKER_UNREACHABLE,
    DELIVERY_FAILING,
    FAILED,
    SUBSCRIPTION_ID,
    TENANT_LIMIT,
    WAITING,
    MachineWatch,
)
from app.events.worker import QUEUE_LIMIT, Event, EventWorker, alert_event, ngsi_events
from app.health import HealthService
from app.main import create_app
from app.memory.migrate import Migrator
from app.memory.store import Database, StoreRefused, StoreUnavailable
from app.runs.manager import RunRecord
from app.runs.model import RunState
from tests.conftest import make_settings
from tests.runs_support import (
    FAIL,
    GATED,
    MACHINE,
    OTHER_MACHINE,
    clarify,
    eventually,
    make_app,
    rows,
    running,
    start,
    until,
)

SECRET = "webhook-secret-value"
AUTH = {"Authorization": f"Bearer {SECRET}"}
FAULT = {"id": MACHINE, "type": "Machine", "status": {"type": "Property", "value": "fault"}}


WATCHED = ["status", "errorCode", "alarmLevel", "faultCode"]


def notification(*entities):
    return {"id": "urn:n", "type": "Notification", "data": list(entities)}


def status(machine, value):
    return {"id": machine, "type": "Machine", "status": {"type": "Property", "value": value}}


async def open_runs(client):
    return (await client.get("/api/agent/runs")).json()


async def runs_are(client, count):
    """The runs once the worker has handled everything so far."""
    await asyncio.wait_for(client._transport.app.state.events.settled(), 10)
    found = await open_runs(client)
    assert len(found) == count, found
    return found


# ── What a body means ────────────────────────────────────────────────────────


def test_a_notification_gives_an_event_per_machine_naming_what_it_reported():
    events, ignored = ngsi_events(
        notification(
            {
                "id": "urn:m:1",
                "type": "Machine",
                "status": {"value": "fault"},
                "errorCode": {"value": "E42"},
                "other": {"value": 1},
            },
            {"id": "urn:m:2", "alarmLevel": {"value": 3}},
            {"type": "Machine", "status": {"value": "fault"}},
            {"id": "urn:m:3", "other": {"value": 1}},
            "not an entity",
        ),
        WATCHED,
    )
    # Every entity with an ID is an event, also one that reports none of the watched values.
    assert [(e.machine_id, e.source) for e in events] == [("urn:m:1", "ngsi"), ("urn:m:2", "ngsi"), ("urn:m:3", "ngsi")]
    assert events[0].issue == "Machine event: status=fault, errorCode=E42"
    assert events[1].issue == "Machine event: alarmLevel=3"
    assert events[2].issue == "Machine event: state change detected"
    assert ignored == 2


@pytest.mark.parametrize(
    "attribute",
    [
        {"https://industry-fusion.org/base/v0.1/status": {"type": "Property", "value": "fault"}},
        {"https://industry-fusion.org/base#status": {"type": "Property", "value": "fault"}},
        {"status": [{"type": "Property", "value": "fault"}]},
        {"status": {"https://uri.etsi.org/ngsi-ld/hasValue": [{"@value": "fault"}]}},
        {"status": {"type": "Relationship", "object": "fault"}},
    ],
)
def test_names_and_forms_on_platform_data(attribute):
    [event], _ = ngsi_events(notification({"id": "urn:m:1", **attribute}), WATCHED)
    assert event.issue == "Machine event: status=fault"


@pytest.mark.parametrize("body", [[], {}, {"data": "x"}, None, 3])
def test_a_body_that_is_no_notification(body):
    with pytest.raises(type(invalid("x"))):
        ngsi_events(body, WATCHED)


def test_an_alert_names_its_machine_and_what_happened():
    event = alert_event({"resource": "urn:m:1", "event": "HighTemp", "text": "92 C", "severity": "major"})
    assert (event.machine_id, event.source, event.issue) == ("urn:m:1", "alert", "Alert HighTemp: 92 C")


def test_the_plain_form():
    event = alert_event({"machine_id": " urn:m:1 ", "issue": " Too hot ", "severity": "ok"})
    assert (event.machine_id, event.issue) == ("urn:m:1", "Too hot")


@pytest.mark.parametrize(
    "fields",
    [
        {"repeat": True},
        *[{"severity": s} for s in ("ok", "normal", "up", "cleared", "informational", "debug", "trace")],
        *[{"status": s} for s in ("closed", "expired", "shelved", "blackout")],
    ],
)
def test_alerts_with_nothing_to_diagnose(fields):
    assert alert_event({"resource": "urn:m:1", "event": "E", "severity": "major", "status": "open", **fields}) is None


@pytest.mark.parametrize("severity", ["critical", "major", "minor", "warning", "down", "indeterminate", "unknown"])
def test_severities_that_start_a_run(severity):
    assert alert_event({"resource": "urn:m:1", "event": "E", "severity": severity, "status": "open"}) is not None


@pytest.mark.parametrize(
    "body", [[], "x", {}, {"resource": ""}, {"resource": 3}, {"machine_id": "m"}, {"machine_id": "", "issue": "i"}]
)
def test_an_alert_naming_no_machine(body):
    with pytest.raises(type(invalid("x"))):
        alert_event(body)


def test_a_long_issue_is_cut_to_what_a_run_takes():
    assert len(alert_event({"resource": "m", "event": "E", "text": "x" * 5000}).issue) == 2000


# ── Who may call ─────────────────────────────────────────────────────────────


@pytest.mark.db
@pytest.mark.parametrize("path", ["/events/ngsi", "/events/alert"])
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong"},
        {"Authorization": SECRET},
        {"Authorization": f"Basic {SECRET}"},
        {"Authorization": f"Bearer {SECRET}x"},
        {"Authorization": "Bearer "},
    ],
)
async def test_calls_without_the_secret_are_refused_and_start_nothing(fresh_database, path, headers):
    app = make_app(fresh_database(), event_webhook_secret=SECRET)
    async with running(app) as client:
        body = notification(FAULT) | {"resource": MACHINE, "event": "E"}
        response = await client.post(path, json=body, headers=headers)
        assert response.status_code == 401
        assert response.json()["error"]["kind"] == "unauthorized"
        assert SECRET not in response.text
        assert app.state.events.backlog() == 0
        assert await open_runs(client) == []


@pytest.mark.db
async def test_the_secret_comes_before_the_body(fresh_database):
    async with running(make_app(fresh_database(), event_webhook_secret=SECRET)) as client:
        assert (await client.post("/events/ngsi", content=b"{not json")).status_code == 401
        assert (await client.post("/events/ngsi", content=b"{not json", headers=AUTH)).status_code == 422


@pytest.mark.db
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer "}, {"Authorization": "Bearer None"}])
async def test_with_no_secret_configured_every_call_is_refused(fresh_database, headers):
    async with running(make_app(fresh_database())) as client:
        assert (
            await client.post("/events/alert", json={"machine_id": "m", "issue": "i"}, headers=headers)
        ).status_code == 401


# ── What starts a run ────────────────────────────────────────────────────────


@pytest.fixture
def url(fresh_database):
    return fresh_database()


def event_app(url, **settings):
    return make_app(url, event_webhook_secret=SECRET, **settings)


@pytest.mark.db
async def test_a_status_change_starts_one_run_like_any_other(url):
    async with running(event_app(url)) as client:
        response = await client.post("/events/ngsi", json=notification(FAULT), headers=AUTH)
        assert response.status_code == 202
        assert response.json() == {"accepted": 1, "ignored": 0}
        [listed] = await runs_are(client, 1)
        assert listed["machine_id"] == MACHINE
        assert listed["source"] == "ngsi"
        assert listed["issue"] == "Machine event: status=fault"
        run = await until(client, listed["run_id"], "awaiting_input")
        assert run["incident_id"] is not None
        assert run["source"] == "ngsi"
        await clarify(client, listed["run_id"])
        await until(client, listed["run_id"], "awaiting_confirmation")
    [(stored,)] = rows(url, "SELECT source FROM runs")
    assert stored == "ngsi"


@pytest.mark.db
async def test_an_alert_starts_a_run(url):
    async with running(event_app(url)) as client:
        body = {"resource": MACHINE, "event": "HighTemp", "text": "92 C", "severity": "major", "status": "open"}
        assert (await client.post("/events/alert", json=body, headers=AUTH)).json() == {"accepted": 1, "ignored": 0}
        [listed] = await runs_are(client, 1)
        assert (listed["machine_id"], listed["source"]) == (MACHINE, "alert")
        quiet = {**body, "severity": "ok"}
        assert (await client.post("/events/alert", json=quiet, headers=AUTH)).json() == {"accepted": 0, "ignored": 1}


@pytest.mark.db
async def test_repeated_events_during_a_run_start_nothing(url):
    app = event_app(url)
    async with running(app) as client:
        first = status(GATED, "fault-0")
        await client.post("/events/ngsi", json=notification(first), headers=AUTH)
        await eventually(lambda: GATED in app.state.context.started)
        for n in range(1, 6):
            await client.post("/events/ngsi", json=notification(status(GATED, f"fault-{n}")), headers=AUTH)
            await client.post("/events/alert", json={"machine_id": GATED, "issue": "again"}, headers=AUTH)
        found = await runs_are(client, 1)
        assert len(found) == 1
        assert found[0]["status"] == "running"
        app.state.context.gate.set()


@pytest.mark.db
async def test_events_arriving_together_during_a_run_start_one_run(url):
    app = event_app(url)
    async with running(app) as client:
        bodies = [notification(status(GATED, f"fault-{n}")) for n in range(30)]
        answers = await asyncio.gather(*(client.post("/events/ngsi", json=b, headers=AUTH) for b in bodies))
        assert {a.status_code for a in answers} == {202}
        assert len(await runs_are(client, 1)) == 1
        assert len(rows(url, "SELECT run_id FROM runs")) == 1
        app.state.context.gate.set()


@pytest.mark.db
async def test_a_run_waiting_for_the_operator_holds_nothing_up(url):
    async with running(event_app(url)) as client:
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        [listed] = await runs_are(client, 1)
        await until(client, listed["run_id"], "awaiting_input")
        # The same values again: every notification counts.
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        found = await runs_are(client, 2)
        assert all(r["source"] == "ngsi" for r in found)
        assert len({r["run_id"] for r in found}) == 2


@pytest.mark.db
async def test_the_same_values_again_start_a_run_each_time_also_after_a_restart(url):
    async with running(event_app(url)) as client:
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        [listed] = await runs_are(client, 1)
        await until(client, listed["run_id"], "awaiting_input")
        await client.post(f"/api/agent/stop/{listed['run_id']}", json={})
        await client.post(f"/api/agent/archive/{listed['run_id']}")
        assert await open_runs(client) == []
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        [again] = await runs_are(client, 1)
        await until(client, again["run_id"], "awaiting_input")

    async with running(event_app(url)) as client:
        # The run from before the restart waits for the operator, so it holds nothing up.
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        found = await runs_are(client, 2)
        assert again["run_id"] in {r["run_id"] for r in found}


@pytest.mark.db
async def test_a_notification_without_watched_values_starts_a_run(url):
    async with running(event_app(url)) as client:
        body = notification({"id": MACHINE, "type": "Machine", "temperature": {"value": 80}})
        assert (await client.post("/events/ngsi", json=body, headers=AUTH)).json() == {"accepted": 1, "ignored": 0}
        [listed] = await runs_are(client, 1)
        assert listed["issue"] == "Machine event: state change detected"


@pytest.mark.db
async def test_an_operators_run_holds_up_no_event_and_operators_can_still_start(url):
    app = event_app(url)
    async with running(app) as client:
        run_id = await start(client, GATED)
        await eventually(lambda: GATED in app.state.context.started)
        await client.post("/events/alert", json={"machine_id": GATED, "issue": "x"}, headers=AUTH)
        found = await runs_are(client, 2)
        assert sorted(r["source"] for r in found) == ["alert", "operator"]
        second = await start(client, GATED, "Something else")
        assert second != run_id
        app.state.context.gate.set()


@pytest.mark.parametrize(
    ("status_now", "round_now", "steps", "holds"),
    [
        ("running", 1, (), True),
        ("awaiting_input", 1, (), False),
        ("awaiting_confirmation", 1, (), False),
        ("awaiting_machine_builder", 1, (), False),
        ("running", 2, (), False),  # going on after the operator's answer
        ("running", 1, ({"node": "resolution"},), False),  # acting on a confirmation
        ("completed", 1, (), False),
        ("failed", 1, (), False),
        ("stopped", 1, (), False),
    ],
)
async def test_only_a_triggered_runs_first_analysis_holds_events_up(url, status_now, round_now, steps, holds):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)
        runs = app.state.runs
        now = datetime.now(UTC)
        for source in ("ngsi", "alert", "operator"):
            state = RunState(
                f"r-{source}", MACHINE, "x", status_now, now, now, round=round_now, steps=steps, source=source
            )
            runs._runs[state.run_id] = RunRecord(state)
            expected = holds and source != "operator"
            assert runs._triggered_in_progress(MACHINE) is expected, source
            assert runs._triggered_in_progress(OTHER_MACHINE) is False
            del runs._runs[state.run_id]


@pytest.mark.db
async def test_another_machine_isnt_held_up(url):
    app = event_app(url)
    async with running(app) as client:
        await client.post("/events/alert", json={"machine_id": GATED, "issue": "held"}, headers=AUTH)
        await eventually(lambda: GATED in app.state.context.started)
        await client.post("/events/alert", json={"machine_id": OTHER_MACHINE, "issue": "free"}, headers=AUTH)
        found = await runs_are(client, 2)
        other = next(r for r in found if r["machine_id"] == OTHER_MACHINE)
        await until(client, other["run_id"], "awaiting_input")
        app.state.context.gate.set()


@pytest.mark.db
async def test_a_triggered_run_is_archived_with_its_source(url):
    async with running(event_app(url)) as client:
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "x"}, headers=AUTH)
        [listed] = await runs_are(client, 1)
        await until(client, listed["run_id"], "awaiting_input")
        await client.post(f"/api/agent/stop/{listed['run_id']}", json={})
        await client.post(f"/api/agent/archive/{listed['run_id']}")
        [incident] = (await client.get("/api/incidents")).json()
        assert incident["source"] == "alert"
        assert incident["number"] is not None
        record = (await client.get(f"/api/incidents/{incident['id']}")).json()
        assert record["source"] == "alert"
        # Reopening is an operator's act.
        reopened = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
        assert (await client.get(f"/api/agent/status/{reopened}")).json()["source"] == "operator"


@pytest.mark.db
async def test_stored_rows_from_before_read_as_an_operators(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
    with psycopg.connect(url, autocommit=True) as conn:
        assert conn.execute("SELECT source FROM runs").fetchone() == ("operator",)
    async with running(make_app(url)) as client:
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["source"] == "operator"


# ── What can fail ────────────────────────────────────────────────────────────


async def wait_for(check, within=5):
    deadline = asyncio.get_running_loop().time() + within
    while not check():
        assert asyncio.get_running_loop().time() < deadline, "condition not reached"
        await asyncio.sleep(0.01)


class FakeRuns:
    def __init__(self):
        self.calls = []
        self.failures = []

    async def ready(self):
        return None

    def failed_lately(self, machine):
        return False

    async def start_triggered(self, machine, issue, source):
        self.calls.append(machine)
        if self.failures:
            raise self.failures.pop(0)
        return "run"


class FakeMachines:
    async def resolve(self, machine_id):
        if machine_id == "unknown":
            raise invalid("No machine is named unknown.")
        if machine_id == "broken":
            raise RuntimeError("broken")
        return machine_id


def event(machine="m"):
    return Event(machine, "issue", "alert")


async def test_with_the_database_down_an_event_waits_and_isnt_lost():
    from app.errors import unavailable

    runs = FakeRuns()
    runs.failures = [unavailable("down"), unavailable("still down")]
    worker = EventWorker(runs, FakeMachines(), retry_s=0.01)
    worker.start()
    worker.add([event("first"), event("second")])
    await wait_for(lambda: runs.calls == ["first", "first", "first", "second"])
    await worker.stop()


async def test_an_unknown_name_or_anything_unexpected_doesnt_stop_the_worker(caplog):
    runs = FakeRuns()
    worker = EventWorker(runs, FakeMachines(), retry_s=0.01)
    worker.start()
    with caplog.at_level(logging.INFO):
        worker.add([event("unknown"), event("broken"), event("fine")])
        await wait_for(lambda: runs.calls == ["fine"])
    assert "No machine is named unknown" in caplog.text
    assert "could not be handled" in caplog.text
    await worker.stop()


async def test_a_refusal_other_than_unavailable_drops_the_event():
    runs = FakeRuns()
    runs.failures = [invalid("no")]
    worker = EventWorker(runs, FakeMachines(), retry_s=0.01)
    worker.start()
    worker.add([event("first"), event("second")])
    await wait_for(lambda: runs.calls == ["first", "second"])
    await worker.stop()


async def test_a_full_queue_refuses_all_of_a_notification(caplog):
    worker = EventWorker(FakeRuns(), FakeMachines(), limit=3)
    worker.add([event(), event()])
    with pytest.raises(type(invalid("x"))) as refused:
        worker.add([event(), event()])
    assert refused.value.kind == "unavailable"
    assert worker.backlog() == 2
    worker.add([event()])
    assert worker.backlog() == 3


@pytest.mark.db
async def test_a_full_queue_answers_503(url):
    app = event_app(url)
    async with running(app) as client:
        await app.state.events.stop()
        app.state.events.add([event()] * QUEUE_LIMIT)
        response = await client.post("/events/alert", json={"machine_id": "m", "issue": "i"}, headers=AUTH)
        assert response.status_code == 503
        assert "queue is full" in response.json()["error"]["message"]


@pytest.mark.db
async def test_with_the_database_down_a_real_event_starts_one_run_when_it_is_back(url):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)
        store = app.state.runs._store
        save, down = store.save, [True, True]

        async def failing_save(run, *rest):
            if down:
                down.pop()
                raise StoreUnavailable("The memory database is not reachable.")
            return await save(run, *rest)

        store.save = failing_save
        app.state.events._retry_s = 0.01
        await client.post("/events/ngsi", json=notification(status(MACHINE, "a")), headers=AUTH)
        assert len(await runs_are(client, 1)) == 1
        assert not down


@pytest.mark.db
async def test_with_the_model_down_the_run_starts_and_fails_visibly(url):
    app = event_app(url)
    async with running(app) as client:

        async def no_model():
            return "The language model is not available: down"

        app.state.runs._model_problem = no_model
        refused = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "x"})
        assert refused.status_code == 503  # an operator is told at once
        body = {"machine_id": MACHINE, "issue": f"{FAIL}: the model answers nothing usable"}
        await client.post("/events/alert", json=body, headers=AUTH)
        [listed] = await runs_are(client, 1)
        run = await until(client, listed["run_id"], "failed")
        assert run["source"] == "alert"
        assert run["data"]["error"]


@pytest.mark.db
@pytest.mark.parametrize("bad", ["a\x00b", "lone \ud800 half"])
async def test_an_alert_the_database_cant_store_doesnt_stop_later_events(url, bad):
    async with running(event_app(url)) as client:
        for body in ({"machine_id": MACHINE, "issue": bad}, {"resource": f"{OTHER_MACHINE}{bad}", "event": bad}):
            answer = await client.post("/events/alert", content=json.dumps(body).encode(), headers=AUTH)
            assert answer.status_code == 202
        found = await runs_are(client, 2)
    assert MACHINE in [r["machine_id"] for r in found]
    assert "\x00" not in json.dumps(found)


@pytest.mark.db
async def test_a_value_the_database_cant_store_doesnt_stop_later_events(url):
    async with running(event_app(url)) as client:
        content = json.dumps(notification(status(MACHINE, "f\x00ault"))).encode()
        assert (await client.post("/events/ngsi", content=content, headers=AUTH)).status_code == 202
        await client.post("/events/ngsi", json=notification(status(OTHER_MACHINE, "fault")), headers=AUTH)
        found = await runs_are(client, 2)
    assert "status=fault" in {r["issue"].removeprefix("Machine event: ") for r in found}


@pytest.mark.db
async def test_what_the_database_refuses_is_dropped_and_a_lost_connection_is_tried_again(url):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)
        store = app.state.runs._store
        save, refusals = store.save, [StoreRefused("refused")]

        async def refusing(run, *rest):
            if refusals:
                raise refusals.pop()
            return await save(run, *rest)

        store.save = refusing
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "refused"}, headers=AUTH)
        await client.post("/events/alert", json={"machine_id": OTHER_MACHINE, "issue": "next"}, headers=AUTH)
        [only] = await runs_are(client, 1)
    assert only["machine_id"] == OTHER_MACHINE


@pytest.mark.db
async def test_a_database_error_tells_a_lost_connection_from_a_refusal(url):
    db = Database(url, 1)
    with pytest.raises(StoreRefused):
        async with db.transaction() as conn:
            await conn.execute("SELECT 1 / 0")
    await db.close()
    gone = Database("postgresql://nobody@127.0.0.1:1/none", 0.2)
    with pytest.raises(StoreUnavailable) as raised:
        async with gone.transaction():
            pass
    assert not isinstance(raised.value, StoreRefused)
    await gone.close()


async def failed_triggered_run(app, client):
    await client.post("/events/ngsi", json=notification(status(MACHINE, f"{FAIL} a")), headers=AUTH)
    [first] = await runs_are(client, 1)
    await until(client, first["run_id"], "failed")


def later_by(app, seconds):
    now = app.state.runs._now
    app.state.runs._now = lambda: now() + timedelta(seconds=seconds)


@pytest.mark.db
async def test_after_a_failed_triggered_run_the_latest_event_waits_and_then_starts_once(url):
    app = event_app(url)
    async with running(app) as client:
        await failed_triggered_run(app, client)
        for n in range(4):
            await client.post("/events/alert", json={"machine_id": MACHINE, "issue": f"alert {n}"}, headers=AUTH)
        assert len(await runs_are(client, 1)) == 1, "held back during the wait"
        await client.post("/events/alert", json={"machine_id": OTHER_MACHINE, "issue": "free"}, headers=AUTH)
        assert len(await runs_are(client, 2)) == 2, "another machine isn't held up"

        later_by(app, 301)
        found = await runs_are(client, 3)
        assert "alert 3" in [r["issue"] for r in found], "with no further event"
        await app.state.events.settled()
        assert len(await open_runs(client)) == 3, "once"


@pytest.mark.db
async def test_a_fault_during_the_wait_starts_its_run_when_the_wait_ends(url):
    app = event_app(url)
    async with running(app) as client:
        await failed_triggered_run(app, client)
        await client.post("/events/ngsi", json=notification(status(MACHINE, "new-fault")), headers=AUTH)
        await runs_are(client, 1)
        later_by(app, 301)
        found = await runs_are(client, 2)
    assert "Machine event: status=new-fault" in [r["issue"] for r in found]


@pytest.mark.db
async def test_an_alert_and_a_quiet_write_during_the_wait_dont_replace_each_other(url):
    app = event_app(url)
    async with running(app) as client:
        await failed_triggered_run(app, client)
        await client.post(
            "/events/alert", json={"resource": MACHINE, "event": "Hot", "severity": "major"}, headers=AUTH
        )
        await client.post("/events/ngsi", json=notification(status(MACHINE, f"{FAIL} a")), headers=AUTH)
        await runs_are(client, 1)  # both handled, within the wait
        later_by(app, 301)
        found = await runs_are(client, 2)
    assert "Alert Hot" in [r["issue"] for r in found]


@pytest.mark.db
async def test_the_wait_ends_by_itself_without_any_further_event(url):
    app = event_app(url)
    async with running(app) as client:
        await failed_triggered_run(app, client)
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "held"}, headers=AUTH)
        await runs_are(client, 1)
        later_by(app, 301)
        with_worker_only = asyncio.get_running_loop().time() + 12
        while len(await open_runs(client)) < 2:
            assert asyncio.get_running_loop().time() < with_worker_only, "nothing looked at what was held"
            await asyncio.sleep(0.2)


@pytest.mark.db
async def test_the_wait_holds_after_a_restart(url):
    app = event_app(url)
    async with running(app) as client:
        await failed_triggered_run(app, client)
    app = event_app(url)
    async with running(app) as client:
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "first after the start"}, headers=AUTH)
        await app.state.events.settled()
        assert len(await open_runs(client)) == 1


@pytest.mark.db
async def test_a_short_name_held_back_by_a_longer_identifier_starts_a_run_once_nothing_holds_it(url):
    app = event_app(url)
    async with running(app) as client:
        await client.post("/events/alert", json={"machine_id": GATED, "issue": "one"}, headers=AUTH)
        await eventually(lambda: GATED in app.state.context.started)
        await client.post("/events/ngsi", json=notification(status("gated", "fault")), headers=AUTH)
        [only] = await runs_are(client, 1)
        app.state.context.gate.set()
        await until(client, only["run_id"], "awaiting_input")
        await client.post("/events/ngsi", json=notification(status("gated", "fault")), headers=AUTH)
        assert len(await runs_are(client, 2)) == 2, "the same values, once nothing holds them back"


@pytest.mark.db
@pytest.mark.parametrize(
    ("state", "kind"),
    [("25006", StoreUnavailable), ("53300", StoreUnavailable), ("42501", StoreUnavailable), ("54000", StoreRefused)],
)
async def test_only_what_is_wrong_with_the_data_is_refused(url, state, kind):
    db = Database(url, 1)
    with pytest.raises(StoreUnavailable) as raised:
        async with db.transaction() as conn:
            await conn.execute(f"DO $$ BEGIN RAISE EXCEPTION 'x' USING ERRCODE='{state}'; END $$")
    await db.close()
    assert type(raised.value) is kind


@pytest.mark.db
async def test_a_read_only_database_holds_an_event_until_it_can_write(url):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)
        db = app.state.runs._store._db
        transaction = db.transaction

        @contextlib.asynccontextmanager
        async def read_only():
            async with transaction() as conn:
                await conn.execute("SET TRANSACTION READ ONLY")
                yield conn

        db.transaction = read_only
        app.state.events._retry_s = 0.01
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "real"}, headers=AUTH)
        await asyncio.sleep(0.5)
        assert await open_runs(client) == []
        assert app.state.events._queue._unfinished_tasks == 1, "still held"
        db.transaction = transaction
        assert len(await runs_are(client, 1)) == 1


@pytest.mark.db
async def test_a_limit_error_doesnt_stick_the_worker(url):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)
        save = app.state.runs._store.save
        db = app.state.runs._store._db
        failing = [True]

        async def too_big(run, *rest):
            if failing:
                failing.pop()
                async with db.transaction() as conn:
                    await conn.execute("DO $$ BEGIN RAISE EXCEPTION 'x' USING ERRCODE='54000'; END $$")
            return await save(run, *rest)

        app.state.runs._store.save = too_big
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "too big"}, headers=AUTH)
        await client.post("/events/alert", json={"machine_id": OTHER_MACHINE, "issue": "next"}, headers=AUTH)
        [only] = await runs_are(client, 1)
    assert only["machine_id"] == OTHER_MACHINE


@pytest.mark.db
async def test_a_body_over_the_limit_is_refused_before_anything_is_read_as_json(url):
    async with running(event_app(url)) as client:
        body = b'{"data":[{"id":"urn:m","status":"' + b"x" * (10 * 1024 * 1024) + b'"}]}'
        for path in ("/events/ngsi", "/events/alert"):
            answer = await client.post(path, content=body, headers=AUTH)
            assert answer.status_code == 413
            assert answer.json()["error"]["kind"] == "invalid"
        assert (await client.post("/events/ngsi", content=body, headers={})).status_code == 401
        assert await runs_are(client, 0) == []


@pytest.mark.db
async def test_an_operators_issue_the_database_cant_store_gives_no_server_error(url):
    async with running(event_app(url)) as client:
        started = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "bad\x00issue"})
        assert started.status_code == 202
        [only] = await open_runs(client)
        assert only["issue"] == "badissue"
        for body in ({"machine_id": MACHINE, "issue": "\x00"}, {"machine_id": "\x00", "issue": "x"}):
            assert (await client.post("/api/agent/run", json=body)).status_code == 422


@pytest.mark.db
async def test_a_refused_operators_run_is_invalid_not_a_server_error(url):
    app = event_app(url)
    async with running(app) as client:
        await open_runs(client)

        async def refused(run, *rest):
            raise StoreRefused("The memory database refused the request.")

        app.state.runs._store.save = refused
        answer = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "x"})
    assert answer.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"machine_id": "\x00", "issue": "x"},
        {"machine_id": "urn:m", "issue": "\x00"},
        {"machine_id": "urn:m", "issue": " \x00 "},
        {"resource": "\x00", "event": "E"},
    ],
)
def test_nothing_left_after_cleaning_is_refused(body):
    with pytest.raises(Refused) as refused:
        alert_event(body)
    assert refused.value.kind == "invalid"


def test_a_machine_or_value_of_nul_alone_gives_no_event():
    assert ngsi_events(notification(status("\x00\x00", "fault")), WATCHED) == ([], 1)
    [event], ignored = ngsi_events(notification(status("urn:m", "\x00")), WATCHED)
    assert (event.issue, ignored) == ("Machine event: state change detected", 0)


@pytest.mark.db
async def test_an_operators_failed_run_holds_nothing_up(url):
    app = event_app(url)
    async with running(app) as client:
        run_id = await start(client, MACHINE, FAIL)
        await until(client, run_id, "failed")
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "x"}, headers=AUTH)
        assert len(await runs_are(client, 2)) == 2


@pytest.mark.db
async def test_a_short_name_that_cant_be_resolved_counts_as_the_machine_in_progress(url):
    app = event_app(url)
    async with running(app) as client:
        await client.post("/events/alert", json={"machine_id": GATED, "issue": "one"}, headers=AUTH)
        await eventually(lambda: GATED in app.state.context.started)
        await client.post("/events/alert", json={"machine_id": "gated", "issue": "two"}, headers=AUTH)
        assert len(await runs_are(client, 1)) == 1
        await client.post("/events/alert", json={"machine_id": "press-02", "issue": "other"}, headers=AUTH)
        assert len(await runs_are(client, 2)) == 2
        app.state.context.gate.set()


def test_an_attribute_as_an_object_without_a_value_key_counts():
    [event], _ = ngsi_events(notification({"id": "urn:m", "status": {"type": "Property", "code": 7}}), WATCHED)
    assert event.issue == "Machine event: status={'code': 7}"
    [empty], _ = ngsi_events(notification({"id": "urn:m", "status": {"type": "Property"}}), WATCHED)
    assert empty.issue == "Machine event: state change detected"


# ── The subscription ─────────────────────────────────────────────────────────


class Broker:
    """The context broker's subscription routes."""

    def __init__(self):
        self.calls = []
        self.subscription = None
        self.answer = None
        self.delivery = "ok"

    def __call__(self, request):
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, request.url.path, body, request.headers.get("authorization")))
        if self.answer is not None:
            if isinstance(self.answer, Exception):
                raise self.answer
            return httpx.Response(self.answer, json={"detail": f"quoted {SECRET}"})
        if request.method == "POST":
            if self.subscription:
                return httpx.Response(409, json={"detail": "exists"})
            self.subscription = body
            return httpx.Response(201)
        if request.method == "PATCH":
            if not self.subscription:
                return httpx.Response(404)
            self.subscription = {**self.subscription, **body}
            return httpx.Response(204)
        if not self.subscription:
            return httpx.Response(404)
        return httpx.Response(200, json={**self.subscription, "notification": {"status": self.delivery}})

    def methods(self):
        return [c[0] for c in self.calls]


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


def watch(fake, token=lambda: None, identity_required=False, clock=None, identity_problem=lambda: None, **settings):
    values = {
        "callback_base_url": "http://xana:8000/",
        "event_webhook_secret": SECRET,
        "ngsi_url": "http://broker:9090",
    }
    return MachineWatch(
        make_settings(**(values | settings)),
        token,
        identity_required,
        transport=httpx.MockTransport(fake),
        clock=clock or Clock(),
        tick_s=0.01,
        identity_problem=identity_problem,
    )


async def test_what_is_subscribed():
    fake = Broker()
    subscription = watch(fake)
    await subscription.check()
    assert subscription.state == ACTIVE
    sent = fake.subscription
    assert sent["id"] == SUBSCRIPTION_ID == "urn:ngsi-ld:Subscription:XanaPDT:MachineWatch"
    assert sent["entities"] == [{"type": "Machine"}]
    assert sent["watchedAttributes"] == ["status", "errorCode", "alarmLevel", "faultCode"]
    endpoint = sent["notification"]["endpoint"]
    assert endpoint["uri"] == "http://xana:8000/events/ngsi"
    assert endpoint["receiverInfo"] == [{"key": "Authorization", "value": f"Bearer {SECRET}"}]
    assert sent["@context"] == ["https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context.jsonld"]
    assert SECRET not in subscription.detail


async def test_type_and_attributes_can_be_set():
    fake = Broker()
    base = "https://platform.example.org/v0.1/"
    await watch(
        fake, machine_watch_type=f"{base}Machine", machine_watch_attributes=f"{base}status, {base}machine_state"
    ).check()
    assert fake.subscription["entities"] == [{"type": f"{base}Machine"}]
    assert fake.subscription["watchedAttributes"] == [f"{base}status", f"{base}machine_state"]
    [event], _ = ngsi_events(
        notification({"id": "urn:m", f"{base}machine_state": {"value": "down"}, "status": {"value": "unwatched"}}),
        [f"{base}machine_state"],
    )
    assert event.issue == "Machine event: machine_state=down"


async def test_it_names_the_configured_context():
    fake = Broker()
    await watch(fake, ngsi_context_url="https://contexts.example.org/c.jsonld").check()
    assert fake.subscription["@context"] == ["https://contexts.example.org/c.jsonld"]


async def test_no_identity_no_subscription_and_it_keeps_trying():
    fake = Broker()
    tokens = [None]
    subscription = watch(fake, token=lambda: tokens[0], identity_required=True)
    await subscription.check()
    assert subscription.state == WAITING
    assert fake.calls == []
    tokens[0] = "a-token"
    await subscription.check()
    assert subscription.state == ACTIVE
    assert fake.calls[0][3] == "Bearer a-token"


async def test_with_sign_in_off_no_identity_is_needed():
    fake = Broker()
    subscription = watch(fake)
    await subscription.check()
    assert subscription.state == ACTIVE
    assert fake.calls[0][3] is None


async def test_the_loop_retries_by_itself_and_survives_what_it_didnt_expect():
    fake = Broker()
    tokens = iter([None, None])

    def token():
        try:
            return next(tokens)
        except StopIteration:
            return "later"

    subscription = watch(fake, token=token, identity_required=True)
    subscription.start()
    await wait_for(lambda: subscription.state == ACTIVE)
    await subscription.stop()

    broken = watch(Broker())

    async def raises():
        raise RuntimeError("unexpected")

    broken.check = raises
    broken.start()
    await wait_for(lambda: broken.state == FAILED)
    await broken.stop()


async def test_a_restart_updates_and_creates_no_duplicate():
    fake = Broker()
    await watch(fake).check()
    await watch(fake, callback_base_url="http://moved:8000", event_webhook_secret="rotated").check()
    assert fake.methods() == ["POST", "POST", "PATCH"]
    endpoint = fake.subscription["notification"]["endpoint"]
    assert endpoint["uri"] == "http://moved:8000/events/ngsi"
    assert endpoint["receiverInfo"][0]["value"] == "Bearer rotated"
    assert fake.subscription["id"] == SUBSCRIPTION_ID


async def test_removed_it_is_created_again():
    fake, clock = Broker(), Clock()
    subscription = watch(fake, clock=clock)
    await subscription.check()
    await subscription.check()
    assert fake.methods() == ["POST"]  # not yet time to look
    fake.subscription = None
    clock.now += 61
    await subscription.check()
    assert fake.methods() == ["POST", "GET", "POST"]
    assert fake.subscription and subscription.state == ACTIVE


async def test_not_delivering_shows_and_clears():
    fake, clock = Broker(), Clock()
    subscription = watch(fake, clock=clock)
    await subscription.check()
    fake.delivery = "failed"
    clock.now += 61
    await subscription.check()
    assert subscription.state == DELIVERY_FAILING
    fake.delivery = "ok"
    clock.now += 61
    await subscription.check()
    assert subscription.state == ACTIVE


@pytest.mark.parametrize("status_code", [400, 401, 403, 500, 503])
async def test_a_refusal_says_why_without_the_secret_and_tries_again(status_code, caplog):
    fake = Broker()
    fake.answer = status_code
    subscription = watch(fake)
    with caplog.at_level(logging.DEBUG):
        await subscription.check()
    assert subscription.state == FAILED
    assert str(status_code) in subscription.detail
    assert SECRET not in subscription.detail
    assert SECRET not in caplog.text
    fake.answer = None
    await subscription.check()
    assert subscription.state == ACTIVE


async def test_a_broker_that_cant_be_reached():
    fake = Broker()
    fake.answer = httpx.ConnectError("refused")
    subscription = watch(fake)
    await subscription.check()
    assert subscription.state == BROKER_UNREACHABLE
    assert "could not be reached" in subscription.detail
    settings = make_settings()
    service = HealthService(
        settings, Migrator(settings.postgres_memory_url.get_secret_value()), machine_watch=subscription
    )
    assert (await service._machine_events_check())[0] == "degraded", "the broker's own check is the red one"


async def test_signed_out_a_subscription_stays_and_isnt_called_without_a_token():
    fake, clock = Broker(), Clock()
    tokens = ["a"]
    subscription = watch(fake, token=lambda: tokens[0], identity_required=True, clock=clock)
    await subscription.check()
    tokens[0] = None
    clock.now += 61
    await subscription.check()
    assert subscription.state == ACTIVE
    assert fake.methods() == ["POST"]


async def test_in_a_tenant_the_check_says_nothing_will_arrive():
    fake, clock = Broker(), Clock()
    subscription = watch(fake, clock=clock, ngsi_tenant="plant-1")
    await subscription.check()
    assert fake.subscription
    assert subscription.state == TENANT_LIMIT
    assert "delivers nothing" in subscription.detail and "may not arrive" in subscription.detail
    clock.now += 61
    await subscription.check()
    assert subscription.state == TENANT_LIMIT
    settings = make_settings()
    service = HealthService(
        settings, Migrator(settings.postgres_memory_url.get_secret_value()), machine_watch=subscription
    )
    assert (await service._machine_events_check())[0] == "degraded"


async def test_while_waiting_it_says_why_the_service_identity_failed():
    subscription = watch(
        Broker(), token=lambda: None, identity_required=True, identity_problem=lambda: "The provider answered HTTP 401."
    )
    await subscription.check()
    assert subscription.state == WAITING
    assert "The provider answered HTTP 401." in subscription.detail


def test_not_configured_doesnt_start():
    subscription = MachineWatch(make_settings(), lambda: None, False)
    assert subscription.state == "not_configured"
    subscription.start()
    assert subscription._task is None


# ── In the health report ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("state", "expected"),
    [(ACTIVE, "ok"), (WAITING, "degraded"), (DELIVERY_FAILING, "degraded"), (FAILED, "error")],
)
async def test_each_state_in_the_health_report(state, expected):
    settings = make_settings()
    subscription = watch(Broker())
    subscription.state, subscription.detail = state, "the detail"
    service = HealthService(
        settings, Migrator(settings.postgres_memory_url.get_secret_value()), machine_watch=subscription
    )
    status_, detail = await service._machine_events_check()
    assert (status_, detail) == (expected, "the detail")


async def test_not_configured_doesnt_count_towards_overall():
    async def fine():
        return "ok", "fine"

    settings = make_settings()
    service = HealthService(settings, Migrator(settings.postgres_memory_url.get_secret_value()))
    probes = {"memory": fine, "machine_events": service._machine_events_check}
    service._probes = probes
    report = await service.report()
    assert report["overall"] == "ok"
    assert next(c for c in report["checks"] if c["id"] == "machine_events")["detail"].startswith(
        "Machine events aren't"
    )


# ── Settings ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("values", "named"),
    [
        ({"callback_base_url": "http://x"}, "EVENT_WEBHOOK_SECRET"),
        ({"keycloak_url": "http://k", "keycloak_service_client_id": "c"}, "KEYCLOAK_SERVICE_CLIENT_SECRET"),
        ({"keycloak_url": "http://k", "keycloak_service_client_secret": "s3cr3t"}, "KEYCLOAK_SERVICE_CLIENT_ID"),
        ({"keycloak_service_client_id": "c", "keycloak_service_client_secret": "s3cr3t"}, "KEYCLOAK_URL"),
        ({"event_webhook_secret": "with space"}, "EVENT_WEBHOOK_SECRET"),
    ],
)
def test_incomplete_settings_stop_the_backend_naming_the_variable(values, named):
    with pytest.raises(ConfigError) as refused:
        load_settings(_env_file=None, **values)
    assert named in str(refused.value)
    assert "s3cr3t" not in str(refused.value)
    assert "with space" not in str(refused.value)


def test_the_new_secrets_are_redacted():
    settings = make_settings(
        event_webhook_secret=SECRET,
        keycloak_url="http://k",
        keycloak_service_client_id="c",
        keycloak_service_client_secret="service-client-secret",
    )
    redact = settings.redactor()
    assert SECRET not in redact(f"x {SECRET} y")
    assert "service-client-secret" not in redact("x service-client-secret y")


# ── The service identity ─────────────────────────────────────────────────────


def identity(transport, clock=None, retry_s=0.01):
    settings = make_settings(
        keycloak_url="http://keycloak/auth/",
        keycloak_realm="iff",
        keycloak_service_client_id="xana-events",
        keycloak_service_client_secret="service-client-secret",
    )
    return ServiceIdentity(settings, transport=httpx.MockTransport(transport), clock=clock or Clock(), retry_s=retry_s)


def token_answer(token="service-token", expires_in=300):  # noqa: S107
    return httpx.Response(200, json={"access_token": token, "expires_in": expires_in})


async def test_it_asks_with_client_credentials():
    seen = []

    def answer(request):
        seen.append((str(request.url), request.content.decode()))
        return token_answer()

    service = identity(answer)
    assert service.token() is None
    assert await service.renew() == 300
    assert service.token() == "service-token"
    assert seen[0][0] == "http://keycloak/auth/realms/iff/protocol/openid-connect/token"
    assert "grant_type=client_credentials" in seen[0][1]
    assert "client_id=xana-events" in seen[0][1]


async def test_a_token_that_ran_out_isnt_used():
    clock = Clock()
    service = identity(lambda r: token_answer(expires_in=100), clock=clock)
    await service.renew()
    clock.now += 101
    assert service.token() is None


@pytest.mark.parametrize(
    "answer",
    [
        lambda r: httpx.Response(401, json={"error": "invalid_client"}),
        lambda r: httpx.Response(200, text="not json"),
        lambda r: httpx.Response(200, json={"access_token": "x"}),
        lambda r: httpx.Response(200, json={"access_token": 3, "expires_in": 300}),
        lambda r: httpx.Response(200, json=[]),
    ],
)
async def test_a_failure_says_why_naming_no_value(answer, caplog):
    service = identity(answer)
    with caplog.at_level(logging.DEBUG, logger="app"):
        assert await service.renew() is None
    assert service.token() is None
    assert service.problem
    assert "service-client-secret" not in (service.problem + caplog.text)


async def test_it_keeps_trying_with_no_limit():
    attempts = []

    def answer(request):
        attempts.append(1)
        if len(attempts) < 20:
            raise httpx.ConnectError("refused")
        return token_answer()

    service = identity(answer)
    service.start()
    await wait_for(lambda: service.token() == "service-token")
    assert service.problem is None
    await service.close()


async def test_it_renews_before_the_end():
    answers = iter(["first", "second"])

    def answer(request):
        return token_answer(next(answers, "later"), expires_in=61)

    service = identity(answer)
    service.start()
    await wait_for(lambda: service.token() == "first")
    await wait_for(lambda: service.token() == "second", within=3)
    await service.close()


def test_without_its_settings_it_isnt_configured():
    service = ServiceIdentity(make_settings())
    assert not service.configured
    service.start()
    assert service._task is None


# ── Which token each kind of run sends: the whole app, on a recording platform ──────────


class _Platform(BaseHTTPRequestHandler):
    """Keycloak and the context broker, recording the token of every read."""

    reads: list = []
    grants: list = []

    def log_message(self, *args):
        pass

    def _send(self, status_code, body=None):
        payload = json.dumps(body).encode() if body is not None else b""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        content = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        if "/protocol/openid-connect/token" in self.path:
            kind = "client_credentials" if "client_credentials" in content else "password"
            self.grants.append(kind)
            token = "service-token" if kind == "client_credentials" else _operator_jwt()
            self._send(200, {"access_token": token, "refresh_token": "r", "expires_in": 300})
        elif "/protocol/openid-connect/logout" in self.path:
            self._send(204)
        else:
            self._send(201)

    def do_GET(self):
        path = self.path.split("?")[0]
        self.reads.append((path, self.headers.get("Authorization")))
        if path.endswith("/types"):
            self._send(200, {"typeList": []})
        elif "/entities/" in path:
            self._send(200, {"id": MACHINE, "type": "Machine"})
        else:
            self._send(200, [])


def _operator_jwt():
    import base64

    def part(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()

    return f"{part({})}.{part({'preferred_username': 'operator'})}.sig"


@pytest.fixture
def platform():
    _Platform.reads, _Platform.grants = [], []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Platform)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()


def whole_app(url, platform, service_client=True):
    values = {
        "postgres_memory_url": url,
        "ngsi_url": platform,
        "keycloak_url": platform,
        "llm_provider": "scripted",
        "event_webhook_secret": SECRET,
    }
    if service_client:
        values |= {"keycloak_service_client_id": "xana-events", "keycloak_service_client_secret": "service-secret"}
    return create_app(make_settings(**values))


def entity_reads(run_finished_after=0):
    return [token for path, token in _Platform.reads[run_finished_after:] if f"/entities/{MACHINE}" in path]


async def wait_for_token(app):
    await wait_for(lambda: app.state.service_identity.token() is not None)


async def app_client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def finished_round(client, run_id):
    return await until(client, run_id, "awaiting_input", "awaiting_confirmation", "failed", within=20)


@pytest.mark.db
async def test_a_triggered_run_with_nobody_signed_in_uses_the_service_identity(url, platform):
    app = whole_app(url, platform)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await wait_for_token(app)
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "x"}, headers=AUTH)
        [listed] = await runs_are(client, 1)
        await finished_round(client, listed["run_id"])
        assert entity_reads()
        assert set(entity_reads()) == {"Bearer service-token"}


@pytest.mark.db
async def test_a_triggered_run_uses_it_with_an_operator_signed_in_too_and_after_a_restart(url, platform):
    app = whole_app(url, platform)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await wait_for_token(app)
        signed_in = await client.post("/api/auth/connect", json={"username": "operator", "password": "x"})
        assert signed_in.status_code == 200
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "x"}, headers=AUTH)
        [listed] = await runs_are(client, 1)
        run_id = listed["run_id"]
        await finished_round(client, run_id)
        assert set(entity_reads()) == {"Bearer service-token"}

    # An answer after the restart: a new round, with nobody signed in.
    _Platform.reads.clear()
    app = whole_app(url, platform)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await wait_for_token(app)
        await clarify(client, run_id)
        await finished_round(client, run_id)
        assert set(entity_reads()) == {"Bearer service-token"}


@pytest.mark.db
async def test_a_run_an_operator_started_never_uses_the_service_identity(url, platform):
    app = whole_app(url, platform)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await wait_for_token(app)
        run_id = await start(client, MACHINE)
        await finished_round(client, run_id)
        assert entity_reads()
        assert set(entity_reads()) == {None}

        _Platform.reads.clear()
        await client.post("/api/auth/connect", json={"username": "operator", "password": "x"})
        await clarify(client, run_id)
        await finished_round(client, run_id)
        assert entity_reads()
        assert "Bearer service-token" not in set(entity_reads())


@pytest.mark.db
async def test_the_routes_under_api_never_use_the_service_identity(url, platform):
    app = whole_app(url, platform)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await wait_for_token(app)
        _Platform.reads.clear()
        await client.get("/api/ngsi/types")
        await client.get(f"/api/ngsi/entities/{MACHINE}")
        await client.get("/api/diagnostics?fresh=true")
        assert _Platform.reads
        assert all(token is None for _, token in _Platform.reads)


@pytest.mark.db
async def test_without_a_service_client_a_triggered_run_uses_the_operator(url, platform):
    app = whole_app(url, platform, service_client=False)
    async with app.router.lifespan_context(app), await app_client(app) as client:
        await client.post("/api/auth/connect", json={"username": "operator", "password": "x"})
        await client.post("/events/alert", json={"machine_id": MACHINE, "issue": "x"}, headers=AUTH)
        [listed] = await runs_are(client, 1)
        await finished_round(client, listed["run_id"])
        assert entity_reads()
        assert all(token and token != "Bearer service-token" for token in entity_reads())


_DOUBLE = "http://www.w3.org/2001/XMLSchema#double"


@pytest.mark.parametrize(
    ("value", "shown"),
    [
        ({"type": _DOUBLE, "@value": 3}, "3"),  # compacted, as the broker sends it (gh-84)
        ({"type": _DOUBLE, "@value": "3"}, "3.0"),  # a live string merged onto a declared double
        ({"@type": _DOUBLE, "@value": 3}, "3"),  # expanded
    ],
)
def test_a_declared_value_in_a_notification(value, shown):
    [event], _ = ngsi_events(
        notification({"id": "urn:m:1", "alarmLevel": {"type": "Property", "value": value}}), WATCHED)
    assert event.issue == f"Machine event: alarmLevel={shown}"
