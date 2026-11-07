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
import asyncio
import json
from typing import Any

import pytest

from app.dataspace.sharing import ADJACENTS, DIRECT, HISTORY, TIERS, apply_policy
from app.memory.migrate import Migrator
from app.runs.stream import Subscriber
from tests.dataspace_support import BUILDER
from tests.runs_support import (
    MACHINE,
    OTHER_MACHINE,
    clarify,
    eventually,
    make_app,
    rows,
    running,
    start,
    to_confirmation,
    until,
)
from tests.space_support import Space, connect, space_app
from xana_agent.sources.base import SourceUnavailable
from xana_agent.testing import FakeContextSource, sample_entities

pytestmark = pytest.mark.db


class Alerts:
    def __init__(self):
        self.down = False

    async def active(self, entity_id: str) -> list[dict[str, Any]]:
        if self.down:
            raise SourceUnavailable("Alerta not reachable.")
        return [{"id": f"alert-of-{entity_id}", "resource": entity_id, "event": "hot", "severity": "major"}]


@pytest.fixture
def url(fresh_database):
    return fresh_database()


async def escalatable(client) -> str:
    await connect(client)
    return await to_confirmation(client)


async def wait_status(space: Space, client, run_id: str):
    return (await client.get(f"/api/agent/outbox-status/{run_id}")).json()


def app_at(url, space, tier="minimal", **extra):
    return space_app(url, space, data_sharing_policy=tier, **extra)


# ── The filter ──────────────────────────────────────────────────────────────


def access(**statuses):
    names = {"direct": DIRECT, "adjacents": ADJACENTS, "history": HISTORY}
    return [{"capability": names[key], "status": value} for key, value in statuses.items()]


ALL_ALLOWED = access(direct="auto", adjacents="approved", history="approved")


@pytest.mark.parametrize(
    ("tier", "allowed"),
    [("minimal", (DIRECT,)), ("adjacent", (DIRECT, ADJACENTS)), ("timeseries", (DIRECT, ADJACENTS, HISTORY))],
)
def test_each_tier_allows_only_its_own(tier, allowed):
    sharing = apply_policy(tier, ALL_ALLOWED)
    assert sharing.allowed == allowed
    assert {item["category"] for item in sharing.withheld} == set(TIERS["timeseries"]) - set(allowed)


@pytest.mark.parametrize("status", ["on-request", "pending", "denied", None])
def test_access_not_allowed_is_withheld_even_in_the_tier(status):
    sharing = apply_policy("timeseries", access(direct="auto", adjacents=status, history="approved"))
    assert sharing.allowed == (DIRECT, HISTORY)
    held = next(i for i in sharing.withheld if i["category"] == ADJACENTS)
    assert str(status) in held["reason"] or "not known" in held["reason"]


def test_a_capability_the_dataspace_does_not_list_is_not_allowed():
    assert apply_policy("timeseries", access(direct="auto")).allowed == (DIRECT,)


# ── What each tier sends ────────────────────────────────────────────────────


async def escalate_at(url, tier, alerts=None):
    space = Space()
    async with running(app_at(url, space, tier, alerts=alerts)) as client:
        run_id = await escalatable(client)
        answer = await client.post(f"/api/agent/escalate/{run_id}")
        assert answer.status_code == 200, answer.text
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
    return space, run


async def test_minimal_sends_only_the_entity(url):
    space, run = await escalate_at(url, "minimal", Alerts())
    bundle, message = space.sent
    assert set(bundle["files"]) == {"machine.json"}
    assert bundle["files"]["machine.json"]["entity"]["id"] == MACHINE
    assert bundle["files"]["machine.json"]["active_alerts"][0]["id"] == f"alert-of-{MACHINE}"
    assert bundle["capability"] == DIRECT
    text = json.dumps(space.sent)
    assert OTHER_MACHINE not in text and "buckets" not in text
    # The entity's own relationships name related entities; their content isn't sent.
    related = [e for e in sample_entities() if e["id"] != MACHINE]
    assert not any(json.dumps(e["id"]) + ', "type"' in text for e in related)
    assert not any(e["id"] in json.dumps(message) for e in related)
    assert [d["category"] for d in run["escalation"]["data"]] == [DIRECT]


async def test_adjacent_adds_related_entities_and_no_history(url):
    space, run = await escalate_at(url, "adjacent", Alerts())
    bundle = space.sent[0]
    assert set(bundle["files"]) == {"machine.json", "related-entities.json"}
    assert bundle["capability"] == ADJACENTS
    related = bundle["files"]["related-entities.json"]
    assert related and all(item["entity"]["id"] != MACHINE for item in related)
    assert "buckets" not in json.dumps(space.sent)
    assert [d["category"] for d in run["escalation"]["data"]] == [DIRECT, ADJACENTS]


