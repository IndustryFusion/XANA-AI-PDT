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
"""Run operations: start, list, status, clarify, confirm or reject, stop, archive, and their refusals."""

import asyncio

import pytest

from tests.runs_support import (
    FAIL,
    GATED,
    MACHINE,
    broker,
    confirm,
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


# ── Start ────────────────────────────────────────────────────────────────────


async def test_start_answers_before_the_first_step(url):
    app = make_app(url)
    async with running(app) as client:
        run_id = await start(client, GATED, "Spindle vibration above normal")
        await eventually(lambda: GATED in app.state.context.started)
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert run["status"] == "running"
        assert run["steps"] == []
        assert run["data"] == {}
        assert run["issue"] == "Spindle vibration above normal"
        listed = (await client.get("/api/agent/runs")).json()
        assert [(r["run_id"], r["status"]) for r in listed] == [(run_id, "running")]
        app.state.context.gate.set()
        await until(client, run_id)


@pytest.mark.parametrize(
    ("matches", "down", "expected"),
    [
        ({"press-01": [MACHINE]}, False, (202, MACHINE)),
        ({}, False, (422, "No machine is named press-01.")),
        ({"press-01": [MACHINE, "urn:ngsi-ld:Component:press-01"]}, False, (422, "names several entities")),
        ({}, True, (202, "press-01")),
    ],
    ids=["one-match", "no-match", "several", "broker-down"],
)
async def test_short_machine_name(url, matches, down, expected):
    async with running(make_app(url, transport=broker(matches, down))) as client:
        response = await client.post("/api/agent/run", json={"machine_id": "press-01", "issue": "Noise"})
        status, detail = expected
        assert response.status_code == status, response.text
        if status == 202:
            run = await until(client, response.json()["run_id"])
            assert run["machine_id"] == detail
        else:
            assert response.json()["error"]["kind"] == "invalid"
            assert detail in response.json()["error"]["message"]
            assert (await client.get("/api/agent/runs")).json() == []


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"machine_id": " ", "issue": "Noise"}, "Enter the machine."),
        ({"machine_id": MACHINE, "issue": ""}, "Describe the issue."),
        ({"machine_id": MACHINE, "issue": "x" * 2001}, "longer than 2000 characters"),
        ({"machine_id": MACHINE}, "issue: Field required"),
    ],
    ids=["empty-machine", "empty-issue", "issue-too-long", "issue-missing"],
)
async def test_start_refuses_invalid_input(url, body, message):
    async with running(make_app(url)) as client:
        response = await client.post("/api/agent/run", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["kind"] == "invalid"
        assert message in response.json()["error"]["message"]
        assert (await client.get("/api/agent/runs")).json() == []
    assert rows(url, "SELECT count(*) FROM runs") == [(0,)]


async def test_issue_of_exactly_2000_characters_is_accepted(url):
    async with running(make_app(url)) as client:
        await until(client, await start(client, MACHINE, "x" * 2000))


# ── Active runs and status ───────────────────────────────────────────────────


async def test_list_includes_finished_runs_newest_first(url):
    async with running(make_app(url)) as client:
        first = await start(client, MACHINE, "First")
        await until(client, first, "awaiting_input")
        second = await start(client, MACHINE, "Second")
        await until(client, second, "awaiting_input")
        third = await start(client, MACHINE, f"Third {FAIL}")
        await until(client, third, "failed")
        listed = (await client.get("/api/agent/runs")).json()
    assert [r["run_id"] for r in listed] == [third, second, first]
    assert [r["status"] for r in listed] == ["failed", "awaiting_input", "awaiting_input"]
    assert set(listed[0]) == {
        "run_id",
        "incident_id",
        "machine_id",
        "issue",
        "status",
        "started_at",
        "updated_at",
        "escalation_ref",
    }


async def test_status_of_a_paused_run(url):
    async with running(make_app(url)) as client:
        run = await until(client, await start(client))
    assert run["status"] == "awaiting_input"
    assert set(run["data"]) == {"question", "confidence", "threshold"}
    assert run["data"]["confidence"] < run["data"]["threshold"] == 0.9
    assert [s["node"] for s in run["steps"]] == ["observe", "hypothesize", "validate", "decide"]
    assert all({"node", "input", "output", "at", "round"} <= set(s) for s in run["steps"])
    assert run["escalation"] is None and run["outbox"] == [] and run["reopenable"] is False
    assert isinstance(run["incident_id"], int)


async def test_unknown_or_archived_run_is_not_found(url):
    async with running(make_app(url)) as client:
        response = await client.get("/api/agent/status/no-such-run")
        assert response.status_code == 404
        assert response.json() == {
            "error": {"kind": "not_found", "message": "Run no-such-run does not exist or was archived."}
        }
        run_id = await start(client, MACHINE, f"Broken {FAIL}")
        await until(client, run_id, "failed")
        assert (await client.post(f"/api/agent/archive/{run_id}")).status_code == 204
        assert (await client.get(f"/api/agent/status/{run_id}")).status_code == 404


# ── Operations allowed per state ─────────────────────────────────────────────

OPERATIONS = {
    "clarify": ("post", "/api/agent/clarify/{}", {"text": "More detail"}),
    "confirm": ("post", "/api/agent/confirm-resolution/{}", {"confirmed": True}),
    "reject": ("post", "/api/agent/confirm-resolution/{}", {"confirmed": False, "text": "Not it"}),
    "stop": ("post", "/api/agent/stop/{}", {}),
    "archive": ("post", "/api/agent/archive/{}", None),
}
ALLOWED = {
    "running": {"stop"},
    "awaiting_input": {"clarify", "stop"},
    "awaiting_confirmation": {"confirm", "reject", "stop"},
    "completed": {"archive"},
    "failed": {"archive"},
    "stopped": {"archive"},
}


async def run_in(client, app, status):
    """A new run in `status`."""
    if status == "running":
        return await start(client, GATED)
    if status == "failed":
        run_id = await start(client, MACHINE, f"Broken {FAIL}")
        await until(client, run_id, "failed")
        return run_id
    if status == "awaiting_input":
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        return run_id
    run_id = await to_confirmation(client)
    if status == "completed":
        await confirm(client, run_id)
    if status == "stopped":
        await client.post(f"/api/agent/stop/{run_id}", json={"reason": "Done for today"})
    return run_id


@pytest.mark.parametrize("status", list(ALLOWED))
async def test_operations_allowed_per_state(url, status):
    app = make_app(url)
    async with running(app) as client:
        for operation, (method, path, body) in OPERATIONS.items():
            run_id = await run_in(client, app, status)
            before = (await client.get(f"/api/agent/status/{run_id}")).json()
            response = await client.request(method.upper(), path.format(run_id), json=body)
            if operation in ALLOWED[status]:
                assert response.status_code in (200, 204), (operation, response.text)
            else:
                assert response.status_code == 409, (operation, response.text)
                assert response.json()["error"]["kind"] == "conflict"
                after = (await client.get(f"/api/agent/status/{run_id}")).json()
                assert after["status"] == before["status"]
                assert len(after["steps"]) >= len(before["steps"])
                if status != "running":
                    assert after == before
        app.state.context.gate.set()


# ── Clarify ──────────────────────────────────────────────────────────────────

IMAGE = {"name": "valve.png", "type": "image/png", "size": 4, "data_url": "data:image/png;base64,iVBORw=="}


async def test_clarification_with_an_image_starts_a_new_round(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        question = (await until(client, run_id, "awaiting_input"))["data"]["question"]
        response = await client.post(
            f"/api/agent/clarify/{run_id}", json={"text": "Filter changed yesterday", "files": [IMAGE]}
        )
        assert response.json() == {"status": "running"}
        run = await until(client, run_id, "awaiting_confirmation")
    clarification = run["steps"][4]
    assert clarification["node"] == "clarification"
    assert clarification["input"] == {"question": question}
    assert clarification["output"] == {
        "text": "Filter changed yesterday",
        "files": [{"name": "valve.png", "type": "image/png", "size": 4}],
    }
    assert [s["round"] for s in run["steps"]] == [1, 1, 1, 1, 1, 2, 2, 2, 2]
    hypothesize = run["steps"][6]
    assert hypothesize["input"]["clarification"] == "Filter changed yesterday"


def _file(n, size=4, **changes):
    return {"name": f"f{n}.txt", "type": "text/plain", "size": size, "data_url": "data:text/plain,abcd"} | changes


@pytest.mark.parametrize(
    ("files", "message"),
    [
        ([_file(n) for n in range(6)], "At most 5 files"),
        ([_file(1, size=10 * 1024 * 1024 + 1)], "larger than 10 MB"),
        ([_file(1, data_url="data:text/plain;base64," + "A" * (14 * 1024 * 1024))], "larger than 10 MB"),
        ([_file(1, type="application/zip", data_url="data:application/zip;base64,UEs=")], "only images, PDF"),
        ([_file(1, data_url="data:image/png;base64,iVBORw==")], "not of the type it claims"),
        ([_file(1, data_url="not a data url")], "could not be read"),
    ],
    ids=["six-files", "declared-too-large", "content-too-large", "zip", "wrong-type", "not-a-data-url"],
)
async def test_clarification_files_are_checked(url, files, message):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        before = await until(client, run_id, "awaiting_input")
        response = await client.post(f"/api/agent/clarify/{run_id}", json={"text": "See files", "files": files})
        assert response.status_code == 422
        assert response.json()["error"]["kind"] == "invalid"
        assert message in response.json()["error"]["message"]
        assert (await client.get(f"/api/agent/status/{run_id}")).json() == before


async def test_empty_clarification_is_refused(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        response = await client.post(f"/api/agent/clarify/{run_id}", json={"text": "  "})
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Enter a clarification or attach a file."


# ── Confirm or reject ────────────────────────────────────────────────────────


async def test_confirm_completes_the_run_through_act(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        proposed = (await client.get(f"/api/agent/status/{run_id}")).json()["data"]
        run = await confirm(client, run_id)
    assert [s["node"] for s in run["steps"]][-2:] == ["resolution", "act"]
    resolution = run["steps"][-2]["output"]
    assert resolution["confirmed"] is True
    assert resolution["root_cause"] == proposed["root_cause"]
    assert run["status"] == "completed"
    assert run["data"] == {
        "root_cause": proposed["root_cause"],
        "recommended_action": proposed["recommended_action"],
        "confidence": proposed["confidence"],
        "incident_logged": True,
    }
    stored = rows(url, "SELECT root_cause, confirmed FROM incidents WHERE run_id = %s", run_id)
    assert stored == [(proposed["root_cause"], True)]


async def test_reject_starts_a_round_without_the_rejected_root_cause(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        first = (await client.get(f"/api/agent/status/{run_id}")).json()["data"]
        response = await client.post(
            f"/api/agent/confirm-resolution/{run_id}",
            json={"confirmed": False, "text": "Bearing was replaced last week"},
        )
        assert response.json() == {"status": "running"}
        run = await until(client, run_id, "awaiting_confirmation")
    resolution = next(s for s in run["steps"] if s["node"] == "resolution")
    assert resolution["output"]["confirmed"] is False
    assert resolution["output"]["reason"] == "Bearing was replaced last week"
    assert run["data"]["root_cause"] != first["root_cause"]
    [rejected] = run["data"]["rejected"]
    assert rejected["root_cause"] == first["root_cause"]
    assert rejected["recommended_action"] == first["recommended_action"]
    assert rejected["reason"] == "Bearing was replaced last week"
    assert rejected["at"]
    assert max(s["round"] for s in run["steps"]) == 3


async def test_reject_without_reason_is_refused(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        response = await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": False})
        assert response.status_code == 422
        assert response.json()["error"]["kind"] == "invalid"
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_confirmation"


# ── Stop and archive ─────────────────────────────────────────────────────────


async def test_stop_cancels_the_round_in_progress(url):
    app = make_app(url)
    async with running(app) as client:
        run_id = await start(client, GATED)
        await eventually(lambda: GATED in app.state.context.started)
        response = await client.post(f"/api/agent/stop/{run_id}", json={"reason": "Wrong machine"})
        assert response.json() == {"status": "stopped"}
        app.state.context.gate.set()
        await asyncio.sleep(0.2)
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
    assert run["status"] == "stopped"
    assert run["steps"] == []
    assert run["data"] == {"by": "operator", "reason": "Wrong machine", "reopenable": False}


async def test_stop_without_a_body(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        response = await client.post(f"/api/agent/stop/{run_id}")
        assert response.json() == {"status": "stopped"}
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
    assert run["data"] == {"by": "operator", "reason": None, "reopenable": False}


async def test_archive_moves_the_run_to_history(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        await confirm(client, run_id)
        assert (await client.post(f"/api/agent/archive/{run_id}")).status_code == 204
        assert (await client.get("/api/agent/runs")).json() == []
        history = (await client.get("/api/incidents")).json()
    assert [(i["machine_id"], i["outcome"]) for i in history] == [(MACHINE, "completed")]
    assert rows(url, "SELECT count(*) FROM runs") == [(0,)]


# ── Phase 1 limits ───────────────────────────────────────────────────────────


async def test_escalation_preflight_without_a_dataspace(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        response = await client.get(f"/api/agent/escalate-preflight/{run_id}")
        unknown = await client.get("/api/agent/escalate-preflight/nope")
    assert response.json() == {
        "possible": False,
        "reason": "No dataspace is configured for this installation.",
        "recipient": None,
        "data": [],
        "withheld": [],
        "sharing_tier": "minimal",
    }
    assert unknown.status_code == 404


async def test_reopening_a_run_is_a_conflict(url):
    async with running(make_app(url)) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        await client.post(f"/api/agent/stop/{run_id}")
        response = await client.post(f"/api/agent/reopen/{run_id}")
    assert response.status_code == 409
    assert response.json()["error"]["kind"] == "conflict"
    assert "machine-builder conversation" in response.json()["error"]["message"]


# ── Bounded concurrency ──────────────────────────────────────────────────────


async def test_at_most_the_configured_rounds_run_at_once(url):
    app = make_app(url, max_concurrent_rounds=2)
    context = app.state.context
    async with running(app) as client:
        gated = [await start(client, GATED, f"Run {n}") for n in (1, 2)]
        third = await start(client, MACHINE, "Run 3")
        await eventually(lambda: len(context.started) >= 2)
        await asyncio.sleep(0.2)
        assert context.started == [GATED, GATED]
        waiting = (await client.get(f"/api/agent/status/{third}")).json()
        assert waiting["status"] == "running" and waiting["steps"] == []
        context.gate.set()
        done = [await until(client, run_id) for run_id in [*gated, third]]
    first_pause = min(r["updated_at"] for r in done[:2])
    assert done[2]["steps"][0]["at"] >= first_pause


# ── Error shape ──────────────────────────────────────────────────────────────


async def test_error_shape_per_kind(url, fresh_database):
    async with running(make_app(url)) as client:
        run_id = await start(client, GATED)
        responses = {
            404: await client.get("/api/agent/status/missing"),
            409: await client.post(f"/api/agent/clarify/{run_id}", json={"text": "x"}),
            422: await client.post("/api/agent/run", json={"machine_id": "", "issue": "x"}),
        }
    async with running(make_app(fresh_database(create=False), health_timeout_s=1)) as client:
        responses[503] = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "x"})
    kinds = {404: "not_found", 409: "conflict", 422: "invalid", 503: "unavailable"}
    for status, response in responses.items():
        assert response.status_code == status
        body = response.json()
        assert set(body) == {"error"} and set(body["error"]) == {"kind", "message"}
        assert body["error"]["kind"] == kinds[status]
        assert body["error"]["message"]


class _Health:
    """Reports the language model as down until told otherwise."""

    def __init__(self):
        self.problem = "The language model is not available: Not reachable"

    async def model_problem(self):
        return self.problem


def model_down(app):
    health = _Health()
    app.state.runs._model_problem = health.model_problem
    return health


async def test_start_is_refused_while_the_model_is_down(url):
    app = make_app(url)
    async with running(app) as client:
        model_down(app)
        response = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "noise"})
        assert response.status_code == 503
        assert response.json()["error"]["kind"] == "unavailable"
        assert "language model" in response.json()["error"]["message"]
        assert (await client.get("/api/agent/runs")).json() == []


async def test_clarify_and_rejection_are_refused_while_the_model_is_down(url):
    app = make_app(url)
    async with running(app) as client:
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        health = model_down(app)
        response = await client.post(f"/api/agent/clarify/{run_id}", json={"text": "since 8:00"})
        assert response.status_code == 503
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_input"
        health.problem = None
        assert (await client.post(f"/api/agent/clarify/{run_id}", json={"text": "since 8:00"})).status_code == 200
        await until(client, run_id, "awaiting_confirmation")
        health.problem = "The language model is not available: gone"
        rejected = await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": False, "text": "no"})
        assert rejected.status_code == 503
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_confirmation"
        # Confirming does not call the model.
        assert (
            await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": True})
        ).status_code == 200
        await until(client, run_id, "completed")


async def test_ollama_down_refuses_within_the_health_timeout(url):
    app = make_app(url, llm_provider="ollama", health_timeout_s=1)
    async with running(app) as client:
        started = asyncio.get_running_loop().time()
        response = await client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "noise"})
        assert response.status_code == 503
        assert asyncio.get_running_loop().time() - started < 2
