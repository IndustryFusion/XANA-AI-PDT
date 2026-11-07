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
"""What webhooks receive, as events, and the worker that turns them into runs."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, replace
from typing import Any

from app.errors import Refused, invalid, unavailable
from app.runs.conversation import clean
from app.runs.machines import MachineResolver
from app.runs.manager import MAX_ISSUE, RunManager
from app.runs.model import ALERT, NGSI

log = logging.getLogger(__name__)

QUEUE_LIMIT = 1000
RETRY_S = 5.0
HELD_CHECK_S = 5.0
MAX_MACHINE_ID = 500
MAX_VALUE = 200
# The issue of a notification that holds none of the watched values.
NO_VALUES = "state change detected"
# What Alerta reports without there being anything to diagnose.
QUIET_SEVERITIES = {"ok", "normal", "up", "cleared", "informational", "debug", "trace"}
QUIET_STATUSES = {"closed", "expired", "shelved", "blackout"}
_NOT_THE_VALUE = ("type", "observedAt", "datasetId", "createdAt", "modifiedAt", "unitCode", "instanceId")
_VALUE_KEYS = ("value", "hasValue", "object", "hasObject", "vocab", "hasVocab", "json", "hasJSON", "@value", "@id")


@dataclass(frozen=True)
class Event:
    machine_id: str
    issue: str
    source: str


def _local_name(name: str) -> str:
    """The last part of a full IRI, or the name as it is."""
    return name.rstrip("/#").rsplit("#", 1)[-1].rsplit("/", 1)[-1]


def _attribute_value(attribute: Any) -> Any:
    """What an attribute holds, in the forms a broker sends. Several instances give a list."""
    if isinstance(attribute, list):
        values = [_attribute_value(item) for item in attribute]
        return values[0] if len(values) == 1 else values
    if isinstance(attribute, dict):
        members = {_local_name(key): value for key, value in attribute.items()}
        for key in _VALUE_KEYS:
            if key in members:
                return _attribute_value(members[key])
        return {key: value for key, value in members.items() if key not in _NOT_THE_VALUE} or None
    return attribute


def _watched_values(entity: dict[str, Any], watched: list[str]) -> dict[str, Any]:
    names = [_local_name(name) for name in watched]
    found = {}
    for name, attribute in entity.items():
        local = _local_name(name)
        if local in names:
            value = clean(_attribute_value(attribute))
            if value not in (None, ""):
                found[local] = value
    return {name: found[name] for name in names if name in found}


def _machine(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = clean(value).strip()
    return value if value and len(value) <= MAX_MACHINE_ID else None


def ngsi_events(body: Any, watched: list[str]) -> tuple[list[Event], int]:
    """The events in a notification, and how many of its entities gave none."""
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        raise invalid("A notification has a `data` list.")
    events, ignored = [], 0
    for entity in data:
        machine = _machine(entity.get("id")) if isinstance(entity, dict) else None
        if machine is None:
            ignored += 1
            continue
        values = _watched_values(entity, watched)
        shown = ", ".join(f"{name}={str(value)[:MAX_VALUE]}" for name, value in values.items()) or NO_VALUES
        events.append(Event(machine, clean(f"Machine event: {shown}")[:MAX_ISSUE], NGSI))
    return events, ignored


def alert_event(body: Any) -> Event | None:
    """The event of an Alerta alert or `{machine_id, issue}`. None for an alert with nothing to diagnose."""
    if not isinstance(body, dict):
        raise invalid("An alert is a JSON object.")
    if "machine_id" in body:
        machine, issue = _machine(body.get("machine_id")), body.get("issue")
        issue = clean(issue).strip() if isinstance(issue, str) else ""
        if machine is None or not issue:
            raise invalid("Name the machine and the issue.")
        return Event(machine, issue[:MAX_ISSUE], ALERT)
    machine = _machine(body.get("resource"))
    if machine is None:
        raise invalid("An alert names its machine in `resource`.")
    if body.get("repeat") or body.get("severity") in QUIET_SEVERITIES or body.get("status") in QUIET_STATUSES:
        return None
    what = str(body.get("event") or "unnamed")
    text = str(body.get("text") or "")
    return Event(machine, clean(f"Alert {what}: {text}".rstrip(": "))[:MAX_ISSUE], ALERT)


class EventWorker:
    """One worker, one event at a time, so that the check for a run in progress can't race with itself.

    The queue is in memory: what it holds when the backend stops is lost. See the change's design.
    So is what it holds back: the latest event per machine and source while a triggered run has just failed, started
    when that wait ends.
    """

    def __init__(
        self,
        runs: RunManager,
        machines: MachineResolver,
        limit: int = QUEUE_LIMIT,
        retry_s: float = RETRY_S,
    ) -> None:
        self._runs = runs
        self._machines = machines
        self._queue: asyncio.Queue[Event] = asyncio.Queue(limit)
        self._retry_s = retry_s
        self._held: dict[tuple[str, str], Event] = {}
        self._task: asyncio.Task[None] | None = None

    def add(self, events: list[Event]) -> None:
        """Queues all of them or none, so that a sender told to try again repeats nothing."""
        limit = self._queue.maxsize
        if self._queue.qsize() + len(events) > limit:
            log.warning("Machine events: the queue is full, %d events refused.", len(events))
            raise unavailable("The event queue is full. Try again later.")
        for event in events:
            self._queue.put_nowait(event)

    def backlog(self) -> int:
        return self._queue.qsize()

    async def settled(self) -> None:
        """Until everything queued so far, and what has waited long enough, has been handled."""
        self._release_held()
        await self._queue.join()

    def _release_held(self) -> None:
        """Back in line, to be handled like any event. If the queue is full, it waits for the next look."""
        for key, event in list(self._held.items()):
            if not self._runs.failed_lately(event.machine_id) and not self._queue.full():
                del self._held[key]
                self._queue.put_nowait(event)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="machine events")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _run(self) -> None:
        while True:
            self._release_held()
            try:
                event = await asyncio.wait_for(self._queue.get(), HELD_CHECK_S)
            except TimeoutError:
                continue
            try:
                await self._handle(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Machine events: an event for %s could not be handled.", event.machine_id)
            finally:
                self._queue.task_done()

    async def _handle(self, event: Event) -> None:
        try:
            machine = await self._machines.resolve(event.machine_id)
        except Refused as refused:
            log.warning("Machine events: event dropped: %s", refused.message)
            return
        while True:
            try:
                await self._runs.ready()
                if self._runs.failed_lately(machine):
                    self._held[(machine, event.source)] = replace(event, machine_id=machine)
                    log.info("Machine events: %s for %s waits, as a run of it has just failed.", event.source, machine)
                    return
                run_id = await self._runs.start_triggered(machine, event.issue, event.source)
            except Refused as refused:
                if refused.kind != "unavailable":
                    log.warning("Machine events: event for %s dropped: %s", machine, refused.message)
                    return
                log.info("Machine events: waiting to handle an event for %s: %s", machine, refused.message)
                await asyncio.sleep(self._retry_s)
                continue
            log.info(
                "Machine events: %s for %s: %s", event.source, machine, f"run {run_id}" if run_id else "no new run"
            )
            return
