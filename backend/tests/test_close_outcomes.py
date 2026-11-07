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
"""Closing with every outcome, the escalated close from an open conversation, and the diagnosis for the agent."""

import asyncio

import pytest

from app.runs import conversation as desk
from app.runs.conversation import diagnosis_of
from app.runs.model import RunState
from tests.runs_support import running
from tests.test_conversation import make, scene

pytestmark = pytest.mark.db


@pytest.fixture
def url(fresh_database):
    return fresh_database()


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    monkeypatch.setattr(desk, "ESCALATE_WAIT_S", 0.5)
    monkeypatch.setattr(desk, "ESCALATE_POLL_S", 0.01)


# ── Outcomes ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("given", "sent", "reopenable"),
    [("rejected", "rejected", True), ("timed_out", "timed_out", True), ("resolved", "resolved", True)],
)
async def test_the_new_outcomes_are_sent_and_recorded(url, given, sent, reopenable):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome=given, text="Sorted by phone")
        run = await s.run()
        assert answer.status_code == 200, answer.text
        archived = await client.post(f"/api/agent/archive/{s.run_id}")
        assert archived.status_code == 204
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert space.sent[-1]["performative"] == "close" and space.sent[-1]["outcome"] == sent
    assert run["data"]["outcome"] == given and run["reopenable"] is reopenable
    assert space.conversations[s.conversation]["state"] == f"CLOSED_{sent.upper()}"
    assert f"outcome: {given}" in detail["resolution"] and detail["conversation_state"] == "closed"


@pytest.mark.parametrize("outcome", ["superseded", "withdrawn", "", None, "maybe"])
async def test_other_outcomes_are_refused_before_sending(url, outcome):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        before = len(space.sent)
        answer = await s.act("close", outcome=outcome)
    assert answer.status_code == 422 and len(space.sent) == before


async def test_closing_while_the_builder_escalated_is_refused(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("escalate", s.conversation)
        await s.poll()
        before = len(space.sent)
        for outcome in ("resolved", "escalated"):
            answer = await s.act("close", outcome=outcome)
            assert answer.status_code == 409, answer.text
    assert len(space.sent) == before


# ── Escalated close ─────────────────────────────────────────────────────────


async def test_escalated_from_open_sends_escalate_then_close(url):
    app, space = make(url)
    space.status_on_accept["escalate"] = "notified"
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome="escalated")
        run = await s.run()
    assert answer.status_code == 200, answer.text
    assert s.sent_acts()[-2:] == ["escalate", "close"] and space.sent[-1]["outcome"] == "escalated"
    assert space.conversations[s.conversation]["state"] == "CLOSED_ESCALATED"
    acts = [m["act"] for m in s.messages(run)]
    assert acts[-2:] == ["escalate", "close"]
    assert run["status"] == "stopped" and run["reopenable"] is False


