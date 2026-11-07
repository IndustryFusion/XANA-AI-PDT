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
"""The conversation with the machine builder: what arrives, what the operator sends, and how a run follows.

Only an operator's request sends. See the `gh-29-machine-builder-conversation` design for the order of receiving.
"""

from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.dataspace.gateway import GatewayClient
from app.dataspace.sharing import ADJACENTS, ALLOWED_ACCESS, FILES, HISTORY, LABELS, TIERS, Sharing, apply_policy
from app.errors import Refused, conflict, invalid, not_found, unavailable
from app.memory.store import IncidentStore, RunStore
from app.runs.escalation import DELIVERY, Escalator
from app.runs.model import (
    AWAITING_MACHINE_BUILDER,
    AWAITING_OPERATOR_APPROVAL,
    AWAITING_RECOMMENDATION_REVIEW,
    COMPLETED,
    CONVERSATION,
    MB_CLOSED,
    OPEN,
    STOPPED,
    RunState,
)
from xana_agent.conversation import ConversationAgent, ConversationInput
from xana_agent.steps import StepFailed

if TYPE_CHECKING:
    from app.runs.manager import RunManager, RunRecord

log = logging.getLogger(__name__)

MAX_STORED_FILE = 50 * 1024 * 1024
MISSING_FILE_TRIES = 5
GRANT_DAYS = 30
NOT_REOPENABLE = ("escalated", "superseded")
OUTCOME_TO_SEND = {"not_resolved": "failed"}
PROTOCOL_ACTS = ("inform", "request", "escalate", "deescalate")


def clean(value: Any) -> Any:
    """A peer's data without what the database can't store: NUL and lone surrogates, at any depth."""
    if isinstance(value, str):
        return value.replace("\x00", "").encode("utf-8", "ignore").decode("utf-8")
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        return {clean(key): clean(item) for key, item in value.items()}
    return value


def conversation_of(state: RunState) -> str | None:
    """The run's conversation, also while its escalation is half finished: files accepted, request not."""
    return state.conversation_id or (state.attempt or {}).get("conversation_id")


def sent_rows(conversation: dict[str, Any]) -> list[dict[str, Any]]:
    """What this side sent. The gateway keeps a refused send in the list too, marked: that was not sent."""
    return [
        m
        for m in conversation.get("messages") or []
        if m.get("direction") == "sent" and m.get("applied") is not False and m.get("status") != "rejected"
    ]


def conversation_state(conversation: dict[str, Any], me: str | None) -> str:
    """A gateway's state, in the interface's terms."""
    state = str(conversation.get("state") or "OPEN").upper()
    if state.startswith("CLOSED"):
        return "closed"
    if state == "ESCALATING":
        return "direct_contact_operator" if conversation.get("escalated_by") == me else "direct_contact_machine_builder"
    return "open"


def text_of(message: dict[str, Any]) -> str:
    """What a message says, whatever a peer put in its payload."""
    payload = message.get("payload")
    if isinstance(payload, dict):
        for key in ("text", "message", "summary", "reason", "note"):
            if isinstance(payload.get(key), str) and payload[key]:
                return payload[key]
        recommendation = payload.get("recommendation")
        if isinstance(recommendation, str):
            return recommendation
        if isinstance(recommendation, dict) and isinstance(recommendation.get("summary"), str):
            return recommendation["summary"]
        rest = {key: value for key, value in payload.items() if key != "_bundle"}
        if rest:
            return json.dumps(rest, ensure_ascii=False, default=str)[:2000]
    if message.get("capability"):
        return f"{message.get('performative')}: {message['capability']}"
    return "Files attached." if message.get("has_files") else str(message.get("performative") or "")


def recommendation_of(message: dict[str, Any]) -> dict[str, Any] | None:
    """Read from the payload's field alone: no model takes part, so none can be made up."""
    payload = message.get("payload")
    found = payload.get("recommendation") if isinstance(payload, dict) else None
    if isinstance(found, str) and found.strip():
        return {"summary": found, "actions": [found]}
    if isinstance(found, dict) and isinstance(found.get("summary"), str):
        actions = (
            [str(item) for item in found.get("actions") or [] if item] if isinstance(found.get("actions"), list) else []
        )
        return {"summary": found["summary"], "actions": actions or [found["summary"]]}
    return None


def messages_of(state: RunState) -> list[dict[str, Any]]:
    return [step["output"] for step in state.steps if step["node"] == "message"]


def last_state(state: RunState) -> str:
    for message in reversed(messages_of(state)):
        if message.get("conv_state"):
            return message["conv_state"]
    return "open"


def _settled_requests(state: RunState) -> set[str]:
    """Data requests needing nothing more: declined, withdrawn, or granted and sent."""
    settled = {step["output"].get("request_id") for step in state.steps if step["node"] == "policy_check"}
    for message in messages_of(state):
        if message.get("act") in ("deny", "cancel"):
            settled.add(message.get("in_reply_to"))
    return settled


def pending_request(state: RunState) -> dict[str, Any] | None:
    settled = _settled_requests(state)
    for message in messages_of(state):
        if message.get("data_request") and message["message_id"] not in settled:
            return message
    return None


