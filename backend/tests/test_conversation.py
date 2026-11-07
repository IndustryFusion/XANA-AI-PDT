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
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from tests.dataspace_support import BUILDER
from tests.runs_support import MACHINE, Script, eventually, rows, running, to_confirmation
from tests.space_support import Space, connect, space_app
from xana_agent.conversation import AgentAction
from xana_agent.steps import StepFailed

pytestmark = pytest.mark.db


@pytest.fixture
def url(fresh_database):
    return fresh_database()


class Scene:
    """A connected backend with an escalated run. `space` is the dataspace; `app` the application."""

    def __init__(self, app, space, client, run_id, conversation):
        self.app, self.space, self.client, self.run_id, self.conversation = app, space, client, run_id, conversation

    async def poll(self) -> int:
        return await self.app.state.inbox.poll_once()

    async def run(self) -> dict[str, Any]:
        return (await self.client.get(f"/api/agent/status/{self.run_id}")).json()

    async def act(self, act: str, **body: Any):
        return await self.client.post(f"/api/agent/conversation-act/{self.run_id}", json={"act": act, **body})

    def messages(self, run: dict[str, Any]) -> list[dict[str, Any]]:
        return [s["output"] for s in run["steps"] if s["node"] == "message"]

    def sent_acts(self) -> list[str]:
        return [m.get("performative") or m["kind"] for m in self.space.sent[2:]]


async def scene(client, app, space) -> Scene:
    await connect(client)
    run_id = await to_confirmation(client, MACHINE)
    answer = await client.post(f"/api/agent/escalate/{run_id}")
    assert answer.status_code == 200, answer.text
    return Scene(app, space, client, run_id, space.sent[0]["conversation_id"])


def make(url, space=None, **settings):
    space = space or Space()
    return space_app(url, space, data_sharing_policy=settings.pop("tier", "minimal"), **settings), space


# ── Each performative received ──────────────────────────────────────────────


