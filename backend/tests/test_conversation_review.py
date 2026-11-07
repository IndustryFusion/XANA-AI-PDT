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
"""What an independent look at the conversation found: refused sends, closes, files, and what a restart leaves."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.runs.conversation import _decision
from tests.dataspace_support import BUILDER
from tests.runs_support import MACHINE, rows, running, to_confirmation
from tests.space_support import connect
from tests.test_conversation import make, scene

pytestmark = pytest.mark.db


@pytest.fixture
def url(fresh_database):
    return fresh_database()


def messages(run):
    return [s["output"] for s in run["steps"] if s["node"] == "message"]


async def archive(client, run_id):
    await client.post(f"/api/agent/stop/{run_id}", json={})
    assert (await client.post(f"/api/agent/archive/{run_id}")).status_code == 204
    return (await client.get("/api/incidents")).json()[0]


def on_request(space, capability="twin:history"):
    next(a for a in space.access_here[BUILDER] if a["capability"] == capability)["status"] = "on-request"


# ── Refused sends (B1, S7) ───────────────────────────────────────────────────


async def test_a_refused_send_stays_unsent_after_a_refresh(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.conversations[s.conversation] |= {"state": "CLOSED_RESOLVED", "outcome": "resolved"}
        assert (await s.act("inform", text="Never went out")).status_code == 409
        await client.post(f"/api/agent/refresh-conversation/{s.run_id}")
        run = await s.run()
    assert space.refused
    assert not [m for m in messages(run) if m["sender"] == "operator"]


async def test_a_refused_grant_doesnt_count_as_granted(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        request = space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        space.conversations[s.conversation] |= {"state": "CLOSED_FAILED", "outcome": "failed"}
        assert (
            await client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": True})
        ).status_code == 409
        await client.post(f"/api/agent/refresh-conversation/{s.run_id}")
        run = await s.run()
    assert not [m for m in messages(run) if m.get("act") == "grant" and m.get("in_reply_to") == request]


async def test_a_received_row_in_the_conversation_isnt_taken_for_a_send(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        arrived = space.deliver("inform", s.conversation, payload={"text": "From the builder"})
        await client.post(f"/api/agent/refresh-conversation/{s.run_id}")
        run = await s.run()
    assert arrived not in [m["message_id"] for m in messages(run)]


async def test_a_close_that_lost_the_race_reports_the_conversations_outcome(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.conversations[s.conversation] = {"state": "CLOSED_SUPERSEDED", "outcome": "superseded"}
        accepted = space._accepted

        def lost(record):
            answer = accepted(record)
            return httpx.Response(202, json={**json.loads(answer.content), "applied": False})

        space._accepted = lost
        space._move = lambda body: None
        assert (await s.act("close", outcome="resolved", text="All good")).status_code == 200
        run = await s.run()
    assert run["data"]["outcome"] == "superseded"
    assert run["reopenable"] is False


# ── Closing (B2, B3, S3) ─────────────────────────────────────────────────────


async def test_stopping_while_the_builder_escalated_stays_pending_and_says_so(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("escalate", s.conversation)
        await s.poll()
        assert (await client.post(f"/api/agent/stop/{s.run_id}", json={"reason": "Done"})).status_code == 200
        run = await s.run()
        assert run["status"] == "stopped"
        assert run["data"]["close_pending"] is True and run["data"]["close_problem"]
        refused = len(space.refused)

        await s.poll()
        assert len(space.refused) == refused, "each try would stay listed at the gateway"
        assert (await s.run())["data"]["close_pending"] is True

        space.deliver("deescalate", s.conversation)
        await s.poll()
        run = await s.run()
    assert "close_pending" not in run["data"]
    assert space.conversations[s.conversation]["state"] == "CLOSED_WITHDRAWN"


async def test_a_refusal_with_403_counts_the_same(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.status_for["POST /outbox/messages"] = 403
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        run = await s.run()
    assert run["data"]["close_pending"] is True


async def test_a_conflict_on_a_closed_conversation_needs_nothing_more(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.conversations[s.conversation] = {"state": "CLOSED_RESOLVED", "outcome": "resolved"}
        space.status_for["POST /outbox/messages"] = 409
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        run = await s.run()
    assert "close_pending" not in run["data"]


async def test_archiving_with_a_close_pending_is_refused_and_the_close_goes_out(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.status_for["POST /outbox/messages"] = 503
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        assert (await client.post(f"/api/agent/archive/{s.run_id}")).status_code == 409
        space.status_for.clear()
        await s.poll()
        assert (await client.post(f"/api/agent/archive/{s.run_id}")).status_code == 204
    assert space.sent[-1]["performative"] == "close"


def later(app, seconds):
    """Moves the backend's clock on."""
    now = app.state.runs._now
    app.state.runs._now = lambda: now() + timedelta(seconds=seconds)


