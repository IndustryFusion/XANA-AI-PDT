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
"""Runs the diagnostic workflow for operators.

Each run is a `RunRecord`: its stored state, a lock that every change takes, the
task of the round in progress and the watchers of its stream. Every change is
written to the memory database before watchers hear of it, so nothing a watcher
saw is missing after a restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, Literal

from app.errors import Refused, conflict, invalid, not_found, unavailable
from app.memory.migrate import MigrationError, Migrator
from app.memory.store import IncidentStore, RunStore, StoreUnavailable
from app.runs.files import Attachment, check_files
from app.runs.machines import MachineResolver
from app.runs.model import ALLOWED, FAILED, RUNNING, STOPPED, RunState, outcome_state
from app.runs.stream import GOING_AWAY, QUEUE_LIMIT, UNKNOWN_RUN, Subscriber
from xana_agent import Outcome, Rejection, RoundInput, StepEvent, Workflow
from xana_agent.sources.base import IncidentMemory

log = logging.getLogger(__name__)

MAX_ISSUE = 2000
MAX_TEXT = 4000
SHARING_TIER = "minimal"
NO_ESCALATION = "Escalation to the machine builder is not available in this version."
NOT_REOPENABLE = "Only runs with a machine-builder conversation can be reopened, and this version has none."

Work = Literal["analyse", "act"]
WorkflowFactory = Callable[[IncidentMemory], Workflow]


class RunRecord:
    def __init__(self, state: RunState) -> None:
        self.state = state
        self.lock = asyncio.Lock()
        self.task: asyncio.Task[None] | None = None
        self.subscribers: set[Subscriber] = set()


class RunManager:
    def __init__(
        self,
        store: RunStore,
        incidents: IncidentStore,
        workflow: WorkflowFactory,
        machines: MachineResolver,
        migrator: Migrator,
        max_concurrent_rounds: int = 2,
        queue_limit: int = QUEUE_LIMIT,
        clock: Callable[[], datetime] | None = None,
        model_problem: Callable[[], Awaitable[str | None]] | None = None,
    ) -> None:
        self._store = store
        self._incidents = incidents
        self._workflow = workflow
        self._model_problem = model_problem
        self._machines = machines
        self._migrator = migrator
        self._slots = asyncio.Semaphore(max_concurrent_rounds)
        self.queue_limit = queue_limit
        self._now = clock or (lambda: datetime.now(UTC))
        self._runs: dict[str, RunRecord] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._ready = False
        self._ready_lock = asyncio.Lock()
        self._reopen_lock = asyncio.Lock()

    # ── Startup and shutdown ─────────────────────────────────────────────────

    async def start_up(self) -> None:
        """Restores stored runs if the memory database is reachable; otherwise the first request retries."""
        try:
            await self.ready()
        except Refused as refused:
            log.warning("Runs not restored yet: %s", refused.message)

    async def shut_down(self) -> None:
        """Cancels rounds in progress without changing their stored state; they run again after a restart."""
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for rec in self._runs.values():
            for sub in rec.subscribers:
                sub.close(GOING_AWAY)
            rec.subscribers.clear()

    async def ready(self) -> None:
        """Applies migrations and restores the stored runs, once."""
        if self._ready:
            return
        async with self._ready_lock:
            if self._ready:
                return
            try:
                await self._migrator.apply()
                restored = [await self._restore(state) for state in await self._store.load()]
            except MigrationError as error:
                raise unavailable(f"Runs cannot be stored: {error}") from None
            except Exception as error:
                log.warning("Memory database not usable for runs: %s", type(error).__name__)
                raise unavailable("The memory database is not reachable, so runs cannot be stored.") from None
            for rec, work in restored:
                self._runs[rec.state.run_id] = rec
                if work:
                    self._launch(rec, work)
            self._ready = True
            if restored:
                log.info("Restored %d runs", len(restored))

    async def _restore(self, state: RunState) -> tuple[RunRecord, Work | None]:
        if state.status != RUNNING:
            return RunRecord(state), None
        steps, work = state.restart_point()
        if steps != state.steps:
            state = await self._store.save(replace(state, steps=steps, updated_at=self._now()))
        return RunRecord(state), work

    # ── Reading ──────────────────────────────────────────────────────────────

    async def list(self) -> list[dict[str, Any]]:
        await self.ready()
        runs = sorted(self._runs.values(), key=lambda r: r.state.started_at, reverse=True)
        return [r.state.summary() for r in runs]

    async def get(self, run_id: str) -> dict[str, Any]:
        await self.ready()
        return self._record(run_id).state.view()

    async def subscribe(self, run_id: str) -> tuple[dict[str, Any], Subscriber]:
        """The run's current state and a subscriber that receives every later event.

        Both are taken under the run's lock, so no event falls between them.
        """
        await self.ready()
        rec = self._record(run_id)
        async with rec.lock:
            sub = Subscriber(self.queue_limit)
            rec.subscribers.add(sub)
            return rec.state.view(), sub

    def unsubscribe(self, run_id: str, sub: Subscriber) -> None:
        rec = self._runs.get(run_id)
        if rec:
            rec.subscribers.discard(sub)

    def _record(self, run_id: str) -> RunRecord:
        rec = self._runs.get(run_id)
        if rec is None:
            raise not_found(f"Run {run_id} does not exist or was archived.")
        return rec

    # ── Operations ───────────────────────────────────────────────────────────

    async def start(self, machine_id: str, issue: str) -> str:
        machine_id, issue = machine_id.strip(), issue.strip()
        if not machine_id:
            raise invalid("Enter the machine.")
        if not issue:
            raise invalid("Describe the issue.")
        if len(issue) > MAX_ISSUE:
            raise invalid(f"The issue is longer than {MAX_ISSUE} characters.")
        await self.ready()
        await self._require_model()
        return await self._create(await self._machines.resolve(machine_id), issue)

    async def _create(self, machine_id: str, issue: str) -> str:
        now = self._now()
        state = RunState(str(uuid.uuid4()), machine_id, issue, RUNNING, started_at=now, updated_at=now)
        try:
            state = await self._store.save(state)
        except StoreUnavailable as error:
            raise unavailable(f"{error} The run was not started.") from None
        rec = RunRecord(state)
        self._runs[state.run_id] = rec
        self._launch(rec, "analyse")
        return state.run_id

    async def clarify(self, run_id: str, text: str, files: list[Attachment]) -> dict[str, str]:
        await self.ready()
        rec = self._record(run_id)
        async with rec.lock:
            self._require(rec, "clarify")
            text, kept = _operator_text(text), check_files(files)
            if not text and not kept:
                raise invalid("Enter a clarification or attach a file.")
            await self._require_model()
            s = rec.state
            step = self._step(
                "clarification", {"question": s.data.get("question")}, {"text": text, "files": kept}, s.round
            )
            await self._change(
                rec,
                step=step,
                status=RUNNING,
                data={},
                round=s.round + 1,
                clarifications=s.clarifications + ((text,) if text else ()),
            )
            self._launch(rec, "analyse")
            return {"status": RUNNING}

    async def confirm(self, run_id: str, confirmed: bool, text: str, files: list[Attachment]) -> dict[str, str]:
        await self.ready()
        rec = self._record(run_id)
        async with rec.lock:
            self._require(rec, "confirm")
            text, kept = _operator_text(text), check_files(files)
            s = rec.state
            proposal = {k: s.data.get(k) for k in ("root_cause", "recommended_action", "confidence")}
            if confirmed:
                output = {"confirmed": True, "root_cause": proposal["root_cause"]}
                output |= {"recommended_action": proposal["recommended_action"], "text": text, "files": kept}
                await self._change(
                    rec, step=self._step("resolution", proposal, output, s.round), status=RUNNING, data={}
                )
                self._launch(rec, "act")
                return {"status": RUNNING}
            if not text:
                raise invalid("Give a reason for rejecting the resolution.")
            await self._require_model()
            rejection = {
                "root_cause": proposal["root_cause"],
                "recommended_action": proposal["recommended_action"],
                "reason": text,
                "at": self._now().isoformat(),
            }
            output = {"confirmed": False, "root_cause": proposal["root_cause"], "reason": text, "files": kept}
            await self._change(
                rec,
                step=self._step("resolution", proposal, output, s.round),
                status=RUNNING,
                data={},
                round=s.round + 1,
                rejected=s.rejected + (rejection,),
            )
            self._launch(rec, "analyse")
            return {"status": RUNNING}

    async def stop(self, run_id: str, reason: str | None) -> dict[str, str]:
        await self.ready()
        rec = self._record(run_id)
        async with rec.lock:
            self._require(rec, "stop")
            data = {"by": "operator", "reason": _operator_text(reason or "") or None, "reopenable": False}
            await self._change(rec, status=STOPPED, data=data, after_save=lambda: self._cancel(rec))
            return {"status": STOPPED}

    async def archive(self, run_id: str) -> None:
        await self.ready()
        rec = self._record(run_id)
        async with rec.lock:
            self._require(rec, "archive")
            try:
                await self._incidents.archive(rec.state, self._now())
            except StoreUnavailable as error:
                raise unavailable(f"{error} The run was not archived.") from None
            del self._runs[run_id]
            for sub in rec.subscribers:
                sub.close(UNKNOWN_RUN, {"kind": "not_found", "message": f"Run {run_id} was archived."})
            rec.subscribers.clear()

    async def escalation_preflight(self, run_id: str) -> dict[str, Any]:
        await self.ready()
        self._record(run_id)
        return {"possible": False, "reason": NO_ESCALATION, "recipient": None, "data": [], "sharing_tier": SHARING_TIER}

    async def reopen(self, run_id: str) -> None:
        await self.ready()
        self._record(run_id)
        raise conflict(NOT_REOPENABLE)

    async def reopen_incident(self, incident_id: int) -> str:
        await self.ready()
        await self._require_model()
        async with self._reopen_lock:
            try:
                incident = await self._incidents.get(incident_id)
            except StoreUnavailable as error:
                raise unavailable(str(error)) from None
            if incident is None:
                raise not_found(f"Incident {incident_id} does not exist.")
            reopened = incident["reopened_run_id"]
            if reopened and reopened in self._runs:
                raise conflict(f"Incident {incident['number']} is already open again as run {reopened}.")
            run_id = await self._create(incident["machine_id"], incident["issue"])
            try:
                await self._incidents.set_reopened(incident_id, run_id)
            except StoreUnavailable:
                log.warning("Incident %s reopened as %s, but the link was not stored", incident_id, run_id)
            return run_id

    def _require(self, rec: RunRecord, operation: str) -> None:
        if rec.state.status not in ALLOWED[operation]:
            allowed = " or ".join(ALLOWED[operation])
            raise conflict(f"The run is {rec.state.status}; {_NAMES[operation]} is possible only when it is {allowed}.")

    # ── Rounds ───────────────────────────────────────────────────────────────

    def _launch(self, rec: RunRecord, work: Work) -> None:
        task = asyncio.create_task(self._round(rec, work), name=f"run {rec.state.run_id} {work}")
        rec.task = task
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _cancel(self, rec: RunRecord) -> None:
        if rec.task is not None:
            rec.task.cancel()
            rec.task = None

    async def _require_model(self) -> None:
        if self._model_problem is not None and (problem := await self._model_problem()):
            raise unavailable(problem)

    async def _round(self, rec: RunRecord, work: Work) -> None:
        task = asyncio.current_task()
        try:
            async with self._slots:
                state = rec.state
                workflow = self._workflow(self._incidents.memory_for(state))
                round_input = RoundInput(
                    machine_id=state.machine_id,
                    issue=state.issue,
                    round=state.round,
                    clarifications=list(state.clarifications),
                    rejected=[Rejection(root_cause=r["root_cause"], reason=r["reason"]) for r in state.rejected],
                )
                if work == "act":
                    events = workflow.act(round_input, state.last_decision() or {}, list(state.steps))
                else:
                    events = workflow.analyse(
                        round_input,
                        {
                            "langfuse_session_id": state.run_id,
                            "run_id": state.run_id,
                            "machine_id": state.machine_id,
                            "round": state.round,
                        },
                    )
                async with contextlib.aclosing(events):
                    async for event in events:
                        async with rec.lock:
                            if rec.task is not task:
                                return  # stopped meanwhile: the step is discarded
                            if isinstance(event, StepEvent):
                                await self._change(rec, step=event.as_dict() | {"round": state.round})
                            else:
                                await self._finish(rec, event)
        except asyncio.CancelledError:
            raise
        except Refused as refused:
            await self._fail(rec, task, refused.message)
        except Exception:
            log.exception("Run %s: round failed", rec.state.run_id)
            await self._fail(rec, task, "The round ended unexpectedly.")

    async def _finish(self, rec: RunRecord, outcome: Outcome) -> None:
        status, data = outcome_state(outcome, rec.state.rejected)
        await self._change(rec, status=status, data=data)
        rec.task = None

    async def _fail(self, rec: RunRecord, task: asyncio.Task[None] | None, error: str) -> None:
        async with rec.lock:
            if rec.task is not task:
                return
            rec.task = None
            data = {"error": error, "node": None}
            try:
                await self._change(rec, status=FAILED, data=data)
            except Refused:
                # Not stored: after a restart the round runs again from its stored state.
                rec.state = replace(rec.state, status=FAILED, data=data, updated_at=self._now())
                self._publish_status(rec)

    # ── Changes ──────────────────────────────────────────────────────────────

    def _step(self, node: str, step_input: dict[str, Any], output: dict[str, Any], round_: int) -> dict[str, Any]:
        return {"node": node, "input": step_input, "output": output, "at": self._now().isoformat(), "round": round_}

    async def _change(
        self,
        rec: RunRecord,
        step: dict[str, Any] | None = None,
        after_save: Callable[[], None] | None = None,
        **fields: Any,
    ) -> None:
        """Stores the change, then tells the watchers: the step first, then the status."""
        steps = rec.state.steps + ((step,) if step else ())
        try:
            rec.state = await self._store.save(replace(rec.state, steps=steps, updated_at=self._now(), **fields))
        except StoreUnavailable as error:
            raise unavailable(f"{error} The change was not saved.") from None
        if after_save:
            after_save()
        if step:
            self._publish(rec, {"type": "step", **step})
        if "status" in fields:
            self._publish_status(rec)

    def _publish_status(self, rec: RunRecord) -> None:
        s = rec.state
        self._publish(rec, {"type": "status", "status": s.status, "data": s.data, "summary": s.summary()})

    @staticmethod
    def _publish(rec: RunRecord, event: dict[str, Any]) -> None:
        for sub in list(rec.subscribers):
            if not sub.push(event):
                rec.subscribers.discard(sub)


_NAMES = {
    "clarify": "a clarification",
    "confirm": "confirming or rejecting",
    "stop": "stopping",
    "archive": "archiving",
}


def _operator_text(text: str) -> str:
    text = text.strip()
    if len(text) > MAX_TEXT:
        raise invalid(f"The text is longer than {MAX_TEXT} characters.")
    return text
