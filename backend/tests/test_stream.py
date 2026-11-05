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
"""The run stream at /ws/run/{run_id}."""

import asyncio
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.runs.stream import Close
from tests.runs_support import GATED, MACHINE, Script, eventually, make_app, running, start, until

pytestmark = pytest.mark.db


@pytest.fixture
def url(fresh_database):
    return fresh_database()


def wait_for(client, run_id, status, within=10):
    deadline = time.monotonic() + within
    while (run := client.get(f"/api/agent/status/{run_id}").json())["status"] != status:
        assert time.monotonic() < deadline, run
        time.sleep(0.02)
    return run


def receive(ws, *types):
    """The next message whose type is one of `types` (keep-alive messages are skipped otherwise)."""
    while True:
        message = ws.receive_json()
        if message["type"] in types or (not types and message["type"] != "keepalive"):
            return message


def start_sync(client, machine_id=MACHINE, issue="Spindle vibration"):
    response = client.post("/api/agent/run", json={"machine_id": machine_id, "issue": issue})
    assert response.status_code == 202
    return response.json()["run_id"]


def test_join_a_run_in_progress(url):
    script = Script()
    script.gates["ValidationPlan"] = gate = threading.Event()
    app = make_app(url, script=script)
    with TestClient(app) as client:
        run_id = start_sync(client)
        deadline = time.monotonic() + 5
        while "ValidationPlan" not in script.waiting:
            assert time.monotonic() < deadline
            time.sleep(0.01)
        with client.websocket_connect(f"/ws/run/{run_id}") as ws:
            snapshot = receive(ws)
            assert snapshot["type"] == "snapshot"
            assert [s["node"] for s in snapshot["run"]["steps"]] == ["observe", "hypothesize"]
            assert snapshot["run"]["status"] == "running"
            gate.set()
            events = [receive(ws) for _ in range(3)]
    assert [(e["type"], e.get("node")) for e in events] == [("step", "validate"), ("step", "decide"), ("status", None)]
    status = events[2]
    assert status["status"] == "awaiting_input"
    assert set(status["data"]) == {"question", "confidence", "threshold"}
    assert status["summary"]["status"] == "awaiting_input"
    assert isinstance(status["summary"]["incident_id"], int)
    assert set(events[0]) == {"type", "node", "input", "output", "at", "round"}


def test_two_clients_receive_the_same_events(url):
    app = make_app(url)
    with TestClient(app) as client:
        run_id = start_sync(client, GATED)
        with (
            client.websocket_connect(f"/ws/run/{run_id}") as first,
            client.websocket_connect(f"/ws/run/{run_id}") as second,
        ):
            assert receive(first)["type"] == receive(second)["type"] == "snapshot"
            app.state.context.gate.set()
            a = [receive(first) for _ in range(5)]
            b = [receive(second) for _ in range(5)]
    assert a == b
    assert [e.get("node", e.get("status")) for e in a] == [
        "observe",
        "hypothesize",
        "validate",
        "decide",
        "awaiting_input",
    ]


def test_operator_steps_and_status_changes_are_streamed(url):
    app = make_app(url)
    with TestClient(app) as client:
        run_id = start_sync(client)
        wait_for(client, run_id, "awaiting_input")
        with client.websocket_connect(f"/ws/run/{run_id}") as ws:
            assert receive(ws)["run"]["status"] == "awaiting_input"
            client.post(f"/api/agent/clarify/{run_id}", json={"text": "Filter changed"})
            clarification, status = receive(ws), receive(ws)
    assert clarification["type"] == "step" and clarification["node"] == "clarification"
    assert status == {"type": "status", "status": "running", "data": {}, "summary": status["summary"]}


def test_unknown_run(url):
    with TestClient(make_app(url)) as client, client.websocket_connect("/ws/run/no-such-run") as ws:
        message = ws.receive_json()
        assert message == {
            "type": "error",
            "error": {"kind": "not_found", "message": "Run no-such-run does not exist or was archived."},
        }
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4404


def test_archived_run_closes_its_stream(url):
    app = make_app(url)
    with TestClient(app) as client:
        run_id = start_sync(client, MACHINE, "FAIL-THIS-ROUND")
        wait_for(client, run_id, "failed")
        with client.websocket_connect(f"/ws/run/{run_id}") as ws:
            receive(ws)
            assert client.post(f"/api/agent/archive/{run_id}").status_code == 204
            assert receive(ws)["error"]["kind"] == "not_found"
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
    assert closed.value.code == 4404


def test_keepalive_while_the_run_is_quiet(url):
    app = make_app(url)
    app.state.stream_keepalive_s = 0.05
    with TestClient(app) as client:
        run_id = start_sync(client)
        wait_for(client, run_id, "awaiting_input")
        with client.websocket_connect(f"/ws/run/{run_id}") as ws:
            assert ws.receive_json()["type"] == "snapshot"
            assert [ws.receive_json()["type"] for _ in range(3)] == ["keepalive"] * 3


def test_keepalive_interval_is_within_30_seconds():
    from app.api.stream import KEEPALIVE_S

    assert KEEPALIVE_S <= 30


async def test_slow_client_is_closed_without_delaying_the_run(url):
    app = make_app(url)
    async with running(app) as client:
        manager = app.state.runs
        manager.queue_limit = 3
        run_id = await start(client, GATED)
        await eventually(lambda: GATED in app.state.context.started)
        _, slow = await manager.subscribe(run_id)
        _, fast = await manager.subscribe(run_id)
        received = []

        async def read():
            while (event := await fast.get())["type"] != "status":
                received.append(event)
            received.append(event)

        reader = asyncio.create_task(read())
        app.state.context.gate.set()
        run = await until(client, run_id, "awaiting_input")
        await asyncio.wait_for(reader, 5)
        assert [e.get("node", e.get("status")) for e in received] == [
            "observe",
            "hypothesize",
            "validate",
            "decide",
            "awaiting_input",
        ]
        assert slow.closed
        assert slow.backlog() == 1
        assert await slow.get() == Close(1013)
        snapshot, again = await manager.subscribe(run_id)
        assert snapshot == run
        assert not again.closed