def pending_recommendation(state: RunState) -> dict[str, Any] | None:
    answered = {step["output"].get("message_id") for step in state.steps if step["node"] == "recommendation_reply"}
    for message in messages_of(state):
        if message.get("recommendation") and message["message_id"] not in answered:
            return message
    return None


def _granted(state: RunState, request_id: str) -> bool:
    """Whether a grant for this request went out and may have arrived. One whose delivery failed didn't."""
    failed = {entry["message_id"] for entry in state.outbox if entry["status"] == "failed"}
    return any(
        m.get("act") == "grant" and m.get("in_reply_to") == request_id and m.get("message_id") not in failed
        for m in messages_of(state)
    )


def _signal_count(files: list[tuple[str, bytes]]) -> int:
    content = dict(files).get(FILES[HISTORY])
    return len(json.loads(content)) if content else 0


def _decision(capability: str, files: list[tuple[str, bytes]]) -> str:
    """What went out, as far as it tells: a file can go and hold nothing."""
    if capability != HISTORY:
        return "Approved by the operator and sent."
    count = _signal_count(files)
    if count == 0:
        return (
            "Approved by the operator. The history file sent holds 0 signals: there were none in the 24 hours "
            "queried. Those of related entities go only if related entities may go to this builder."
        )
    return f"Approved by the operator and sent: {count} signal{'' if count == 1 else 's'}."


def _worth_reviewing(message: dict[str, Any]) -> bool:
    return bool(message.get("data_request") or message.get("free_text") or message.get("recommendation"))


def waiting_status(state: RunState) -> tuple[str, dict[str, Any]]:
    """The status a run with an open conversation has, from its steps, so nothing arriving can lose another."""
    escalation = state.escalation or {}
    base = {"escalation_ref": escalation.get("ref"), "builder": (escalation.get("recipient") or {}).get("name")}
    if request := pending_request(state):
        items = request["data_request"]["items"]
        tier = escalation.get("tier")
        within = [item for item in items if item["category"] in TIERS.get(tier, ())]
        beyond = [item for item in items if item not in within]
        return AWAITING_OPERATOR_APPROVAL, base | {
            "request_id": request["message_id"],
            "text": request.get("text"),
            "tier": tier,
            "requested": items,
            "within_tier": within,
            "needs_approval": beyond,
        }
    if found := pending_recommendation(state):
        recommendation = found["recommendation"]
        return AWAITING_RECOMMENDATION_REVIEW, base | {
            "recommendation_id": found["message_id"],
            "summary": recommendation["summary"],
            "actions": recommendation["actions"],
        }
    return AWAITING_MACHINE_BUILDER, base


