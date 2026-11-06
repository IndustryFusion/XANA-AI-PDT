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
"""Incident numbers, the memory of confirmed diagnoses, history records, filters and reopening."""

import pytest

from tests.runs_support import (
    LATHE,
    MACHINE,
    OTHER_MACHINE,
    clarify,
    confirm,
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


async def archived(client, run_id):
    assert (await client.post(f"/api/agent/archive/{run_id}")).status_code == 204
    [incident] = [i for i in (await client.get("/api/incidents")).json() if i["number"] == incident_number[run_id]]
    return incident


incident_number: dict[str, int] = {}


async def paused(client, machine_id=MACHINE, issue="Oil too hot"):
    run_id = await start(client, machine_id, issue)
    run = await until(client, run_id, "awaiting_input")
    incident_number[run_id] = run["incident_id"]
    return run_id


# ── Incident numbers ─────────────────────────────────────────────────────────


async def test_numbers_are_given_at_the_first_pause_and_increase(url):
    async with running(make_app(url)) as client:
        first = await paused(client)
        second = await paused(client)
    assert incident_number[second] == incident_number[first] + 1


async def test_number_is_kept_across_rounds_and_into_history(url):
    async with running(make_app(url)) as client:
        run_id = await paused(client)
        await clarify(client, run_id)
        run = await until(client, run_id, "awaiting_confirmation")
        assert run["incident_id"] == incident_number[run_id]
        await confirm(client, run_id)
        incident = await archived(client, run_id)
    assert incident["number"] == incident_number[run_id]


async def test_running_run_has_no_number_yet(url):
    from tests.runs_support import GATED

    app = make_app(url)
    async with running(app) as client:
        run_id = await start(client, GATED)
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["incident_id"] is None
        app.state.context.gate.set()
        await until(client, run_id)


# ── Memory of confirmed diagnoses ────────────────────────────────────────────


def past_incidents(run):
    decide = [s for s in run["steps"] if s["node"] == "decide"][-1]
    return decide["output"]["past_incidents"]


async def test_confirmed_incident_is_found_by_the_next_run_also_after_a_restart(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        confirmed = await confirm(client, run_id)
        later = await until(client, await start(client, MACHINE, "Oil too hot again"))
    [past] = past_incidents(later)
    assert past["root_cause"] == confirmed["data"]["root_cause"]
    assert past["machine_id"] == MACHINE
    assert past["resolution"] == confirmed["data"]["recommended_action"]

    async with running(make_app(url)) as client:
        after_restart = await until(client, await start(client, MACHINE, "And again"))
    assert [p["root_cause"] for p in past_incidents(after_restart)] == [confirmed["data"]["root_cause"]]


async def test_unconfirmed_and_other_machines_are_not_past_incidents(url):
    async with running(make_app(url)) as client:
        await paused(client)
        other = await to_confirmation(client, LATHE, "Other machine type")
        await confirm(client, other)
        later = await until(client, await start(client, MACHINE, "Oil too hot"))
    assert past_incidents(later) == []


async def test_same_machine_type_is_found_after_the_same_machine(url):
    async with running(make_app(url)) as client:
        sibling = await to_confirmation(client, OTHER_MACHINE, "Pressure drop")
        await confirm(client, sibling)
        own = await to_confirmation(client, MACHINE, "Oil too hot")
        await confirm(client, own)
        sibling_again = await to_confirmation(client, OTHER_MACHINE, "Pressure drop again")
        await confirm(client, sibling_again)
        later = await until(client, await start(client, MACHINE, "Noise"))
    assert [p["machine_id"] for p in past_incidents(later)] == [MACHINE, OTHER_MACHINE, OTHER_MACHINE]
    assert [p["issue"] for p in past_incidents(later)][1:] == ["Pressure drop again", "Pressure drop"]


# ── History records ──────────────────────────────────────────────────────────


async def test_completed_run_archived(url):
    async with running(make_app(url)) as client:
        run_id = await paused(client)
        await clarify(client, run_id)
        await until(client, run_id, "awaiting_confirmation")
        run = await confirm(client, run_id)
        incident = await archived(client, run_id)
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert incident["outcome"] == "completed"
    assert incident["root_cause"] == run["data"]["root_cause"]
    assert detail["decision"]["root_cause"] == run["data"]["root_cause"]
    assert detail["decision"]["confidence"] == run["data"]["confidence"]
    assert detail["resolution"] == run["data"]["recommended_action"]
    assert [(s["node"], s["round"]) for s in detail["trace"]] == [(s["node"], s["round"]) for s in run["steps"]]
    assert [s["input"] for s in detail["trace"]] == [s["input"] for s in run["steps"]]
    assert [s["output"] for s in detail["trace"]] == [s["output"] for s in run["steps"]]
    assert detail["started_at"] == run["started_at"]
    assert detail["closed_at"] >= run["updated_at"]
    assert {"builder", "escalation", "conversation"} <= set(detail)
    assert set(incident) == {
        "id",
        "number",
        "machine_id",
        "issue",
        "outcome",
        "root_cause",
        "escalated",
        "escalation_ref",
        "started_at",
        "closed_at",
        "reopened_run_id",
    }


async def test_stopped_run_archived(url):
    async with running(make_app(url)) as client:
        run_id = await paused(client)
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        await client.post(f"/api/agent/stop/{run_id}", json={"reason": "Machine taken out of service"})
        incident = await archived(client, run_id)
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert incident["outcome"] == "stopped"
    assert detail["decision"] == run["steps"][-1]["output"]
    assert detail["resolution"] == "Machine taken out of service"


async def test_failed_run_archived(url):
    async with running(make_app(url)) as client:
        run_id = await start(client, MACHINE, "FAIL-THIS-ROUND")
        run = await until(client, run_id, "failed")
        incident_number[run_id] = run["incident_id"]
        incident = await archived(client, run_id)
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert incident["outcome"] == "failed"
    assert detail["resolution"] == f"The run failed: {run['data']['error']}"


# ── List and filter ──────────────────────────────────────────────────────────


async def test_filter_by_machine_and_outcome(url):
    async with running(make_app(url)) as client:
        for machine in (MACHINE, OTHER_MACHINE, MACHINE):
            run_id = await to_confirmation(client, machine)
            await confirm(client, run_id)
            await client.post(f"/api/agent/archive/{run_id}")
        stopped = await paused(client)
        await client.post(f"/api/agent/stop/{stopped}")
        await client.post(f"/api/agent/archive/{stopped}")
        listed = (await client.get("/api/incidents", params={"machine_id": MACHINE, "status": "completed"})).json()
        both = (await client.get("/api/incidents", params={"status": "completed,stopped"})).json()
        everything = (await client.get("/api/incidents")).json()
    assert [i["machine_id"] for i in listed] == [MACHINE, MACHINE]
    assert all(i["outcome"] == "completed" for i in listed)
    assert listed[0]["closed_at"] > listed[1]["closed_at"]
    assert len(both) == len(everything) == 4
    assert [i["closed_at"] for i in everything] == sorted((i["closed_at"] for i in everything), reverse=True)


async def test_date_range_is_inclusive(url):
    async with running(make_app(url)) as client:
        ids = []
        for _ in range(5):
            run_id = await paused(client)
            await client.post(f"/api/agent/stop/{run_id}")
            await client.post(f"/api/agent/archive/{run_id}")
            ids.append(run_id)
        closed = [
            "2026-10-31 23:59:59+00",
            "2026-11-01 00:00:00+00",
            "2026-11-02 12:00:00+00",
            "2026-11-03 23:59:59.999+00",
            "2026-11-04 00:00:00+00",
        ]
        for run_id, at in zip(ids, closed, strict=True):
            rows(url, "UPDATE incidents SET closed_at = %s WHERE run_id = %s RETURNING id", at, run_id)
        listed = (await client.get("/api/incidents", params={"from": "2026-11-01", "to": "2026-11-03"})).json()
        open_end = (await client.get("/api/incidents", params={"from": "2026-11-03"})).json()
    assert [i["number"] for i in listed] == [incident_number[r] for r in reversed(ids[1:4])]
    assert len(open_end) == 2


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({"status": "finished"}, "Unknown outcome finished"),
        ({"from": "yesterday"}, "from:"),
        ({"from": "2026-11-03", "to": "2026-11-01"}, "start date is after the end date"),
    ],
)
async def test_invalid_filters(url, params, message):
    async with running(make_app(url)) as client:
        response = await client.get("/api/incidents", params=params)
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "invalid"
    assert message in response.json()["error"]["message"]