async def test_request_naming_a_capability_waits_for_the_operator_and_sends_nothing(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("request", s.conversation, capability="twin:history", payload={"text": "Need history"})
        assert await s.poll() == 1
        run = await s.run()
    assert run["status"] == "awaiting_operator_approval"
    assert run["data"]["request_id"] == mid and run["data"]["text"] == "Need history"
    assert run["data"]["needs_approval"][0]["category"] == "twin:history" and run["data"]["within_tier"] == []
    assert s.sent_acts() == [] and space.acks == [mid]


async def test_request_within_the_tier_waits_too(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("request", s.conversation, capability="twin:direct")
        await s.poll()
        run = await s.run()
    assert run["status"] == "awaiting_operator_approval"
    assert run["data"]["within_tier"][0]["category"] == "twin:direct" and run["data"]["needs_approval"] == []
    assert s.sent_acts() == []


async def test_free_text_request_keeps_waiting_and_can_only_be_answered_with_inform(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("request", s.conversation, payload={"text": "What firmware?"})
        await s.poll()
        run = await s.run()
        assert run["status"] == "awaiting_machine_builder"
        message = s.messages(run)[-1]
        assert message["free_text"] is True and message["text"] == "What firmware?"
        assert (await s.act("grant")).status_code == 422
        assert (await s.act("inform", text="1.2.3")).status_code == 200
    assert space.sent[-1]["in_reply_to"] == mid


@pytest.mark.parametrize(
    ("payload", "summary", "actions"),
    [
        ({"recommendation": "Replace the filter"}, "Replace the filter", ["Replace the filter"]),
        ({"recommendation": {"summary": "Worn", "actions": ["A", "B"]}}, "Worn", ["A", "B"]),
        ({"recommendation": {"summary": "Worn"}}, "Worn", ["Worn"]),
    ],
)
async def test_inform_with_a_recommendation(url, payload, summary, actions):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("inform", s.conversation, payload=payload)
        await s.poll()
        run = await s.run()
    assert run["status"] == "awaiting_recommendation_review"
    assert run["data"]["summary"] == summary and run["data"]["actions"] == actions


async def test_plain_inform_keeps_waiting(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("inform", s.conversation, payload={"text": "Looking into it"})
        await s.poll()
        run = await s.run()
    assert run["status"] == "awaiting_machine_builder" and s.messages(run)[-1]["text"] == "Looking into it"
    assert s.messages(run)[-1]["sender"] == "machine_builder" and s.messages(run)[-1]["act"] == "inform"


@pytest.mark.parametrize("act", ["grant", "deny"])
async def test_grant_and_deny_received(url, act):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await s.act("request", text="May we have your manual?")
        space.deliver(act, s.conversation, capability="mb:confidential", in_reply_to="m-3")
        await s.poll()
        run = await s.run()
    last = s.messages(run)[-1]
    assert (
        last["act"] == act and last["capability"] == "mb:confidential" and run["status"] == "awaiting_machine_builder"
    )


async def test_cancel_withdraws_the_request_it_names(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        assert (await s.run())["status"] == "awaiting_operator_approval"
        space.deliver("cancel", s.conversation, in_reply_to=mid)
        await s.poll()
        assert (await s.run())["status"] == "awaiting_machine_builder"


@pytest.mark.parametrize(("outcome", "reopenable"), [("resolved", True), ("escalated", False), ("superseded", False)])
async def test_close_received(url, outcome, reopenable):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("close", s.conversation, outcome=outcome, payload={"reason": "Done here"})
        await s.poll()
        run = await s.run()
    assert run["status"] == "mb_closed" and run["reopenable"] is reopenable
    assert run["data"] == {
        "outcome": outcome,
        "reason": "Done here",
        "reopenable": reopenable,
        "recorded_by": "machine_builder",
    }
    assert s.messages(run)[-1]["conv_state"] == "closed"


async def test_escalate_and_deescalate_received(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("escalate", s.conversation)
        await s.poll()
        assert s.messages(await s.run())[-1]["conv_state"] == "direct_contact_machine_builder"
        space.deliver("deescalate", s.conversation)
        await s.poll()
        assert s.messages(await s.run())[-1]["conv_state"] == "open"


async def test_reopen_received_on_a_closed_run(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("close", s.conversation, outcome="resolved")
        await s.poll()
        space.deliver("reopen", s.conversation)
        await s.poll()
        run = await s.run()
    assert run["status"] == "awaiting_machine_builder" and s.messages(run)[-1]["conv_state"] == "open"


# ── Safe receiving ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("route", ["GET /conversations/{c}", "GET /inbox/messages/{m}/download"])
async def test_a_failure_before_storing_keeps_the_message_for_the_next_poll(url, route):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, payload={"text": "x"}, has_files=True)
        space.downloads[mid] = b"zip"
        key = route.format(c=s.conversation, m=mid)
        space.status_for[key] = 503
        assert await s.poll() == 0
        assert space.acks == [] and len(s.messages(await s.run())) == 0
        del space.status_for[key]
        assert await s.poll() == 1
        assert space.acks == [mid] and len(s.messages(await s.run())) == 1


async def test_the_database_failing_keeps_the_message(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, payload={"text": "x"})
        store = app.state.runs._store
        original = store.save

        async def broken(*args, **kwargs):
            from app.memory.store import StoreUnavailable

            raise StoreUnavailable("gone")

        store.save = broken
        assert await s.poll() == 0
        assert space.acks == []
        store.save = original
        assert await s.poll() == 1
        assert space.acks == [mid]


async def test_an_ack_failing_does_not_handle_it_twice(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, payload={"text": "only once"})
        space.status_for[f"POST /inbox/messages/{mid}/ack"] = 503
        await s.poll()
        await s.poll()
        del space.status_for[f"POST /inbox/messages/{mid}/ack"]
        await s.poll()
        run = await s.run()
    assert [m["text"] for m in s.messages(run)] == ["only once"] and space.acks == [mid]


async def test_stored_and_stopped_before_the_ack_appears_once_after_a_restart(url):
    space = Space()
    app, _ = make(url, space)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, payload={"text": "once"})
        space.status_for[f"POST /inbox/messages/{mid}/ack"] = 503
        await s.poll()
    del space.status_for[f"POST /inbox/messages/{mid}/ack"]
    app2, _ = make(url, space)
    async with running(app2) as client:
        await connect(client)
        await app2.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{s.run_id}")).json()
    assert [st["output"]["text"] for st in run["steps"] if st["node"] == "message"] == ["once"]
    assert space.acks == [mid]
    assert rows(url, "SELECT count(*) FROM processed_inbox")[0][0] == 1


async def test_a_message_stored_before_archiving_is_not_added_again(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, payload={"text": "only once"})
        space.status_for[f"POST /inbox/messages/{mid}/ack"] = 503
        await s.poll()
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        await client.post(f"/api/agent/archive/{s.run_id}")
        del space.status_for[f"POST /inbox/messages/{mid}/ack"]
        await s.poll()
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert [m["text"] for m in detail["conversation"]].count("only once") == 1 and space.acks == [mid]


async def test_polls_at_once_handle_a_message_once(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        for n in range(5):
            space.deliver("inform", s.conversation, payload={"text": f"t{n}"})
        await asyncio.gather(*(s.poll() for _ in range(4)))
        run = await s.run()
    assert sorted(m["text"] for m in s.messages(run)) == [f"t{n}" for n in range(5)]
    assert len(space.acks) == 5


async def test_messages_arrive_oldest_first_whatever_the_list_order(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        for n in range(3):
            space.deliver("inform", s.conversation, payload={"text": f"t{n}"})
        space.inbox.reverse()
        await s.poll()
        run = await s.run()
    assert [m["text"] for m in s.messages(run)] == ["t0", "t1", "t2"]


async def test_an_unknown_conversation_stays_and_others_go_on(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        stray = space.deliver("request", "c-nobody", payload={"text": "hello"})
        ok = space.deliver("inform", s.conversation, payload={"text": "x"})
        assert await s.poll() == 1
        assert await s.poll() == 0
    assert space.acks == [ok] and stray not in space.acks


async def test_a_late_message_joins_the_archived_incident(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        await client.post(f"/api/agent/archive/{s.run_id}")
        mid = space.deliver("inform", s.conversation, payload={"text": "Too late?"})
        assert await s.poll() == 1
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert space.acks == [mid]
    assert detail["conversation"][-1]["text"] == "Too late?"


async def test_received_files_are_stored_and_can_be_fetched(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("inform", s.conversation, has_files=True, payload={"_bundle": True})
        space.downloads[mid] = b"the zip"
        await s.poll()
        message = s.messages(await s.run())[-1]
        assert message["files_url"].endswith(mid)
        del space.downloads[mid]  # retention took it: what is stored stays
        answer = await client.get(message["files_url"])
        assert answer.status_code == 200 and answer.content == b"the zip"
        assert (await client.get(f"/api/agent/message-files/{s.run_id}/nope")).status_code == 404


async def test_files_gone_for_good_do_not_hold_the_message_forever(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("inform", s.conversation, has_files=True, payload={"_bundle": True})
        for _ in range(4):
            assert await s.poll() == 0
        assert await s.poll() == 1
        assert s.messages(await s.run())[-1]["files_unavailable"] is True


# ── Sending ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("act", "state"), [("inform", "open"), ("request", "open"), ("escalate", "direct_contact_operator")]
)
async def test_acts_are_sent_shown_and_delivered(url, act, state):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act(act, text="Hello")
        assert answer.status_code == 200 and answer.json()["conv_state"] == state
        run = await s.run()
        last = s.messages(run)[-1]
        assert last["act"] == act and last["sender"] == "operator" and last["conv_state"] == state
        assert run["outbox"][-1] == {"message_id": last["message_id"], "status": "pending", "kind": "message"}
        space.message_status[last["message_id"]] = "notified"
        await app.state.runs.check_outbox()
        assert (await s.run())["outbox"][-1]["status"] == "delivered"
    assert space.sent[-1]["performative"] == act and space.sent[-1]["conversation_id"] == s.conversation


async def test_a_refused_act_stores_nothing_and_says_why(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len((await s.run())["steps"])
        space.status_for["POST /outbox/messages"] = 409
        refused = await s.act("inform", text="x")
        assert refused.status_code == 409
        space.status_for["POST /outbox/messages"] = 422
        assert (await s.act("inform", text="x")).status_code == 422
        space.status_for["POST /outbox/messages"] = 503
        assert (await s.act("inform", text="x")).status_code == 502
        run = await s.run()
    assert len(run["steps"]) == before and run["status"] == "awaiting_machine_builder"


async def test_invalid_acts_are_refused_before_sending(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        assert (await s.act("nonsense")).status_code == 422
        assert (await s.act("inform", text="  ")).status_code == 422
        assert (await s.act("close", outcome="maybe")).status_code == 422
    assert len(space.sent) == before


@pytest.mark.parametrize(
    ("given", "sent", "reopenable"),
    [("resolved", "resolved", True), ("not_resolved", "failed", True)],
)
async def test_close_with_an_outcome_stops_the_run(url, given, sent, reopenable):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome=given)
        run = await s.run()
    assert answer.json() == {"status": "stopped", "conv_state": "closed"}
    assert space.sent[-1]["outcome"] == sent and run["status"] == "stopped" and run["reopenable"] is reopenable


async def test_the_uis_cancel_withdraws(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await s.act("cancel")
    assert space.sent[-1]["performative"] == "close" and space.sent[-1]["outcome"] == "withdrawn"


async def test_two_sends_at_once_one_is_refused(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        answers = await asyncio.gather(*(s.act("inform", text=f"t{n}") for n in range(4)))
        assert sorted(a.status_code for a in answers) == [200, 409, 409, 409]
    assert len(space.sent) == before + 1


async def test_a_message_arriving_during_a_send_loses_neither(url):
    app, space = make(url)
    gate = asyncio.Event()
    space.holds["POST /outbox/messages"] = gate
    async with running(app) as client:
        await connect(client)
        run_id = await to_confirmation(client, MACHINE)
        del space.holds["POST /outbox/messages"]
        answer = await client.post(f"/api/agent/escalate/{run_id}")
        assert answer.status_code == 200
        s = Scene(app, space, client, run_id, space.sent[0]["conversation_id"])
        space.holds["POST /outbox/messages"] = gate
        sending = asyncio.create_task(s.act("inform", text="ours"))
        await eventually(lambda: space.reached.get("POST /outbox/messages", 0) >= 2)
        space.deliver("request", s.conversation, capability="twin:history", payload={"text": "theirs"})
        await s.poll()
        gate.set()
        assert (await sending).status_code == 200
        run = await s.run()
    assert {m["text"] for m in s.messages(run)} >= {"ours", "theirs"}
    assert run["status"] == "awaiting_operator_approval"


# ── Grant and deny ──────────────────────────────────────────────────────────


async def requested(s, capability="twin:adjacents"):
    mid = s.space.deliver("request", s.conversation, capability=capability, payload={"text": "More please"})
    await s.poll()
    return mid


async def decide(s, approved, note=""):
    return await s.client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": approved, "note": note})


async def test_grant_sends_the_grant_and_only_that_data(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = await requested(s)
        answer = await decide(s, True, "For this case")
        run = await s.run()
    assert answer.json() == {"status": "awaiting_machine_builder"}
    grant, bundle = space.sent[2], space.sent[3]
    assert grant["performative"] == "grant" and grant["capability"] == "twin:adjacents" and grant["in_reply_to"] == mid
    assert grant["authorization"]["scope"] == "conversation" and grant["authorization"]["expires_at"]
    assert bundle["in_reply_to"] == mid and set(bundle["files"]) == {"related-entities.json"}
    assert space.policies == [{"consumer_id": BUILDER, "capability": "twin:adjacents", "action": "approve"}]
    check = [st for st in run["steps"] if st["node"] == "policy_check"][-1]["output"]
    assert check["request_id"] == mid and check["files"] == ["related-entities.json"]


async def test_grant_failing_after_the_message_sends_only_the_files_again(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await requested(s)
        space.status_for["POST /outbox/files"] = 503
        assert (await decide(s, True)).status_code == 502
        run = await s.run()
        assert run["status"] == "awaiting_operator_approval"
        assert any(st["node"] == "grant_failed" for st in run["steps"])
        del space.status_for["POST /outbox/files"]
        assert (await decide(s, True)).status_code == 200
    assert [m.get("performative") or m["kind"] for m in space.sent[2:]] == ["grant", "files"]


async def test_policy_failing_sends_no_grant(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await requested(s)
        space.status_for["POST /capabilities/policy"] = 503
        assert (await decide(s, True)).status_code == 502
    assert s.sent_acts() == []


async def test_deny_sends_no_data(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = await requested(s)
        assert (await decide(s, False, "Not now")).json() == {"status": "awaiting_machine_builder"}
    assert s.sent_acts() == ["deny"] and space.sent[-1]["in_reply_to"] == mid and space.policies == []
    assert space.sent[-1]["capability"] == "twin:adjacents"


async def test_two_requests_are_decided_in_turn(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        first = await requested(s, "twin:adjacents")
        second = await requested(s, "twin:history")
        assert (await s.run())["data"]["request_id"] == first
        await decide(s, False)
        run = await s.run()
        assert run["status"] == "awaiting_operator_approval" and run["data"]["request_id"] == second


async def test_deciding_without_a_request_is_a_conflict(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        assert (await decide(s, True)).status_code == 409


# ── Recommendations ─────────────────────────────────────────────────────────


async def recommended(s):
    s.space.deliver("inform", s.conversation, payload={"recommendation": {"summary": "Worn", "actions": ["Replace"]}})
    await s.poll()


async def reply(s, action, message=""):
    return await s.client.post(
        f"/api/agent/recommendation-reply/{s.run_id}", json={"action": action, "message": message}
    )


async def test_resolved_closes_and_completes(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await recommended(s)
        assert (await reply(s, "resolved")).json() == {"status": "completed"}
        run = await s.run()
    assert space.sent[-1]["performative"] == "close" and space.sent[-1]["outcome"] == "resolved"
    assert run["status"] == "completed" and run["data"]["recommended_action"] == "Replace"
    assert run["data"]["resolved_by"] == "Builder GmbH"


@pytest.mark.parametrize(("action", "act"), [("still_failing", "inform"), ("escalate", "escalate")])
async def test_other_answers_send_and_wait(url, action, act):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await recommended(s)
        assert (await reply(s, action)).json() == {"status": "awaiting_machine_builder"}
    assert space.sent[-1]["performative"] == act


async def test_an_unknown_answer_and_no_recommendation(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        assert (await reply(s, "resolved")).status_code == 409
        await recommended(s)
        assert (await reply(s, "shrug")).status_code == 422
    assert s.sent_acts() == []


# ── Status and closing ──────────────────────────────────────────────────────


async def test_checking_finds_it_closed(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.conversations[s.conversation] = {"state": "CLOSED_RESOLVED", "outcome": "resolved"}
        answer = await client.post(f"/api/agent/refresh-conversation/{s.run_id}")
        run = await s.run()
    assert answer.json() == {"status": "mb_closed"} and run["data"]["outcome"] == "resolved"


async def test_recording_a_close_sends_nothing(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        body = {"outcome": "resolved", "reason": "They called"}
        assert (await client.post(f"/api/agent/record-close/{s.run_id}", json=body)).json() == {"status": "mb_closed"}
        run = await s.run()
        refused = await client.post(f"/api/agent/record-close/{s.run_id}", json=body)
    assert len(space.sent) == before and run["data"]["recorded_by"] == "operator"
    assert s.messages(run)[-1]["recorded_by_operator"] is True and refused.status_code == 409


async def test_a_send_accepted_and_not_stored_is_added_after_a_restart(url):
    space = Space()
    app, _ = make(url, space)
    async with running(app) as client:
        s = await scene(client, app, space)
        # Sent, as far as the gateway knows, without this backend having stored it.
        space.sent.append(
            {
                "message_id": "m-lost",
                "conversation_id": s.conversation,
                "performative": "inform",
                "payload": {"text": "Lost on the way"},
                "kind": "message",
            }
        )
        space.message_status["m-lost"] = "notified"
    app2, _ = make(url, space)
    async with running(app2) as client:
        await connect(client)
        await app2.state.inbox.poll_once()
        await app2.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{s.run_id}")).json()
    found = [st["output"] for st in run["steps"] if st["node"] == "message"]
    assert [m["text"] for m in found] == ["Lost on the way"]
    assert run["outbox"][-1]["message_id"] == "m-lost"


async def test_a_restart_in_mid_conversation_loses_nothing(url):
    space = Space()
    app, _ = make(url, space)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = space.deliver("request", s.conversation, capability="twin:history", payload={"text": "History?"})
        await s.poll()
        before = await s.run()
        later = space.deliver("inform", s.conversation, payload={"text": "While you were away"})
    app2, _ = make(url, space)
    async with running(app2) as client:
        await connect(client)
        await app2.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{s.run_id}")).json()
    assert run["status"] == before["status"] == "awaiting_operator_approval" and run["data"]["request_id"] == mid
    texts = [
        st["output"]["text"] for st in run["steps"] if st["node"] == "message" and st["output"]["sender"] != "agent"
    ]
    assert texts == ["History?", "While you were away"]
    assert later in space.acks


# ── Stop and reopen ─────────────────────────────────────────────────────────


async def test_stop_sends_close_withdrawn_and_can_be_reopened(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        assert (await client.post(f"/api/agent/stop/{s.run_id}", json={"reason": "Fixed it"})).json() == {
            "status": "stopped"
        }
        run = await s.run()
        assert space.sent[-1]["performative"] == "close" and space.sent[-1]["outcome"] == "withdrawn"
        assert run["reopenable"] is True and run["data"]["outcome"] == "withdrawn"
        assert (await client.post(f"/api/agent/reopen/{s.run_id}")).json() == {"status": "awaiting_machine_builder"}
    assert space.sent[-1]["performative"] == "reopen"


async def test_stop_with_the_gateway_failing_stops_and_closes_later(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        space.status_for["POST /outbox/messages"] = 503
        assert (await client.post(f"/api/agent/stop/{s.run_id}", json={})).json() == {"status": "stopped"}
        run = await s.run()
        assert run["status"] == "stopped" and run["data"]["close_pending"] is True and run["data"]["close_problem"]
        assert len(space.sent) == before
        await s.poll()
        assert len(space.sent) == before
        del space.status_for["POST /outbox/messages"]
        await s.poll()
        assert len(space.sent) == before, "a failed repeat waits before the next"
        now = app.state.runs._now
        app.state.runs._now = lambda: now() + timedelta(seconds=61)
        await s.poll()
        run = await s.run()
        assert space.sent[-1]["outcome"] == "withdrawn" and "close_pending" not in run["data"]
        await s.poll()
    assert len(space.sent) == before + 1


async def test_stop_of_a_run_without_a_conversation_sends_nothing(url):
    app, space = make(url)
    async with running(app) as client:
        await connect(client)
        run_id = await to_confirmation(client, MACHINE)
        assert (await client.post(f"/api/agent/stop/{run_id}", json={})).status_code == 200
        assert (await client.post(f"/api/agent/reopen/{run_id}")).status_code == 409
    assert space.sent == []


@pytest.mark.parametrize("outcome", ["escalated", "superseded"])
async def test_not_reopenable_after_those_outcomes(url, outcome):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("close", s.conversation, outcome=outcome)
        await s.poll()
        before = len(space.sent)
        assert (await client.post(f"/api/agent/reopen/{s.run_id}")).status_code == 409
        assert len(space.sent) == before


async def test_reopening_an_incident_continues_its_conversation(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("inform", s.conversation, payload={"text": "From before"})
        await s.poll()
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        await client.post(f"/api/agent/archive/{s.run_id}")
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
        assert [m["text"] for m in detail["conversation"]][0] == "From before"
        assert detail["conversation_state"] == "closed"
        new = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
        run = (await client.get(f"/api/agent/status/{new}")).json()
        assert run["status"] == "awaiting_machine_builder" and run["escalation"]["ref"] == detail["escalation"]["ref"]
        assert space.sent[-1]["performative"] == "reopen" and space.sent[-1]["conversation_id"] == s.conversation
        assert any(st["output"].get("text") == "From before" for st in run["steps"] if st["node"] == "message")
        # What arrives now goes to the new run.
        space.deliver("inform", s.conversation, payload={"text": "After"})
        await s.poll()
        run = (await client.get(f"/api/agent/status/{new}")).json()
        assert [st["output"]["text"] for st in run["steps"] if st["node"] == "message"][-1] == "After"


@pytest.mark.parametrize("outcome", ["escalated", "superseded"])
async def test_an_incident_not_reopenable(url, outcome):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("close", s.conversation, outcome=outcome)
        await s.poll()
        await client.post(f"/api/agent/archive/{s.run_id}")
        incident = (await client.get("/api/incidents")).json()[0]
        before = len(space.sent)
        refused = await client.post(f"/api/incidents/{incident['id']}/reopen")
        assert refused.status_code == 409 and f"closed as {outcome}" in refused.json()["error"]["message"]
        assert incident["outcome"] == "mb_closed"
    assert len(space.sent) == before


# ── The agent, through the service ──────────────────────────────────────────


class ReviewScript(Script):
    """Answers the agent's question from a list; `broken` makes it fail."""

    def __init__(self, actions=None):
        super().__init__()
        self.actions = list(actions or [])
        self.broken = False

    def answers(self):
        return super().answers() | {AgentAction: self.action}

    def action(self, prompt):
        if self.broken:
            raise StepFailed("conversation", "The model is away.")
        if self.actions:
            return self.actions.pop(0)
        return {"tool": "set_response", "arguments": {"text": "Noted."}}


def reviewed(app, run_id, message_id) -> bool:
    steps = app.state.runs.record(run_id).state.steps
    return any(st["output"].get("reviewed_for") == message_id for st in steps if st["node"] == "message")


async def test_asking_sends_nothing_and_is_kept(url):
    script = ReviewScript()
    app, space = make(url, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        answer = await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "What now?"})
        run = await s.run()
    assert answer.json() == {"reply": "Noted."} and len(space.sent) == before
    assert [(m["sender"], m["act"], m["internal"]) for m in s.messages(run)] == [
        ("operator", "question", True),
        ("agent", "answer", True),
    ]


async def test_a_send_tool_only_suggests(url):
    script = ReviewScript(
        [
            {"tool": "send_inform", "arguments": {"text": "Draft"}},
            {"tool": "send_close", "arguments": {"outcome": "resolved", "text": "Bye"}},
            {"tool": "set_response", "arguments": {"text": "Prepared."}},
        ]
    )
    app, space = make(url, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "Draft something"})
        run = await s.run()
    assert len(space.sent) == before
    suggest = [st for st in run["steps"] if st["node"] == "suggest"][-1]["output"]["suggestions"]
    assert [item["act"] for item in suggest] == ["inform", "close"]


async def test_the_next_question_has_the_earlier_ones_after_a_restart(url):
    seen = []
    script = ReviewScript()
    original = script.action

    def watching(prompt):
        seen.append(str(prompt))
        return original(prompt)

    script.action = watching
    space = Space()
    app, _ = make(url, space, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "The first question"})
    app2, _ = make(url, space, script=script)
    async with running(app2) as client:
        await connect(client)
        await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "The second question"})
    assert "The first question" in seen[-1] and "Noted." in seen[-1]


async def test_a_model_failing_on_a_question_keeps_it(url):
    script = ReviewScript()
    script.broken = True
    app, space = make(url, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "Anyone?"})
        assert answer.status_code == 503
        assert s.messages(await s.run())[-1]["text"] == "Anyone?"
        script.broken = False
        assert (await client.post(f"/api/agent/ask/{s.run_id}", json={"message": "Now?"})).status_code == 200


async def test_questions_at_once_and_before_escalating(url):
    gate = asyncio.Event()
    script = ReviewScript()

    async def slow(prompt):
        await gate.wait()
        return {"tool": "set_response", "arguments": {"text": "Slowly."}}

    script.action = slow
    app, space = make(url, script=script)
    async with running(app) as client:
        await connect(client)
        early = await to_confirmation(client, MACHINE)
        assert (await client.post(f"/api/agent/ask/{early}", json={"message": "x"})).status_code == 409
        assert (await client.post(f"/api/agent/escalate/{early}")).status_code == 200
        first = asyncio.create_task(client.post(f"/api/agent/ask/{early}", json={"message": "one"}))
        await eventually(lambda: app.state.runs.record(early).asking)
        assert (await client.post(f"/api/agent/ask/{early}", json={"message": "two"})).status_code == 409
        gate.set()
        assert (await first).status_code == 200


async def test_a_review_follows_a_data_request_and_its_failure_changes_nothing(url):
    script = ReviewScript()
    app, space = make(url, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = await requested(s)
        await eventually(
            lambda: any(
                m.get("reviewed_for") == mid
                for m in s.app.state.runs.record(s.run_id).state.steps
                and [st["output"] for st in s.app.state.runs.record(s.run_id).state.steps if st["node"] == "message"]
            )
        )
        script.broken = True
        other = await requested(s, "twin:history")
        await asyncio.sleep(0.1)
        run = await s.run()
    assert run["status"] == "awaiting_operator_approval"
    assert not any(m.get("reviewed_for") == other for m in s.messages(run))
    assert other in {m["message_id"] for m in s.messages(run)}


async def test_a_review_missed_is_done_after_a_restart(url):
    script = ReviewScript()
    script.broken = True
    space = Space()
    app, _ = make(url, space, script=script)
    async with running(app) as client:
        s = await scene(client, app, space)
        mid = await requested(s)
    script.broken = False
    app2, _ = make(url, space, script=script)
    async with running(app2) as client:
        await connect(client)
        await app2.state.inbox.poll_once()
        await eventually(
            lambda: any(
                st["output"].get("reviewed_for") == mid
                for st in app2.state.runs.record(s.run_id).state.steps
                if st["node"] == "message"
            )
        )


# ── What stays out ──────────────────────────────────────────────────────────


def test_the_agent_package_has_no_way_to_the_gateway():
    package = Path(__file__).resolve().parents[1] / "agent" / "xana_agent"
    for path in package.rglob("*.py"):
        text = path.read_text()
        for word in ("/outbox", "GatewayClient", "app.dataspace", "send_message"):
            assert word not in text, f"{path} holds {word}"


def test_the_diagnostic_workflow_stays_read_only():
    package = Path(__file__).resolve().parents[1] / "agent" / "xana_agent"
    for name in ("workflow.py", "steps/observe.py", "steps/validate.py"):
        assert "conversation" not in (package / name).read_text()
    assert json.loads((package / "conversation" / "cases.json").read_text())