class ConversationDesk:
    def __init__(
        self,
        manager: RunManager,
        gateway: GatewayClient,
        escalator: Escalator,
        runs: RunStore,
        incidents: IncidentStore,
        agent: Callable[[RunState], ConversationAgent],
    ) -> None:
        self._m = manager
        self._gateway = gateway
        self._escalator = escalator
        self._runs = runs
        self._incidents = incidents
        self._agent = agent
        self._missing_files: dict[str, int] = {}
        self._unknown_logged: set[str] = set()
        self._reconciled: set[str] = set()

    async def ready(self) -> None:
        await self._m.ready()

    # ── Receiving ────────────────────────────────────────────────────────────

    def _run_of(self, conversation_id: str) -> RunRecord | None:
        return next((r for r in self._m.records() if conversation_of(r.state) == conversation_id), None)

    async def receive(self, message: dict[str, Any]) -> bool:
        """Handles one message. True when it is safely stored and can be acknowledged."""
        message = clean(message)
        message_id, conversation_id = message.get("message_id"), message.get("conversation_id")
        if await self._runs.was_processed(message_id):
            return True
        rec = self._run_of(conversation_id)
        conversation = await self._gateway.conversation(conversation_id)
        state_now = conversation_state(conversation, self._gateway.connection.participant_id)
        step = self._message_step(message, state_now, rec.state.round if rec else 1)
        if rec is None:
            return await self._receive_late(message, step)
        await self._take_files(rec.state.run_id, message, step)
        async with rec.lock:
            current = self._m.is_current(rec)
            if current:
                await self._apply(rec, message, step, conversation)
        if not current:  # archived while this message was in hand
            return await self._receive_late(message, step)
        if _worth_reviewing(step["output"]):
            self._m.spawn(self.review(rec, message_id), f"review {message_id}")
        return True

    async def _receive_late(self, message: dict[str, Any], step: dict[str, Any]) -> bool:
        """A message for a conversation already archived goes on its record, with its files."""
        message_id, conversation_id = message.get("message_id"), message.get("conversation_id")
        run_id = await self._incidents.run_of_conversation(conversation_id)
        if run_id is None:
            if message_id not in self._unknown_logged:
                self._unknown_logged.add(message_id)
                log.warning("A message belongs to no run or incident, and stays unacknowledged: %s", message_id)
            return False
        await self._take_files(run_id, message, step)
        return await self._incidents.add_late_message(conversation_id, step, message_id)

    def _message_step(self, message: dict[str, Any], state_now: str, round_: int) -> dict[str, Any]:
        act = str(message.get("performative") or "inform")
        output: dict[str, Any] = {
            "message_id": message.get("message_id"),
            "sender": "machine_builder",
            "act": act,
            "text": text_of(message),
            "conv_state": state_now,
            "in_reply_to": message.get("in_reply_to"),
            "capability": message.get("capability"),
            "outcome": message.get("outcome"),
        }
        if act == "request" and message.get("capability"):
            capability = message["capability"]
            output["data_request"] = {"items": [{"label": LABELS.get(capability, capability), "category": capability}]}
        elif act == "request":
            output["free_text"] = True
        if act == "inform" and (recommendation := recommendation_of(message)):
            output["recommendation"] = recommendation
        at = message.get("received_at") or message.get("created_at") or self._m.now().isoformat()
        return {"node": "message", "input": None, "output": output, "at": at, "round": round_}

    async def _take_files(self, run_id: str, message: dict[str, Any], step: dict[str, Any]) -> None:
        if not message.get("has_files"):
            return
        message_id = message["message_id"]
        output = step["output"]
        output["files_url"] = f"/api/agent/message-files/{run_id}/{message_id}"
        try:
            content = await self._gateway.download(message_id, MAX_STORED_FILE)
        except Refused as refused:
            if refused.kind != "not_found":
                raise
            self._missing_files[message_id] = self._missing_files.get(message_id, 0) + 1
            if self._missing_files[message_id] < MISSING_FILE_TRIES:
                raise
            output["files_unavailable"] = True
            output.pop("files_url")
            return
        if content is not None:
            await self._runs.save_file(message_id, run_id, content)

    async def _apply(
        self, rec: RunRecord, message: dict[str, Any], step: dict[str, Any], conversation: dict[str, Any]
    ) -> None:
        state = rec.state
        output = step["output"]
        fields: dict[str, Any] = {}
        grown = replace(state, steps=(*state.steps, step))
        closed = output["conv_state"] == "closed"
        if closed and state.status in CONVERSATION:
            outcome = output.get("outcome") or conversation.get("outcome")
            fields = {
                "status": MB_CLOSED,
                "data": {
                    "outcome": outcome,
                    "reason": output["text"],
                    "reopenable": outcome not in NOT_REOPENABLE,
                    "recorded_by": "machine_builder",
                },
            }
        elif output["act"] == "reopen" and not closed and state.status in (MB_CLOSED, STOPPED, COMPLETED):
            status, data = waiting_status(grown)
            fields = {"status": status, "data": data}
        elif not closed and state.status in CONVERSATION:
            status, data = waiting_status(grown)
            if status != state.status or data != state.data:
                fields = {"status": status, "data": data}
        await self._m.change(rec, step=step, processed=message["message_id"], **fields)

    async def read_file(self, message_id: str) -> AsyncIterator[bytes]:
        """A received file bundle, whatever became of the run: stored, or from the gateway if too large to store."""
        await self._m.ready()
        stored = await self._runs.read_file(message_id)
        if stored is not None:

            async def once() -> AsyncIterator[bytes]:
                yield stored

            return once()
        if not await self._runs.was_processed(message_id):
            raise not_found("There are no such files.")
        chunks = self._gateway.iter_download(message_id)
        first = await anext(chunks, b"")  # so that a refusal is an answer, not a broken download

        async def rest() -> AsyncIterator[bytes]:
            yield first
            async for chunk in chunks:
                yield chunk

        return rest()

    # ── Reviews and questions ────────────────────────────────────────────────

    def _turn(self, state: RunState, question: str) -> ConversationInput:
        allowed = {state.machine_id}
        machine_type = None
        for step in state.steps:
            if step["node"] == "observe":
                for entity in step["output"].get("entities") or []:
                    allowed.add(entity["id"] if isinstance(entity, dict) else entity)
                machine_type = step["output"].get("machine_type") or machine_type
        messages = [
            {key: m.get(key) for key in ("sender", "act", "text", "capability", "internal", "conv_state")}
            for m in messages_of(state)
        ]
        escalation = state.escalation or {}
        return ConversationInput(
            machine_id=state.machine_id,
            issue=state.issue,
            question=question,
            messages=messages,
            allowed_entities=sorted(allowed),
            tier=escalation.get("tier"),
            builder=(escalation.get("recipient") or {}).get("name"),
            machine_type=machine_type,
        )

    def _agent_steps(self, state: RunState, reply: Any, reviewed: str | None = None) -> list[dict[str, Any]]:
        output = {
            "message_id": f"agent-{len(state.steps) + 1}",
            "sender": "agent",
            "act": "answer",
            "text": reply.reply,
            "internal": True,
            "conv_state": last_state(state),
            "tools": reply.tools,
        }
        if reviewed:
            output["reviewed_for"] = reviewed
        steps = [self._m.make_step("message", None, output, state.round)]
        if reply.suggestions:
            steps.append(self._m.make_step("suggest", None, {"suggestions": reply.suggestions}, state.round))
        return steps

    async def ask(self, run_id: str, question: str) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        question = question.strip()
        if not question:
            raise invalid("Enter a question.")
        async with rec.lock:
            if rec.state.conversation_id is None:
                raise conflict("The incident agent answers questions about a conversation once the run is escalated.")
            if rec.asking:
                raise conflict("The incident agent is still answering. Try again when it has.")
            rec.asking = True
            state = rec.state
            output = {
                "message_id": f"question-{len(state.steps) + 1}",
                "sender": "operator",
                "act": "question",
                "text": question,
                "internal": True,
                "conv_state": last_state(state),
            }
            await self._m.change(rec, step=self._m.make_step("message", None, output, state.round))
        try:
            reply = await self._agent(rec.state).answer(self._turn(rec.state, question))
        except StepFailed as failure:
            raise unavailable(f"The incident agent can't answer: {failure.reason}") from None
        finally:
            rec.asking = False
        async with rec.lock:
            for step in self._agent_steps(rec.state, reply):
                await self._m.change(rec, step=step)
        return {"reply": reply.reply}

    async def review(self, rec: RunRecord, message_id: str) -> None:
        """Advice on what arrived. A failure leaves the message and status alone."""
        question = (
            "Review the machine builder's latest message for the operator: what it asks for or recommends, whether "
            "it fits the sharing tier and the incident, and what to do next. Prepare a reply if one is called for."
        )
        try:
            reply = await self._agent(rec.state).answer(self._turn(rec.state, question))
        except StepFailed as failure:
            log.warning("Run %s: no review: %s", rec.state.run_id, failure.reason)
            return
        async with rec.lock:
            if not self._m.is_current(rec):
                return  # archived meanwhile
            for step in self._agent_steps(rec.state, reply, reviewed=message_id):
                await self._m.change(rec, step=step)

    def unreviewed(self, state: RunState) -> list[str]:
        done = {m.get("reviewed_for") for m in messages_of(state)}
        return [m["message_id"] for m in messages_of(state) if _worth_reviewing(m) and m["message_id"] not in done]

    # ── Sending ──────────────────────────────────────────────────────────────

    @contextlib.asynccontextmanager
    async def _sending(self, rec: RunRecord, statuses: tuple[str, ...], what: str) -> AsyncIterator[None]:
        async with rec.lock:
            if rec.busy:
                raise conflict("Something is being sent for this run. Try again when that has finished.")
            if rec.state.status not in statuses:
                raise conflict(f"The run is {rec.state.status}; {what} isn't possible now.")
            rec.busy = True
        try:
            yield
        finally:
            rec.busy = False

    @staticmethod
    def _require_escalation(state: RunState) -> None:
        if not state.escalation:
            raise conflict("This run's escalation never finished, so nothing can go to the machine builder from it.")

    def _receiver(self, state: RunState) -> str:
        if state.escalation:
            return state.escalation["recipient"]["id"]
        receiver = (state.attempt or {}).get("receiver")
        if not receiver:
            raise unavailable("The machine builder of this half-finished escalation isn't known.")
        return receiver

    async def _conversation_id(self, rec: RunRecord) -> str:
        """The conversation, asking the gateway if the escalation failed before it was known."""
        if found := conversation_of(rec.state):
            return found
        attempt = rec.state.attempt or {}
        found = await self._escalator.conversation_of(attempt["files_message_id"])
        async with rec.lock:
            await self._m.change(rec, attempt={**attempt, "conversation_id": found})
        return found

    async def _send(self, rec: RunRecord, act: str, text: str, **fields: Any) -> dict[str, Any]:
        """Sends a message and stores it as a step, with its delivery to follow."""
        state = rec.state
        payload = {"text": text} if text else {}
        answer = await self._gateway.send_message(
            self._receiver(state), performative=act, conversation_id=conversation_of(state), payload=payload, **fields
        )
        output = {
            "message_id": answer["message_id"],
            "sender": "operator",
            "act": act,
            "text": text,
            "in_reply_to": fields.get("in_reply_to"),
            "capability": fields.get("capability"),
            "outcome": fields.get("outcome"),
            "conv_state": await self._read_state(state, act),
            "applied": answer.get("applied", True),
        }
        return self._m.make_step("message", None, output, state.round) | {
            "_entry": {"message_id": answer["message_id"], "status": "pending", "kind": "message"}
        }

    async def _read_state(self, state: RunState, act: str) -> str:
        try:
            conversation = await self._gateway.conversation(conversation_of(state))
        except Refused as refused:
            log.info("The conversation's state was not read: %s", refused.message)
            return "closed" if act == "close" else last_state(state)
        return conversation_state(conversation, self._gateway.connection.participant_id)

    async def _store_sent(self, rec: RunRecord, step: dict[str, Any], **fields: Any) -> None:
        entry = step.pop("_entry")
        async with rec.lock:
            grown = replace(rec.state, steps=(*rec.state.steps, step))
            if "status" not in fields and rec.state.status in CONVERSATION:
                status, data = waiting_status(grown)
                fields |= {"status": status, "data": data}
            await self._m.change(rec, step=step, outbox=(*rec.state.outbox, entry), **fields)

    async def send_act(
        self, run_id: str, act: str, text: str, outcome: str | None, in_reply_to: str | None
    ) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        text = text.strip()
        if act == "grant" or act == "deny":
            state = rec.state
            pending = pending_request(state)
            if pending is None or (in_reply_to and pending["message_id"] != in_reply_to):
                raise invalid("Only a request naming a capability can be granted or denied. Answer with inform.")
            await self.decide(run_id, act == "grant", text, in_reply_to)
            return {"status": rec.state.status, "conv_state": last_state(rec.state)}
        if act == "close" or act == "cancel":
            return await self._close(rec, act, text, outcome)
        if act not in PROTOCOL_ACTS:
            raise invalid(
                f"{act} is not an act. Use one of inform, request, grant, deny, escalate, deescalate, close, cancel."
            )
        if act in ("inform", "request") and not text:
            raise invalid("Enter a message.")
        fields: dict[str, Any] = {"reply_expected": True} if act == "request" else {}
        if act == "inform":
            fields["in_reply_to"] = in_reply_to or self._open_free_request(rec.state)
        async with self._sending(rec, CONVERSATION, f"sending {act}"):
            step = await self._send(rec, act, text, **fields)
            await self._store_sent(rec, step)
        return {"status": rec.state.status, "conv_state": last_state(rec.state)}

    @staticmethod
    def _open_free_request(state: RunState) -> str | None:
        replied = {m.get("in_reply_to") for m in messages_of(state)}
        requests = [m for m in messages_of(state) if m.get("free_text") and m["message_id"] not in replied]
        return requests[-1]["message_id"] if requests else None

    async def _close(self, rec: RunRecord, act: str, text: str, outcome: str | None) -> dict[str, str]:
        if act == "close" and outcome not in ("resolved", "not_resolved", "escalated"):
            raise invalid("Choose an outcome for closing the conversation.")
        sent = "withdrawn" if act == "cancel" else OUTCOME_TO_SEND.get(outcome, outcome)
        async with self._sending(rec, CONVERSATION, "closing"):
            step = await self._send(rec, "close", text, outcome=sent)
            step["output"]["conv_state"] = "closed"
            reason = text or f"Conversation closed with outcome: {outcome or sent}"
            data = {
                "by": "operator",
                "reason": reason,
                "outcome": outcome or sent,
                "reopenable": sent not in NOT_REOPENABLE,
            }
            await self._store_sent(rec, step, status=STOPPED, data=await self._as_closed(rec, step, data))
        return {"status": STOPPED, "conv_state": "closed"}

    async def _as_closed(self, rec: RunRecord, step: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
        """A close that came too late changed nothing: the conversation's own outcome is the true one."""
        if step["output"].get("applied") is not False:
            return data
        try:
            outcome = (await self._gateway.conversation(conversation_of(rec.state))).get("outcome")
        except Refused as refused:
            log.info("The outcome of a conversation was not read: %s", refused.message)
            return data
        step["output"]["outcome"] = outcome
        return data | {"outcome": outcome, "reopenable": outcome not in NOT_REOPENABLE}

    # ── Data requests and recommendations ────────────────────────────────────

    async def decide(self, run_id: str, approved: bool, note: str, request_id: str | None = None) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        async with self._sending(rec, (AWAITING_OPERATOR_APPROVAL,), "deciding on a data request"):
            request = pending_request(rec.state)
            if request is None:
                raise conflict("No data request is waiting.")
            if request_id and request["message_id"] != request_id:
                raise conflict("This data request is no longer the one waiting. Look at the current one.")
            if approved:
                self._require_escalation(rec.state)
                await self._grant(rec, request, note)
            else:
                if _granted(rec.state, request["message_id"]):
                    raise conflict("The grant has gone out, so this can't be declined. Approving sends the data.")
                await self._withdraw_approval(rec, request)
                step = await self._send(
                    rec, "deny", note, capability=request["capability"], in_reply_to=request["message_id"]
                )
                await self._store_sent(rec, step)
        return {"status": rec.state.status}

    async def _withdraw_approval(self, rec: RunRecord, request: dict[str, Any]) -> None:
        """A grant that failed left access approved by this backend. The operator declined, so it goes back."""
        left_approved = any(
            step["node"] == "grant_failed"
            and step["output"].get("request_id") == request["message_id"]
            and step["output"].get("policy_approved")
            for step in rec.state.steps
        )
        if left_approved:
            await self._gateway.set_policy(self._receiver(rec.state), request["capability"], "reset")

    async def _grant(self, rec: RunRecord, request: dict[str, Any], note: str) -> None:
        state = rec.state
        capability = request["capability"]
        receiver = self._receiver(state)
        granted = _granted(state, request["message_id"])
        names: list[str] = []
        approved_here = False
        try:
            if not granted:
                access = await self._gateway.access(consumer=receiver)
                before = next((item.get("status") for item in access if item.get("capability") == capability), None)
                await self._gateway.set_policy(receiver, capability, "approve")
                approved_here = before not in ALLOWED_ACCESS
                expires = (datetime.now(UTC) + timedelta(days=GRANT_DAYS)).isoformat()
                step = await self._send(
                    rec,
                    "grant",
                    note,
                    capability=capability,
                    in_reply_to=request["message_id"],
                    authorization={"scope": "conversation", "expires_at": expires, "constraints": {}},
                )
                await self._store_sent(rec, step)
                granted = True
            sharing = Sharing(state.escalation["tier"], (capability,), ())
            # A grant of history holds related entities' signals only if those entities may go to this builder.
            access = await self._gateway.access(consumer=receiver) if capability == HISTORY else []
            with_related = ADJACENTS in apply_policy(state.escalation["tier"], access).allowed
            files = await self._escalator.files(rec.state, sharing, with_related) if capability in LABELS else []
            names = [name for name, _ in files]
            entry = None
            if files:
                answer = await self._gateway.send_files(
                    receiver,
                    files,
                    capability=capability,
                    conversation_id=state.conversation_id,
                    in_reply_to=request["message_id"],
                )
                entry = {"message_id": answer["message_id"], "status": "pending", "kind": "files"}
        except Refused as refused:
            async with rec.lock:
                await self._m.change(
                    rec,
                    step=self._m.make_step(
                        "grant_failed",
                        None,
                        {
                            "error": refused.message,
                            "request_id": request["message_id"],
                            "granted": granted,
                            "policy_approved": approved_here,
                        },
                        state.round,
                    ),
                )
            raise
        output = {
            "request_id": request["message_id"],
            "tier": state.escalation["tier"],
            "recipient": state.escalation["recipient"]["name"],
            "sent": [LABELS.get(capability, capability)],
            "files": names,
            "withheld": [],
            "decision": _decision(capability, files),
            "note": note or None,
        }
        if capability == HISTORY:
            output["signals"] = _signal_count(files)
        async with rec.lock:
            step = self._m.make_step("policy_check", {"approved": True}, output, rec.state.round)
            status, data = waiting_status(replace(rec.state, steps=(*rec.state.steps, step)))
            outbox = (*rec.state.outbox, entry) if entry else rec.state.outbox
            await self._m.change(rec, step=step, status=status, data=data, outbox=outbox)

    async def answer_recommendation(
        self, run_id: str, action: str, message: str, recommendation_id: str | None = None
    ) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        if action not in ("resolved", "still_failing", "escalate"):
            raise invalid("Answer with resolved, still failing or escalate.")
        async with self._sending(rec, (AWAITING_RECOMMENDATION_REVIEW,), "answering the recommendation"):
            self._require_escalation(rec.state)
            found = pending_recommendation(rec.state)
            if found is None:
                raise conflict("No recommendation is waiting.")
            if recommendation_id and found["message_id"] != recommendation_id:
                raise conflict("This recommendation is no longer the one waiting. Look at the current one.")
            marker = self._m.make_step(
                "recommendation_reply", None, {"message_id": found["message_id"], "action": action}, rec.state.round
            )
            recommendation = found["recommendation"]
            if action == "resolved":
                step = await self._send(
                    rec,
                    "close",
                    message or "The recommended actions resolved the issue. Thank you.",
                    outcome="resolved",
                )
                step["output"]["conv_state"] = "closed"
                if step["output"].get("applied") is False:  # closed otherwise meanwhile: nothing was resolved here
                    data = await self._as_closed(rec, step, {"by": "operator", "reason": step["output"]["text"]})
                    async with rec.lock:
                        await self._m.change(rec, step=marker)
                    await self._store_sent(rec, step, status=STOPPED, data=data)
                    return {"status": rec.state.status}
                data = {
                    "root_cause": recommendation["summary"],
                    "recommended_action": "; ".join(recommendation["actions"]),
                    "confidence": None,
                    "incident_logged": True,
                    "resolved_by": rec.state.escalation["recipient"]["name"],
                }
                async with rec.lock:
                    await self._m.change(rec, step=marker)
                await self._store_sent(rec, step, status=COMPLETED, data=data)
            else:
                act = "inform" if action == "still_failing" else "escalate"
                default = (
                    "The issue persists after the recommended actions."
                    if act == "inform"
                    else "We would like to discuss this directly with your service team."
                )
                step = await self._send(rec, act, message or default, in_reply_to=found["message_id"])
                async with rec.lock:
                    await self._m.change(rec, step=marker)
                await self._store_sent(rec, step)
        return {"status": rec.state.status}

    # ── Status, closing and reopening ────────────────────────────────────────

    async def reconcile(self, rec: RunRecord) -> dict[str, Any]:
        """Adds what the gateway says this side sent and the run doesn't hold: a send accepted, and not stored."""
        conversation = clean(await self._gateway.conversation(rec.state.conversation_id))
        await self._add_missing(rec, conversation)
        return conversation

    async def _add_missing(self, rec: RunRecord, conversation: dict[str, Any]) -> bool:
        """False if it couldn't look, as a send in progress can be at the gateway and not yet stored."""
        now = conversation_state(conversation, self._gateway.connection.participant_id)
        async with rec.lock:
            if rec.busy or not self._m.is_current(rec):
                return False
            state = rec.state
            known = {m.get("message_id") for m in messages_of(state)} | {e["message_id"] for e in state.outbox}
            missing = [m for m in sent_rows(conversation) if m.get("message_id") not in known]
            for message in missing:
                output = {
                    "message_id": message.get("message_id"),
                    "sender": "operator",
                    "act": str(message.get("performative") or "inform"),
                    "text": text_of(message),
                    "in_reply_to": message.get("in_reply_to"),
                    "capability": message.get("capability"),
                    "outcome": message.get("outcome"),
                    "conv_state": now,
                }
                at = message.get("created_at") or self._m.now().isoformat()
                step = {"node": "message", "input": None, "output": output, "at": at, "round": state.round}
                entry = {"message_id": output["message_id"], "status": "pending", "kind": "message"}
                await self._m.change(rec, step=step, outbox=(*rec.state.outbox, entry))
            if missing and rec.state.status in CONVERSATION:
                status, data = self._status_after(rec.state, conversation, now, missing)
                await self._m.change(rec, status=status, data=data)
        return True

    def _status_after(
        self, state: RunState, conversation: dict[str, Any], now: str, added: list[dict[str, Any]]
    ) -> tuple[str, dict[str, Any]]:
        """The status once what was missing is in: closed if the conversation is, otherwise from the steps."""
        if now != "closed":
            return waiting_status(state)
        outcome = conversation.get("outcome")
        closes = [m for m in added if m.get("performative") == "close"]
        if closes:
            reason = text_of(closes[-1]) or "Closed by the operator."
            data = {"by": "operator", "reason": reason, "outcome": outcome, "reopenable": outcome not in NOT_REOPENABLE}
            return STOPPED, data
        return MB_CLOSED, {
            "outcome": outcome,
            "reason": "The machine builder closed the conversation.",
            "reopenable": outcome not in NOT_REOPENABLE,
            "recorded_by": "machine_builder",
        }

    async def on_start(self) -> None:
        """Once per run after a start: what a restart may have left."""
        for rec in self._m.records():
            state = rec.state
            if not state.conversation_id or state.run_id in self._reconciled:
                continue
            with contextlib.suppress(Refused):
                conversation = clean(await self._gateway.conversation(state.conversation_id))
                if not await self._add_missing(rec, conversation):
                    continue
                self._reconciled.add(state.run_id)
                for message_id in self.unreviewed(rec.state):
                    self._m.spawn(self.review(rec, message_id), f"review {message_id}")

    async def refresh(self, run_id: str) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        if not rec.state.conversation_id:
            return {"status": rec.state.status}
        conversation = await self.reconcile(rec)
        if str(conversation.get("state", "")).startswith("CLOSED") and rec.state.status in CONVERSATION:
            outcome = conversation.get("outcome")
            data = {
                "outcome": outcome,
                "reason": "The machine builder closed the conversation.",
                "reopenable": outcome not in NOT_REOPENABLE,
                "recorded_by": "machine_builder",
            }
            async with rec.lock:
                await self._m.change(rec, status=MB_CLOSED, data=data)
        return {"status": rec.state.status}

    async def record_close(self, run_id: str, outcome: str, reason: str) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        reason = reason.strip()
        if outcome not in ("resolved", "not_resolved", "escalated", "withdrawn", "rejected", "failed", "superseded"):
            raise invalid("Choose the outcome the machine builder closed with.")
        if not reason:
            raise invalid("Enter the reason the machine builder gave.")
        async with self._sending(rec, CONVERSATION, "recording a close"):
            output = {
                "message_id": f"recorded-{len(rec.state.steps) + 1}",
                "sender": "operator",
                "act": "close",
                "text": f"Close recorded by the operator: {reason}",
                "outcome": outcome,
                "recorded_by_operator": True,
                "internal": True,
                "conv_state": "closed",
            }
            data = {
                "outcome": outcome,
                "reason": reason,
                "reopenable": outcome not in NOT_REOPENABLE,
                "recorded_by": "operator",
            }
            async with rec.lock:
                await self._m.change(
                    rec, step=self._m.make_step("message", None, output, rec.state.round), status=MB_CLOSED, data=data
                )
        return {"status": MB_CLOSED}

    async def stop(self, rec: RunRecord, reason: str | None) -> dict[str, str]:
        """Stops a run with an open conversation, telling the machine builder.

        Also one whose escalation is half finished: the machine builder has its files, so it is told too.
        """
        unfinished = rec.state.conversation_id is None
        stop_round = {"after_save": lambda: self._m.cancel(rec)} if unfinished else {}
        async with self._sending(rec, OPEN if unfinished else CONVERSATION, "stopping"):
            data = {
                "by": "operator",
                "reason": reason or "Stopped by the operator",
                "outcome": "withdrawn",
                "reopenable": not unfinished,
            }
            try:
                await self._conversation_id(rec)
                step = await self._send(rec, "close", reason or "", outcome="withdrawn")
            except Refused as refused:
                data |= await self._close_problem(rec, refused)
                async with rec.lock:
                    await self._m.change(
                        rec, status=STOPPED, data=data, conversation_id=conversation_of(rec.state), **stop_round
                    )
                return {"status": STOPPED}
            step["output"]["conv_state"] = "closed"
            data = await self._as_closed(rec, step, data)
            conversation_id = conversation_of(rec.state)
            await self._store_sent(rec, step, status=STOPPED, data=data, conversation_id=conversation_id, **stop_round)
        return {"status": STOPPED}

    async def _close_problem(self, rec: RunRecord, refused: Refused) -> dict[str, Any]:
        """What a refused close leaves to do. Only a conversation that has closed needs nothing more."""
        found = conversation_of(rec.state)
        if refused.kind == "conflict" and found:
            try:
                conversation = await self._gateway.conversation(found)
            except Refused as problem:
                log.info("The conversation's state was not read: %s", problem.message)
            else:
                if str(conversation.get("state", "")).startswith("CLOSED"):
                    log.info("Run %s: the conversation had closed already: %s", rec.state.run_id, refused.message)
                    return {}
        return {"close_pending": True, "close_problem": refused.message}

    async def retry_closes(self) -> None:
        """A close that couldn't be sent or delivered. Repeating one is safe under the protocol."""
        for rec in self._m.records():
            if not rec.state.data.get("close_pending") or rec.busy or not self._m.close_is_due(rec.state.data):
                continue
            try:
                async with self._sending(rec, (STOPPED,), "repeating a close"):
                    await self._repeat_close(rec)
            except Refused as refused:
                log.info("Run %s: the close waits: %s", rec.state.run_id, refused.message)

    async def _repeat_close(self, rec: RunRecord) -> None:
        conversation = await self._gateway.conversation(await self._conversation_id(rec))
        me = self._gateway.connection.participant_id
        if conversation_state(conversation, me) == "direct_contact_machine_builder":
            return  # only the machine builder can end that, and each refused try would stay listed at the gateway
        done = {
            k: v for k, v in rec.state.data.items() if k not in ("close_pending", "close_problem", "close_retry_at")
        }
        outcome = OUTCOME_TO_SEND.get(done.get("outcome"), done.get("outcome")) or "withdrawn"
        try:
            step = await self._send(rec, "close", done.get("reason") or "", outcome=outcome)
        except Refused as refused:
            problem = await self._close_problem(rec, refused)
            if problem:
                problem |= self._m.close_backoff(rec.state.data)
            async with rec.lock:
                await self._m.change(rec, data=done | problem, conversation_id=conversation_of(rec.state))
            return
        step["output"]["conv_state"] = "closed"
        # A repeat only if this side's close is the latest: after a reopen, this is a new close.
        latest = next((m for m in reversed(messages_of(rec.state)) if m.get("act") in ("close", "reopen")), {})
        repeated = latest.get("act") == "close" and latest.get("sender") == "operator"
        if not repeated:
            await self._store_sent(rec, step, data=done, conversation_id=conversation_of(rec.state))
            return
        # One close in the conversation, however often it had to go: the earlier sends stay known, out of sight.
        entry = step.pop("_entry") | {"close": True}
        closes = {m.get("message_id") for m in messages_of(rec.state) if m.get("act") == "close"}
        outbox = tuple(
            {**e, "superseded": True}
            if e["status"] == "failed" and (e.get("close") or e["message_id"] in closes)
            else e
            for e in rec.state.outbox
        )
        async with rec.lock:
            await self._m.change(rec, data=done, outbox=(*outbox, entry))

    async def reopen(self, run_id: str) -> dict[str, str]:
        await self._m.ready()
        rec = self._m.record(run_id)
        state = rec.state
        if not state.conversation_id:
            raise conflict("Only runs with a machine-builder conversation can be reopened.")
        if state.data.get("reopenable") is False or state.status not in (STOPPED, MB_CLOSED):
            raise conflict("This run was closed for good and cannot be reopened.")
        async with self._sending(rec, (STOPPED, MB_CLOSED), "reopening"):
            step = await self._send(rec, "reopen", "")
            step["output"]["conv_state"] = "open"
            status, data = waiting_status(replace(rec.state, steps=(*rec.state.steps, step)))
            await self._store_sent(rec, step, status=status, data=data)
        return {"status": rec.state.status}

    async def reopen_incident(self, incident: dict[str, Any]) -> RunState:
        """A new run that goes on with an archived incident's conversation."""
        conversation_id = incident["conversation_id"]
        conversation = await self._gateway.conversation(conversation_id)
        if conversation.get("outcome") in NOT_REOPENABLE:
            raise conflict(f"This conversation was closed as {conversation['outcome']} and cannot be reopened.")
        escalation = incident["escalation"]
        # All that was sent before stays known, so that it isn't taken for a send that wasn't stored.
        outbox = tuple(
            {
                "message_id": m["message_id"],
                "status": DELIVERY.get(m.get("status"), "pending"),
                "kind": "files" if m.get("has_files") else "message",
            }
            for m in sent_rows(conversation)
        )
        if str(conversation.get("state", "")).startswith("CLOSED"):
            await self._gateway.send_message(
                escalation["recipient"]["id"], performative="reopen", conversation_id=conversation_id, payload={}
            )
        now = self._m.now()
        steps = tuple(incident["trace"])
        state = RunState(
            run_id=self._m.new_run_id(),
            machine_id=incident["machine_id"],
            issue=incident["issue"],
            status=AWAITING_MACHINE_BUILDER,
            started_at=now,
            updated_at=now,
            steps=steps,
            escalation=escalation,
            conversation_id=conversation_id,
            outbox=outbox,
        )
        status, data = waiting_status(state)
        return replace(state, status=status, data=data)