async def test_timeseries_adds_history(url):
    space, run = await escalate_at(url, "timeseries")
    bundle = space.sent[0]
    assert set(bundle["files"]) == {"machine.json", "related-entities.json", "signal-history.json"}
    assert bundle["capability"] == HISTORY
    history = bundle["files"]["signal-history.json"]
    assert history and history[0]["buckets"] and {"entity_id", "attribute", "buckets"} == set(history[0])
    assert [d["category"] for d in run["escalation"]["data"]] == [DIRECT, ADJACENTS, HISTORY]


async def test_the_message_holds_only_the_incident(url):
    space, _ = await escalate_at(url, "timeseries")
    message = space.sent[1]
    assert message["performative"] == "request" and message["reply_expected"] is True
    assert message["receiver_participant"] == BUILDER
    assert message["conversation_id"] == space.sent[0]["conversation_id"]
    assert set(message["payload"]) == {
        "escalation_ref",
        "machine_id",
        "issue",
        "diagnosis",
        "confidence",
        "sharing_tier",
        "files",
    }
    assert "attributes" not in json.dumps(message["payload"])


async def test_access_held_back_in_the_tier_is_not_sent_and_shown(url):
    space = Space()
    space.access_here[BUILDER][1]["status"] = "on-request"
    async with running(app_at(url, space, "timeseries")) as client:
        run_id = await escalatable(client)
        pre = (await client.get(f"/api/agent/escalate-preflight/{run_id}")).json()
        assert pre["possible"] is True
        assert [d["category"] for d in pre["data"]] == [DIRECT, HISTORY]
        assert pre["withheld"][0]["category"] == ADJACENTS
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
    assert set(space.sent[0]["files"]) == {"machine.json", "signal-history.json"}
    check = next(s for s in run["steps"] if s["node"] == "policy_check")
    assert any("on-request" in text for text in check["output"]["withheld"])
    assert check["output"]["files"] == ["machine.json", "signal-history.json"]


# ── The outcome ─────────────────────────────────────────────────────────────