async def test_close_waits_for_the_escalate_to_arrive(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        task = asyncio.create_task(s.act("close", outcome="escalated"))
        for _ in range(100):
            if s.sent_acts()[-1:] == ["escalate"]:
                break
            await asyncio.sleep(0.005)
        await asyncio.sleep(0.05)
        assert s.sent_acts()[-1] == "escalate"  # no close while the escalate is on its way
        space.message_status[space.sent[-1]["message_id"]] = "notified"
        answer = await task
    assert answer.status_code == 200 and s.sent_acts()[-2:] == ["escalate", "close"]


async def test_already_escalating_sends_only_the_close(url):
    app, space = make(url)
    space.status_on_accept["escalate"] = "notified"
    async with running(app) as client:
        s = await scene(client, app, space)
        assert (await s.act("escalate")).status_code == 200
        answer = await s.act("close", outcome="escalated")
    assert answer.status_code == 200 and s.sent_acts()[-2:] == ["escalate", "close"]
    assert s.sent_acts().count("escalate") == 1


async def test_a_refused_escalate_sends_nothing_more(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.status_for["POST /outbox/messages"] = 422
        before = len(space.sent)
        answer = await s.act("close", outcome="escalated")
        run = await s.run()
    assert answer.status_code in (409, 422) and answer.json()["error"]["message"]
    assert len(space.sent) == before and run["status"] != "stopped"


@pytest.mark.parametrize("status", ["error", "rejected"])
async def test_an_undelivered_escalate_sends_nothing_more_and_a_new_close_escalates_again(url, status):
    app, space = make(url)
    space.status_on_accept["escalate"] = status
    space.fail_status_on_accept["escalate"] = "The receiver's adapter refused it"
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome="escalated")
        assert answer.status_code == 409
        message = answer.json()["error"]["message"]
        assert "did not get the escalation" in message and "refused it" in message
        assert s.sent_acts()[-1] == "escalate" and "close" not in s.sent_acts()
        space.status_on_accept["escalate"] = "notified"
        again = await s.act("close", outcome="escalated")
    assert again.status_code == 200, again.text
    assert s.sent_acts()[-3:] == ["escalate", "escalate", "close"]


async def test_an_escalate_still_on_its_way_after_the_wait_sends_no_close(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome="escalated")
        assert answer.status_code == 409 and "Close again once" in answer.json()["error"]["message"]
        assert "close" not in s.sent_acts()
        space.message_status[space.sent[-1]["message_id"]] = "notified"
        again = await s.act("close", outcome="escalated")
    assert again.status_code == 200 and s.sent_acts()[-2:] == ["escalate", "close"]


async def test_crossing_escalations_lost_sends_no_close(url):
    app, space = make(url)
    space.escalate_loses = True
    async with running(app) as client:
        s = await scene(client, app, space)
        answer = await s.act("close", outcome="escalated")
    assert answer.status_code == 409 and "machine builder escalated" in answer.json()["error"]["message"]
    assert "close" not in s.sent_acts()


async def test_another_act_during_an_escalated_close_is_refused(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        task = asyncio.create_task(s.act("close", outcome="escalated"))
        for _ in range(100):
            if s.sent_acts()[-1:] == ["escalate"]:
                break
            await asyncio.sleep(0.005)
        other = await s.act("inform", text="Meanwhile")
        space.message_status[space.sent[-1]["message_id"]] = "notified"
        await task
    assert other.status_code == 409


# ── The diagnosis for the agent ─────────────────────────────────────────────


def state(steps, data=None):
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    return RunState("r", "urn:m", "issue", "awaiting_input", now, now, data=data or {}, steps=tuple(steps))


def step(node, output, round_=1):
    return {"node": node, "input": None, "output": output, "at": "2026-11-07T00:00:00+00:00", "round": round_}


def test_the_diagnosis_has_root_cause_confidence_top_three_and_alerts():
    hypotheses = [
        {"title": t, "confidence": c, "verdict": "confirmed"}
        for t, c in [("A", 0.2), ("B", 0.9), ("C", 0.5), ("D", 0.7)]
    ]
    alerts = [{"event": "Hot", "severity": "major", "id": "x", "raw": {"big": 1}}]
    found = diagnosis_of(
        state(
            [
                step("observe", {"alerts": alerts}),
                step("validate", {"hypotheses": hypotheses}),
                step("decide", {"root_cause": "B", "confidence": 0.9}),
            ]
        )
    )
    assert found["root_cause"] == "B" and found["confirmed"] is True and found["confidence"] == 0.9
    assert [h["title"] for h in found["hypotheses"]] == ["B", "D", "C"]
    assert found["active_alerts"] == [{"event": "Hot", "severity": "major"}]


def test_the_latest_round_counts():
    found = diagnosis_of(
        state(
            [
                step("validate", {"hypotheses": [{"title": "Old", "confidence": 0.95}]}, 1),
                step("decide", {"root_cause": "Old", "confidence": 0.95}, 1),
                step("validate", {"hypotheses": [{"title": "New", "confidence": 0.6}]}, 2),
                step("decide", {"root_cause": None, "confidence": 0.6}, 2),
            ]
        )
    )
    assert found["root_cause"] == "New" and found["confirmed"] is False and found["confidence"] == 0.6


def test_no_diagnosis_yet():
    assert diagnosis_of(state([step("observe", {"alerts": []})])) is None


async def test_the_agent_gets_the_diagnosis_in_its_turn(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        run = app.state.runs.record(s.run_id)
        turn = app.state.runs.desk._turn(run.state, "What did you diagnose?")
    assert turn.diagnosis and turn.diagnosis["root_cause"] and turn.diagnosis["confidence"] is not None