async def test_a_close_the_receiver_didnt_get_is_repeated_with_its_outcome(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await s.act("close", outcome="resolved", text="All good")
        close = space.sent[-1]["message_id"]
        space.message_status[close] = "error"
        space.fail_status[close] = "receiver down"
        await app.state.runs.check_outbox()
        run = await s.run()
        assert run["data"]["close_pending"] is True and "receiver down" in run["data"]["close_problem"]
        later(app, 61)
        await s.poll()
        run = await s.run()
    closes = [m for m in space.sent if m.get("performative") == "close"]
    assert len(closes) == 2
    assert closes[1]["outcome"] == "resolved"
    assert "close_pending" not in run["data"]


async def fail_closes(app, space):
    for message in space.sent:
        if message.get("performative") == "close":
            space.message_status[message["message_id"]] = "error"
            space.fail_status[message["message_id"]] = "receiver down"
    await app.state.runs.check_outbox()


async def test_repeating_a_close_backs_off_and_adds_no_step(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        first = await s.run()
        for _ in range(6):
            await fail_closes(app, space)
            await s.poll()
        closes = lambda: [m for m in space.sent if m.get("performative") == "close"]  # noqa: E731
        assert len(closes()) == 1, "not before its time"

        later(app, 61)  # 60 s for the first failure
        await s.poll()
        assert len(closes()) == 2
        await fail_closes(app, space)
        later(app, 61)  # 120 s for the second: not due
        await s.poll()
        assert len(closes()) == 2
        later(app, 60)
        await s.poll()
        assert len(closes()) == 3
        run = await s.run()
        assert len(messages(run)) == len(messages(first)), "one close in the conversation"
        assert len(run["steps"]) == len(first["steps"])
        assert len([e for e in run["outbox"] if e["status"] == "failed"]) == 0
        assert len(run["outbox"]) == len(first["outbox"])
        await client.post(f"/api/agent/refresh-conversation/{s.run_id}")
        assert len(messages(await s.run())) == len(messages(first)), "earlier sends stay known"


async def test_the_wait_between_closes_has_a_limit(url):
    app, _ = make(url)
    runs = app.state.runs
    data = {"close_attempts": 40}
    retry = datetime.fromisoformat(runs.close_backoff(data)["close_retry_at"])
    assert retry - datetime.now(UTC) <= timedelta(seconds=3601)


# ── A half-finished escalation (B9) ──────────────────────────────────────────


@pytest.mark.parametrize("lookup_fails", [False, True])
async def test_stopping_a_half_finished_escalation_tells_the_builder(url, lookup_fails):
    app, space = make(url)
    async with running(app) as client:
        await connect(client)
        run_id = await to_confirmation(client, MACHINE)
        failing = "POST /outbox/messages"
        space.status_for[failing] = 503
        assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code >= 400
        conversation = space.sent[0]["conversation_id"]
        space.status_for.clear()
        if lookup_fails:
            space.status_for["POST /outbox/messages"] = 503
        assert (await client.post(f"/api/agent/stop/{run_id}", json={})).status_code == 200
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
        assert run["status"] == "stopped"
        assert run["reopenable"] is False
        if lookup_fails:
            assert run["data"]["close_pending"] is True
            space.status_for.clear()
            await app.state.inbox.poll_once()
        reply = space.deliver("inform", conversation, payload={"text": "What is this about?"})
        await app.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{run_id}")).json()
    assert [m["kind"] for m in space.sent] == ["files", "message"]
    assert space.sent[1]["performative"] == "close"
    assert space.sent[1]["receiver_participant"] == BUILDER
    assert reply in [m["message_id"] for m in messages(run)]


async def test_an_archived_half_escalated_run_reopens_as_a_new_analysis(url):
    app, space = make(url)
    async with running(app) as client:
        await connect(client)
        run_id = await to_confirmation(client, MACHINE)
        space.status_for["POST /outbox/messages"] = 503
        await client.post(f"/api/agent/escalate/{run_id}")
        space.status_for.clear()
        incident = await archive(client, run_id)
        assert (await client.post(f"/api/incidents/{incident['id']}/reopen")).status_code == 202


# ── Restart (B4, S8) ─────────────────────────────────────────────────────────


async def lost_send(space, conversation, **fields):
    space.sent.append(
        {"message_id": "m-lost", "conversation_id": conversation, "kind": "message", "payload": {}, **fields}
    )
    space.message_status["m-lost"] = "notified"


async def test_a_close_accepted_and_not_stored_gives_the_closed_status_after_a_restart(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await lost_send(space, s.conversation, performative="close", outcome="withdrawn")
        space.conversations[s.conversation] = {"state": "CLOSED_WITHDRAWN", "outcome": "withdrawn"}
    app, _ = make(url, space)
    async with running(app) as client:
        await connect(client)
        await app.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{s.run_id}")).json()
    assert run["status"] == "stopped"
    assert run["data"]["outcome"] == "withdrawn"
    assert [m["act"] for m in messages(run)].count("close") == 1


async def test_a_deny_accepted_and_not_stored_settles_the_request_after_a_restart(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        request = space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        await lost_send(space, s.conversation, performative="deny", capability="twin:history", in_reply_to=request)
    app, _ = make(url, space)
    async with running(app) as client:
        await connect(client)
        await app.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{s.run_id}")).json()
    assert run["status"] == "awaiting_machine_builder"


async def hold_conversation_reads(app, space, when):
    """Holds the next read of a conversation for which `when()` holds. `entered` and `gate` steer it."""
    entered, gate, handle = asyncio.Event(), asyncio.Event(), space.handle
    held = []

    async def holding(request):
        reading = request.method == "GET" and request.url.path.startswith("/conversations/")
        if reading and when() and not held:
            held.append(1)
            entered.set()
            await gate.wait()
        return await handle(request)

    space.handle = holding
    app.state.gateway._transport = httpx.MockTransport(holding)
    return entered, gate


async def test_a_refresh_during_a_send_doesnt_add_it_twice(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await s.poll()
        sent = lambda: any(m.get("performative") == "inform" for m in space.sent)  # noqa: E731
        entered, gate = await hold_conversation_reads(app, space, sent)
        sending = asyncio.create_task(s.act("inform", text="once"))
        await entered.wait()
        assert (await client.post(f"/api/agent/refresh-conversation/{s.run_id}")).status_code == 200
        gate.set()
        assert (await sending).status_code == 200
        run = await s.run()
    assert len([m for m in messages(run) if m.get("act") == "inform"]) == 1


async def test_the_first_look_after_a_start_is_repeated_if_a_send_was_in_progress(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        desk = app.state.runs.desk
        rec = app.state.runs.record(s.run_id)
        rec.busy = True
        await desk.on_start()
        assert s.run_id not in desk._reconciled
        rec.busy = False
        await desk.on_start()
        assert s.run_id in desk._reconciled


# ── Received (B5, B6) ────────────────────────────────────────────────────────


async def test_a_builders_reopen_of_a_completed_run_takes_effect(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("inform", s.conversation, payload={"recommendation": "Replace the filter"})
        await s.poll()
        assert (
            await client.post(f"/api/agent/recommendation-reply/{s.run_id}", json={"action": "resolved"})
        ).status_code == 200
        assert (await s.run())["status"] == "completed"
        space.deliver("reopen", s.conversation, payload={"text": "It came back"})
        await s.poll()
        run = await s.run()
    assert run["status"] == "awaiting_machine_builder"


@pytest.mark.parametrize("raw", [b"nul \\u0000 byte", b"lone \\ud800 half", b"\\udfff"])
async def test_peer_text_the_database_cant_store_doesnt_block_the_inbox(url, raw):
    app, space = make(url)
    route = space.route

    def with_raw(request):
        answer = route(request)
        if request.url.path == "/inbox/messages":
            return httpx.Response(
                200, content=answer.content.replace(b"RAWTEXT", raw), headers={"content-type": "application/json"}
            )
        return answer

    space.route = with_raw
    async with running(app) as client:
        s = await scene(client, app, space)
        bad = space.deliver("inform", s.conversation, payload={"text": "x RAWTEXT y"})
        good = space.deliver("close", s.conversation, outcome="resolved")
        await s.poll()
        run = await s.run()
    assert bad in space.acks and good in space.acks
    stored = next(m for m in messages(run) if m["message_id"] == bad)
    assert stored["text"].startswith("x ")


# ── Files (B7) ───────────────────────────────────────────────────────────────


async def files_message(space, s):
    message = space.deliver("inform", s.conversation, has_files=True, payload={"_bundle": True})
    space.downloads[message] = b"PK-zip-bytes"
    await s.poll()
    return message


async def test_files_stay_available_after_archiving(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        message = await files_message(space, s)
        incident = await archive(client, s.run_id)
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
        link = next(m for m in detail["conversation"] if m["message_id"] == message)["files_url"]
        got = await client.get(link)
    assert (got.status_code, got.content) == (200, b"PK-zip-bytes")


async def test_files_stay_available_after_reopening_the_incident(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        message = await files_message(space, s)
        incident = await archive(client, s.run_id)
        new = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
        run = (await client.get(f"/api/agent/status/{new}")).json()
        got = await client.get(next(m for m in messages(run) if m["message_id"] == message)["files_url"])
    assert (got.status_code, got.content) == (200, b"PK-zip-bytes")


async def test_a_late_messages_files_are_kept_and_it_isnt_handled_twice(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        incident = await archive(client, s.run_id)
        message = space.deliver("inform", s.conversation, has_files=True, payload={"_bundle": True})
        space.downloads[message] = b"PK-late"
        await s.poll()
        assert message in space.acks
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
        late = next(m for m in detail["conversation"] if m["message_id"] == message)
        got = await client.get(late["files_url"])
        assert got.content == b"PK-late"

        # The acknowledgement got lost: seen again, it isn't added again.
        again = dict(next(m for m in space.inbox if m["message_id"] == message), status="received")
        assert await app.state.runs.desk.receive(again) is True
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert [m["message_id"] for m in detail["conversation"]].count(message) == 1


async def test_a_refused_download_is_an_answer_not_a_broken_one(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        message = space.deliver("inform", s.conversation, payload={"text": "no files"})
        await s.poll()
        assert (await client.get(f"/api/agent/message-files/{s.run_id}/{message}")).status_code == 404
        assert (await client.get(f"/api/agent/message-files/{s.run_id}/unknown")).status_code == 404
        assert not [r for r in space.requests if "unknown" in str(r.url)], "an unknown ID isn't asked of the gateway"


# ── What the operator looked at (B8) ─────────────────────────────────────────


async def test_a_decision_is_bound_to_the_request_shown(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        first = space.deliver("request", s.conversation, capability="twin:direct", payload={"text": "the nameplate"})
        await s.poll()
        assert (await s.run())["data"]["request_id"] == first
        space.deliver("cancel", s.conversation, in_reply_to=first)
        second = space.deliver("request", s.conversation, capability="twin:history", payload={"text": "all history"})
        await s.poll()
        before = len(space.sent)
        body = {"approved": True, "request_id": first}
        answer = await client.post(f"/api/agent/approve-data-request/{s.run_id}", json=body)
        assert answer.status_code == 409
        assert len(space.sent) == before
        assert not space.policies
        body["request_id"] = second
        assert (await client.post(f"/api/agent/approve-data-request/{s.run_id}", json=body)).status_code == 200


async def test_an_answer_is_bound_to_the_recommendation_shown(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        first = space.deliver("inform", s.conversation, payload={"recommendation": "Replace the filter"})
        await s.poll()
        data = (await s.run())["data"]
        assert data["recommendation_id"] == first
        await s.act("inform", text="Looking")
        before = len(space.sent)
        body = {"action": "resolved", "recommendation_id": "another"}
        assert (await client.post(f"/api/agent/recommendation-reply/{s.run_id}", json=body)).status_code == 409
        assert len(space.sent) == before
        body["recommendation_id"] = first
        assert (await client.post(f"/api/agent/recommendation-reply/{s.run_id}", json=body)).status_code == 200


# ── Archiving while something holds the run (B10) ────────────────────────────


async def test_a_message_in_hand_during_archiving_reaches_the_record(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        await s.poll()
        message = space.deliver("inform", s.conversation, payload={"text": "Last words"})
        entered, gate = await hold_conversation_reads(app, space, lambda: True)
        polling = asyncio.create_task(s.poll())
        await entered.wait()
        assert (await client.post(f"/api/agent/archive/{s.run_id}")).status_code == 204
        gate.set()
        await polling
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert message in space.acks
    assert "Last words" in [m.get("text") for m in detail["conversation"]]
    assert not rows(url, "SELECT 1 FROM runs WHERE run_id = %s", s.run_id)


async def test_what_finishes_after_archiving_doesnt_bring_the_run_back(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        await client.post(f"/api/agent/stop/{s.run_id}", json={})
        rec = app.state.runs.record(s.run_id)
        rec.state = rec.state.__class__(**{**rec.state.__dict__, "outbox": ({"message_id": "m", "status": "pending"},)})
        space.message_status["m"] = "notified"
        assert (await client.post(f"/api/agent/archive/{s.run_id}")).status_code == 204
        await app.state.runs.desk.review(rec, "any")
        await app.state.runs._check_run_outbox(rec)
        with pytest.raises(Exception, match="archived"):
            await app.state.runs.change(rec, data={})
    assert not rows(url, "SELECT 1 FROM runs WHERE run_id = %s", s.run_id)


# ── Reopening an incident (S1, S2) ───────────────────────────────────────────


async def test_reopening_an_incident_doesnt_show_earlier_sends_as_new(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        sent = [m["message_id"] for m in space.sent]
        incident = await archive(client, s.run_id)
        new = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
        await s.poll()
        run = (await client.get(f"/api/agent/status/{new}")).json()
    ids = [m["message_id"] for m in messages(run)]
    assert not set(sent) & set(ids)
    assert set(sent) <= {entry["message_id"] for entry in run["outbox"]}


async def test_reopening_with_a_request_pending_waits_for_the_decision(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        incident = await archive(client, s.run_id)
        new = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
        run = (await client.get(f"/api/agent/status/{new}")).json()
        decide = await client.post(f"/api/agent/approve-data-request/{new}", json={"approved": False})
    assert run["status"] == "awaiting_operator_approval"
    assert decide.status_code == 200


# ── A failed grant (S4) ──────────────────────────────────────────────────────


async def test_declining_after_a_failed_grant_takes_back_what_this_backend_approved(url):
    app, space = make(url)
    on_request(space)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        space.status_for["POST /outbox/messages"] = 503
        assert (
            await client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": True})
        ).status_code >= 400
        space.status_for.clear()
        assert space.policies[-1]["action"] == "approve"
        assert (
            await client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": False})
        ).status_code == 200
    assert space.policies[-1]["action"] == "reset"


async def test_declining_leaves_access_that_was_approved_before(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        space.status_for["POST /outbox/messages"] = 503
        await client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": True})
        space.status_for.clear()
        await client.post(f"/api/agent/approve-data-request/{s.run_id}", json={"approved": False})
    assert [p["action"] for p in space.policies] == ["approve"]


async def test_a_decline_is_refused_once_the_grant_went_out(url):
    app, space = make(url)
    on_request(space)
    async with running(app) as client:
        s = await scene(client, app, space)
        request = space.deliver("request", s.conversation, capability="twin:history")
        await s.poll()
        space.status_for["POST /outbox/files"] = 503
        body = {"approved": True, "request_id": request}
        assert (await client.post(f"/api/agent/approve-data-request/{s.run_id}", json=body)).status_code >= 400
        space.status_for.clear()
        before = len(space.sent)
        declined = await client.post(f"/api/agent/approve-data-request/{s.run_id}", json=body | {"approved": False})
        assert declined.status_code == 409
        assert len(space.sent) == before
        assert (await client.post(f"/api/agent/approve-data-request/{s.run_id}", json=body)).status_code == 200
    assert space.sent[-1]["kind"] == "files"


async def half_escalated_and_reopened(client, space):
    await connect(client)
    run_id = await to_confirmation(client, MACHINE)
    space.status_for["POST /outbox/messages"] = 503
    await client.post(f"/api/agent/escalate/{run_id}")
    space.status_for.clear()
    conversation = space.sent[0]["conversation_id"]
    await client.post(f"/api/agent/stop/{run_id}", json={})
    space.deliver("reopen", conversation)
    return run_id, conversation


async def test_a_half_escalated_run_reopened_by_the_builder_refuses_a_grant_cleanly(url):
    app, space = make(url)
    async with running(app) as client:
        run_id, conversation = await half_escalated_and_reopened(client, space)
        request = space.deliver("request", conversation, capability="twin:history")
        await app.state.inbox.poll_once()
        assert (await client.get(f"/api/agent/status/{run_id}")).json()["status"] == "awaiting_operator_approval"
        before = len(space.sent)
        body = {"approved": True, "request_id": request}
        granted = await client.post(f"/api/agent/approve-data-request/{run_id}", json=body)
        assert granted.status_code == 409
        assert len(space.sent) == before and not space.policies


async def test_a_half_escalated_run_reopened_by_the_builder_refuses_an_answer_cleanly(url):
    app, space = make(url)
    async with running(app) as client:
        run_id, conversation = await half_escalated_and_reopened(client, space)
        space.deliver("inform", conversation, payload={"recommendation": "Replace it"})
        await app.state.inbox.poll_once()
        answer = await client.post(f"/api/agent/recommendation-reply/{run_id}", json={"action": "resolved"})
    assert answer.status_code == 409


# ── What a grant of history delivers (final review B1) ───────────────────────


async def history_grant(app, space, client, adjacents):
    await connect(client)
    for item in space.access_here[BUILDER]:
        if item["capability"] == "twin:history":
            item["status"] = "on-request"
        if item["capability"] == "twin:adjacents":
            item["status"] = adjacents
    run_id = await to_confirmation(client, MACHINE)
    assert (await client.post(f"/api/agent/escalate/{run_id}")).status_code == 200
    request = space.deliver("request", space.sent[0]["conversation_id"], capability="twin:history")
    await app.state.inbox.poll_once()
    body = {"approved": True, "request_id": request}
    assert (await client.post(f"/api/agent/approve-data-request/{run_id}", json=body)).status_code == 200
    run = (await client.get(f"/api/agent/status/{run_id}")).json()
    check = [step for step in run["steps"] if step["node"] == "policy_check"][-1]["output"]
    return [m for m in space.sent if m.get("kind") == "files"][-1]["files"]["signal-history.json"], check


async def test_a_grant_of_history_holds_related_signals_if_those_entities_may_go(url):
    app, space = make(url, tier="timeseries")
    async with running(app) as client:
        history, check = await history_grant(app, space, client, "approved")
    assert history
    assert check["signals"] == len(history)
    assert f"{len(history)} signals" in check["decision"]
    assert list(check["files"]) == ["signal-history.json"]


@pytest.mark.parametrize(("tier", "adjacents"), [("timeseries", "on-request"), ("minimal", "approved")])
async def test_otherwise_the_machines_own_and_the_operator_is_told_what_went(url, tier, adjacents):
    app, space = make(url, tier=tier)
    async with running(app) as client:
        history, check = await history_grant(app, space, client, adjacents)
    assert {signal["entity_id"] for signal in history} <= {MACHINE}
    assert check["signals"] == len(history)
    if not history:
        assert "0 signals" in check["decision"]
        assert "and sent" not in check["decision"]


def test_saying_plainly_that_a_file_holds_nothing():
    empty = [("signal-history.json", b"[]")]
    assert "0 signals" in _decision("twin:history", empty)
    assert "and sent" not in _decision("twin:history", empty)
    assert _decision("twin:history", [("signal-history.json", b"[1, 2]")]).endswith("2 signals.")
    assert _decision("twin:direct", [("machine.json", b"{}")]) == "Approved by the operator and sent."


# ── One message that fails (S6) ──────────────────────────────────────────────


async def test_a_message_too_deep_to_handle_stays_and_holds_up_nothing(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        bad = space.deliver("inform", s.conversation, payload={"text": "bad"})
        good = space.deliver("inform", s.conversation, payload={"text": "next"})
        desk = app.state.runs.desk
        receive = desk.receive

        async def too_deep(message):
            if message["message_id"] == bad:
                raise RecursionError("maximum recursion depth exceeded")
            return await receive(message)

        desk.receive = too_deep
        await s.poll()
        run = await s.run()
    assert good in space.acks
    assert bad not in space.acks
    assert good in [m["message_id"] for m in messages(run)]


# ── After a start, and the record (S6, minors) ───────────────────────────────


async def test_a_message_waits_until_the_runs_are_restored(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        incident = await archive(client, s.run_id)
        new = (await client.post(f"/api/incidents/{incident['id']}/reopen")).json()["run_id"]
    app, _ = make(url, space)

    async def gave_up():
        return None

    app.state.runs.start_up = gave_up
    async with running(app) as client:
        await app.state.gateway_connection.connect(None)
        message = space.deliver("inform", s.conversation, payload={"text": "For the reopened run"})
        await app.state.inbox.poll_once()
        run = (await client.get(f"/api/agent/status/{new}")).json()
    assert message in [m["message_id"] for m in messages(run)]


async def test_an_incident_records_the_outcome_of_the_close(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        space.deliver("close", s.conversation, outcome="rejected", payload={"reason": "Not our machine"})
        await s.poll()
        await client.post(f"/api/agent/archive/{s.run_id}")
        incident = (await client.get("/api/incidents")).json()[0]
        detail = (await client.get(f"/api/incidents/{incident['id']}")).json()
    assert detail["resolution"] == "Not our machine (outcome: rejected)"


async def test_a_download_renews_a_refused_token(url):
    app, space = make(url)
    async with running(app) as client:
        s = await scene(client, app, space)
        message = space.deliver("inform", s.conversation, has_files=True, payload={"_bundle": True})
        space.downloads[message] = b"PK"
        route, refused, grants = space.route, [], space.grants

        def refuse_a_download_once(request):
            if request.url.path.endswith("/download") and not refused:
                refused.append(1)
                return httpx.Response(401, json={"detail": "expired"})
            return route(request)

        space.route = refuse_a_download_once
        await s.poll()
        assert refused and message in space.acks
        assert space.grants > grants
        got = await client.get(f"/api/agent/message-files/{s.run_id}/{message}")
    assert got.content == b"PK"