async def test_escalating_moves_the_run_and_records_it(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        answer = (await client.post(f"/api/agent/escalate/{run_id}")).json()
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        listed = (await client.get("/api/agent/runs")).json()[0]
    assert answer["status"] == "awaiting_machine_builder" and answer["escalation_ref"].startswith("ESC-")
    assert run["status"] == "awaiting_machine_builder"
    assert run["data"] == {"escalation_ref": answer["escalation_ref"], "builder": "Builder GmbH"}
    assert run["escalation_ref"] == answer["escalation_ref"] == listed["escalation_ref"]
    assert run["escalation"]["recipient"] == {"id": BUILDER, "name": "Builder GmbH"}
    assert run["escalation"]["tier"] == "minimal" and run["escalation"]["sent_at"]
    assert [o["status"] for o in run["outbox"]] == ["pending", "pending"]
    assert [s["node"] for s in run["steps"]][-2:] == ["policy_check", "escalate"]
    # What the run view reads to show the escalation, as the stream's step event carries it.
    output = run["steps"][-1]["output"]
    assert output["escalation_ref"] == answer["escalation_ref"] and output["recipient"] == "Builder GmbH"
    assert output["tier"] == "minimal" and output["sent"]


async def test_escalation_is_possible_from_awaiting_input(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        await connect(client)
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    assert space.sent[1]["payload"]["diagnosis"]["question"]


async def test_escalation_is_refused_in_other_states_and_nothing_goes_out(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        before = len(space.sent)
        again = await client.post(f"/api/agent/escalate/{run_id}")
        assert again.status_code == 409
        pre = (await client.get(f"/api/agent/escalate-preflight/{run_id}")).json()
        assert pre["possible"] is False and "already been escalated" in pre["reason"]
        for route, body in (("clarify", {"text": "x"}), ("confirm-resolution", {"confirmed": True})):
            assert (await client.post(f"/api/agent/{route}/{run_id}", json=body)).status_code == 409
        assert (await client.post(f"/api/agent/archive/{run_id}")).status_code == 409
        assert (await client.post(f"/api/agent/stop/{run_id}", json={})).status_code == 200
    assert len(space.sent) == before


async def test_unknown_run(url):
    async with running(app_at(url, Space())) as client:
        assert (await client.post("/api/agent/escalate/nope")).status_code == 404
        assert (await client.get("/api/agent/outbox-status/nope")).status_code == 404


# ── Preflight's reasons ─────────────────────────────────────────────────────


async def reason_of(client, run_id):
    pre = (await client.get(f"/api/agent/escalate-preflight/{run_id}")).json()
    assert pre["possible"] is False and pre["recipient"] is None and pre["data"] == []
    return pre["reason"]


async def test_preflight_possible_sends_nothing(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        pre = (await client.get(f"/api/agent/escalate-preflight/{run_id}")).json()
    assert pre["possible"] is True and pre["reason"] is None
    assert pre["recipient"] == {"id": BUILDER, "name": "Builder GmbH"}
    assert pre["sharing_tier"] == "minimal" and pre["data"][0]["category"] == DIRECT
    assert space.sent == []


async def test_each_reason_of_the_preflight(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await to_confirmation(client)
        assert "not connected" in await reason_of(client, run_id)
        refused = await client.post(f"/api/agent/escalate/{run_id}")
        assert refused.status_code == 503 and "not connected" in refused.json()["error"]["message"]
        await connect(client)
        space.machines.clear()
        assert "does not know the machine" in await reason_of(client, run_id)
        space.machines[MACHINE] = "urn:ifric:someone-else"
        assert "not a compatible participant" in await reason_of(client, run_id)
        space.machines[MACHINE] = BUILDER
        space.registry_status = 403
        assert "not a party" in await reason_of(client, run_id)
        space.registry_status = None
        space.registry_down = True
        assert "can't be reached" in await reason_of(client, run_id)
        space.registry_down = False
        space.status_for["GET /participants/compatible"] = 503
        assert "compatible participants can't be read" in await reason_of(client, run_id)
        del space.status_for["GET /participants/compatible"]
        space.status_for["GET /capabilities/access"] = 503
        assert "may access can't be read" in await reason_of(client, run_id)
        del space.status_for["GET /capabilities/access"]
        space.access_here[BUILDER][0]["status"] = "denied"
        assert "may not have the machine's own data" in await reason_of(client, run_id)
        refused = await client.post(f"/api/agent/escalate/{run_id}")
        assert refused.status_code == 503
    assert space.sent == []


async def test_reasons_without_a_dataspace_or_a_registry(url, fresh_database):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        assert "No dataspace is configured" in await reason_of(client, run_id)
    space = Space()
    async with running(app_at(fresh_database(), space, ifric_url=None)) as client:
        await connect(client)
        run_id = await to_confirmation(client)
        assert "No IFRIC registry is configured" in await reason_of(client, run_id)


async def test_reason_when_the_session_has_expired(url):
    space = Space()
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        connection = app.state.gateway_connection
        connection._token = type(connection._token)(connection._token.access, 1.0)
        assert "has expired" in await reason_of(client, run_id)


async def test_reason_in_another_state(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        await connect(client)
        run_id = await to_confirmation(client)
        await client.post(f"/api/agent/stop/{run_id}", json={})
        assert "Escalation is possible while" in await reason_of(client, run_id)


# ── Failures while sending ──────────────────────────────────────────────────


async def test_files_failing_leave_the_run_as_it_was_and_it_can_go_on(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        await connect(client)
        run_id = await start(client)
        await until(client, run_id, "awaiting_input")
        space.status_for["POST /outbox/files"] = 503
        refused = await client.post(f"/api/agent/escalate/{run_id}")
        assert refused.status_code == 502 and "gateway" in refused.json()["error"]["message"]
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert run["status"] == "awaiting_input" and run["escalation"] is None
        failure = next(s for s in run["steps"] if s["node"] == "escalate_failed")
        assert failure["output"]["files_sent"] is False
        assert space.sent == [] and space.reached.get("POST /outbox/messages") is None
        # The run goes on as before.
        await clarify(client, run_id)
        await until(client, run_id, "awaiting_confirmation")
        # And escalating works once the gateway does.
        del space.status_for["POST /outbox/files"]
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    assert [m["kind"] for m in space.sent] == ["files", "message"]


async def test_message_failing_is_sent_again_without_the_files(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        space.status_for["POST /outbox/messages"] = 504
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 502
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert run["status"] == "awaiting_confirmation"
        assert next(s for s in run["steps"] if s["node"] == "escalate_failed")["output"]["files_sent"] is True
        del space.status_for["POST /outbox/messages"]
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    assert [m["kind"] for m in space.sent] == ["files", "message"]
    assert space.sent[1]["conversation_id"] == space.sent[0]["conversation_id"]


async def test_conversation_read_failing_does_not_send_the_files_again(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        space.status_for["GET /outbox/messages/m-1"] = 503
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 502
        assert [m["kind"] for m in space.sent] == ["files"]
        del space.status_for["GET /outbox/messages/m-1"]
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    assert [m["kind"] for m in space.sent] == ["files", "message"]


async def test_a_failed_attempt_survives_a_restart(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        space.status_for["POST /outbox/messages"] = 503
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 502
    del space.status_for["POST /outbox/messages"]
    async with running(app_at(url, space)) as client:
        await connect(client)
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    assert [m["kind"] for m in space.sent] == ["files", "message"]


class Unreadable(FakeContextSource):
    async def get(self, entity_id):
        raise SourceUnavailable("The broker is down.")


async def test_data_that_cannot_be_read_sends_nothing(url):
    space = Space()
    async with running(app_at(url, space, context=Unreadable(sample_entities()))) as client:
        await connect(client)
        run_id = await start(client)
        await until(client, run_id)
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        if run["status"] not in ("awaiting_input", "awaiting_confirmation"):
            pytest.skip(f"the round ended as {run['status']}")
        refused = await client.post(f"/api/agent/escalate/{run_id}")
        assert refused.status_code == 503 and "The broker is down" in refused.json()["error"]["message"]
        assert space.sent == []


async def test_alerts_that_cannot_be_read_send_nothing(url):
    space = Space()
    alerts = Alerts()
    async with running(app_at(url, space, alerts=alerts)) as client:
        run_id = await escalatable(client)
        alerts.down = True
        refused = await client.post(f"/api/agent/escalate/{run_id}")
        assert refused.status_code == 503 and "Alerta" in refused.json()["error"]["message"]
    assert space.sent == []


# ── At the same time ────────────────────────────────────────────────────────


async def test_two_escalations_at_once_send_once(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        answers = await asyncio.gather(*(client.post(f"/api/agent/escalate/{run_id}") for _ in range(5)))
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409, 409]
    assert [m["kind"] for m in space.sent] == ["files", "message"]


async def test_other_actions_during_a_send_are_refused_and_the_stream_works(url):
    space = Space()
    gate = asyncio.Event()
    space.holds["POST /outbox/files"] = gate
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        sending = asyncio.create_task(client.post(f"/api/agent/escalate/{run_id}"))
        await eventually(lambda: space.reached.get("POST /outbox/files") == 1)
        for route, body in (
            ("stop", {}),
            ("confirm-resolution", {"confirmed": True}),
            ("escalate", None),
        ):
            answer = await client.post(f"/api/agent/{route}/{run_id}", json=body)
            assert answer.status_code == 409 and "being sent" in answer.json()["error"]["message"]
        # Reading and watching don't wait for the send.
        run = await asyncio.wait_for(client.get(f"/api/agent/status/{run_id}"), 2)
        assert run.json()["status"] == "awaiting_confirmation"
        snapshot, sub = await asyncio.wait_for(app.state.runs.subscribe(run_id), 2)
        assert isinstance(sub, Subscriber) and snapshot["status"] == "awaiting_confirmation"
        assert any(s["node"] == "policy_check" for s in snapshot["steps"])
        gate.set()
        assert (await sending).status_code == 200
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_machine_builder"
        # The mark is gone: the run can be stopped now.
        assert (await client.post(f"/api/agent/stop/{run_id}", json={})).status_code == 200


async def test_the_mark_is_gone_after_a_failure(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        space.status_for["POST /outbox/files"] = 503
        await client.post(f"/api/agent/escalate/{run_id}")
        response = await client.post(f"/api/agent/confirm-resolution/{run_id}", json={"confirmed": True})
        assert response.status_code == 200


async def test_escalations_of_different_runs_go_on_at_once(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        await connect(client)
        space.machines["urn:ngsi-ld:Machine:press-02"] = BUILDER
        one = await to_confirmation(client)
        two = await to_confirmation(client, machine_id=OTHER_MACHINE)
        answers = await asyncio.gather(*(client.post(f"/api/agent/escalate/{r}") for r in (one, two)))
    assert [a.status_code for a in answers] == [200, 200]
    assert len(space.sent) == 4
    conversations = {m["conversation_id"] for m in space.sent}
    assert len(conversations) == 2


# ── Delivery ────────────────────────────────────────────────────────────────


async def test_delivery_states(url):
    space = Space()
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        manager = app.state.runs
        await manager.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["pending", "pending"]
        space.message_status["m-1"] = "registered"
        await manager.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["pending", "pending"]
        space.message_status["m-1"] = "notified"
        space.message_status["m-2"] = "error"
        space.fail_status["m-2"] = "The receiver is away"
        await manager.check_outbox()
        statuses = await wait_status(space, client, run_id)
        assert [o["status"] for o in statuses] == ["delivered", "failed"]
        assert statuses[1]["error"] == "The receiver is away"
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_machine_builder"
        # Final: not asked about again.
        asked = space.reached.get("GET /outbox/messages/m-1/status")
        await manager.check_outbox()
        assert space.reached.get("GET /outbox/messages/m-1/status") == asked


async def test_rejected_is_failed(url):
    space = Space()
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        space.message_status["m-2"] = "rejected"
        await app.state.runs.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["pending", "failed"]


async def test_outage_of_the_status_route_keeps_it_pending(url):
    space = Space()
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        space.gateway_down = True
        await app.state.runs.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["pending", "pending"]
        space.gateway_down = False
        space.message_status["m-1"] = space.message_status["m-2"] = "notified"
        await app.state.runs.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["delivered", "delivered"]


async def test_one_message_failing_to_answer_does_not_hold_up_another(url):
    space = Space()
    app = app_at(url, space)
    async with running(app) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        space.status_for["GET /outbox/messages/m-1/status"] = 503
        space.message_status["m-2"] = "notified"
        await app.state.runs.check_outbox()
        assert [o["status"] for o in await wait_status(space, client, run_id)] == ["pending", "delivered"]


async def test_the_background_task_really_polls(url):
    space = Space()
    app = app_at(url, space)
    app.state.runs._outbox_poll_s = 0.01
    async with running(app) as client:
        run_id = await escalatable(client)
        await client.post(f"/api/agent/escalate/{run_id}")
        space.message_status["m-1"] = space.message_status["m-2"] = "notified"
        for _ in range(300):
            statuses = await wait_status(space, client, run_id)
            if {o["status"] for o in statuses} == {"delivered"}:
                break
            await asyncio.sleep(0.01)
        assert {o["status"] for o in statuses} == {"delivered"}


# ── A restart, and the record ───────────────────────────────────────────────


async def test_a_restart_keeps_the_state_and_goes_on_polling(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        answer = (await client.post(f"/api/agent/escalate/{run_id}")).json()
        before = (await client.get(f"/api/agent/status/{run_id}")).json()
    sent = len(space.sent)
    app = app_at(url, space)
    async with running(app) as client:
        await connect(client)
        after = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert after == before and after["escalation_ref"] == answer["escalation_ref"]
        assert len(app.state.runs._tasks) == 0  # no round started
        space.message_status["m-1"] = "notified"
        await app.state.runs.check_outbox()
        assert (await wait_status(space, client, run_id))[0]["status"] == "delivered"
    assert len(space.sent) == sent


async def test_the_incident_records_the_escalation(url):
    space = Space()
    async with running(app_at(url, space)) as client:
        run_id = await escalatable(client)
        ref = (await client.post(f"/api/agent/escalate/{run_id}")).json()["escalation_ref"]
        await client.post(f"/api/agent/stop/{run_id}", json={"reason": "Enough"})
        await client.post(f"/api/agent/archive/{run_id}")
        summary = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{summary['id']}")).json()
    assert summary["escalated"] is True and summary["escalation_ref"] == ref and summary["outcome"] == "stopped"
    assert detail["builder"] == "Builder GmbH" and detail["escalation"]["ref"] == ref
    assert detail["conversation_id"] == space.sent[0]["conversation_id"]
    stored = rows(url, "SELECT builder, conversation_id FROM incidents")
    assert stored == [("Builder GmbH", space.sent[0]["conversation_id"])]


async def test_a_run_not_escalated_records_nothing(url):
    async with running(make_app(url)) as client:
        run_id = await to_confirmation(client)
        await client.post(f"/api/agent/stop/{run_id}", json={})
        await client.post(f"/api/agent/archive/{run_id}")
        summary = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{summary['id']}")).json()
    assert summary["escalated"] is False and summary["escalation_ref"] is None
    assert detail["builder"] is None and detail["escalation"] is None


async def test_migration_adds_the_columns_to_stored_runs(url, tmp_path):
    # A database as it was before this change, with a stored run in it.
    import shutil

    from app.memory.migrate import MIGRATIONS_DIR

    for name in sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql")):
        if name < "005":
            shutil.copy(MIGRATIONS_DIR / name, tmp_path / name)
    await Migrator(url, tmp_path).apply()
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO runs (run_id, machine_id, issue, status, started_at, updated_at) "
            "VALUES ('old', 'm', 'i', 'stopped', now(), now())"
        )
    async with running(make_app(url)) as client:
        run = (await client.get("/api/agent/status/old")).json()
    assert run["escalation"] is None and run["outbox"] == []