@pytest.mark.parametrize("incident_id", ["999", "abc"])
async def test_unknown_incident(url, incident_id):
    async with running(make_app(url)) as client:
        response = await client.get(f"/api/incidents/{incident_id}")
        reopen = await client.post(f"/api/incidents/{incident_id}/reopen")
    assert response.status_code == reopen.status_code == 404
    assert response.json()["error"] == {"kind": "not_found", "message": f"Incident {incident_id} does not exist."}


async def test_confirmed_but_not_archived_run_is_not_in_history(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        await confirm(client, run_id)
        assert (await client.get("/api/incidents")).json() == []
        [(incident_id,)] = rows(url, "SELECT id FROM incidents WHERE run_id = %s", run_id)
        assert (await client.get(f"/api/incidents/{incident_id}")).status_code == 404


# ── Reopen ───────────────────────────────────────────────────────────────────


async def test_reopen_starts_a_new_run_and_refuses_a_second_reopen(url):
    async with running(make_app(url)) as client:
        run_id = await paused(client, MACHINE, "Hydraulic pressure drops")
        await client.post(f"/api/agent/stop/{run_id}")
        incident = await archived(client, run_id)
        response = await client.post(f"/api/incidents/{incident['id']}/reopen")
        assert response.status_code == 202
        new_run = response.json()["run_id"]
        run = await until(client, new_run)
        assert (run["machine_id"], run["issue"]) == (MACHINE, "Hydraulic pressure drops")
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
        assert detail["reopened_run_id"] == new_run

        again = await client.post(f"/api/incidents/{incident['id']}/reopen")
        assert again.status_code == 409
        assert again.json()["error"]["kind"] == "conflict"

        await client.post(f"/api/agent/stop/{new_run}")
        await client.post(f"/api/agent/archive/{new_run}")
        third = await client.post(f"/api/incidents/{incident['id']}/reopen")
        assert third.status_code == 202
        await until(client, third.json()["run_id"])


async def test_reopen_is_refused_while_the_model_is_down(url):
    app = make_app(url)

    async def down():
        return "The language model is not available: gone"

    async with running(app) as client:
        run_id = await paused(client, MACHINE, "Hydraulic pressure drops")
        await client.post(f"/api/agent/stop/{run_id}")
        incident = await archived(client, run_id)
        app.state.runs._model_problem = down
        response = await client.post(f"/api/incidents/{incident['id']}/reopen")
        assert response.status_code == 503
        assert "language model" in response.json()["error"]["message"]
        app.state.runs._model_problem = None
        assert (await client.post(f"/api/incidents/{incident['id']}/reopen")).status_code == 202


async def test_reopening_an_unknown_incident_is_not_found_while_the_model_is_down(url):
    app = make_app(url)

    async def down():
        return "The language model is not available: gone"

    async with running(app) as client:
        app.state.runs._model_problem = down
        assert (await client.post("/api/incidents/999999/reopen")).status_code == 404
