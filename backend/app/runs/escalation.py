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
"""Sending an incident to the machine builder: the plan, the data and the two sends.

The run manager decides when, and holds the state. See the `gh-28-escalate-to-builder` design.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from app.dataspace.gateway import GatewayClient
from app.dataspace.sharing import ADJACENTS, DIRECT, FILES, HISTORY, Sharing, apply_policy
from app.errors import Refused, unavailable
from app.ifric import Builder, NoBuilder, RegistryClient
from app.runs.model import ESCALATABLE, RunState
from xana_agent.sources.base import AlertSource, ContextSource, HistorySource, SourceUnavailable

log = logging.getLogger(__name__)

MAX_RELATED = 20
HISTORY_WINDOW = timedelta(hours=24)
BUCKET = timedelta(hours=1)
FINAL_STATUSES = ("notified", "error", "rejected")
DELIVERY = {"notified": "delivered", "error": "failed", "rejected": "failed"}


class NotPossible(Exception):
    """Escalation isn't possible now. The message is the reason, safe to show."""


@dataclass(frozen=True)
class Plan:
    builder: Builder
    sharing: Sharing

    def recipient(self) -> dict[str, str]:
        return {"id": self.builder.company_id, "name": self.builder.name}


class Escalator:
    def __init__(
        self,
        gateway: GatewayClient,
        registry: RegistryClient,
        context: ContextSource,
        history: HistorySource,
        alerts: AlertSource | None,
        tier: str,
        configured: Callable[[], bool],
    ) -> None:
        self.gateway = self._gateway = gateway
        self._registry = registry
        self._context = context
        self._history = history
        self._alerts = alerts
        self.tier = tier
        self._configured = configured

    # ── Plan ─────────────────────────────────────────────────────────────────

    def _require_state(self, run: RunState) -> None:
        if run.escalation:
            raise NotPossible("This run has already been escalated.")
        if run.status not in ESCALATABLE:
            raise NotPossible(
                f"The run is {run.status}. Escalation is possible while it waits for input or for a confirmation."
            )

    def _require_connection(self) -> None:
        connection = self._gateway.connection
        if not self._configured():
            raise NotPossible("No dataspace is configured for this installation.")
        if connection.token():
            return
        if connection.has_expired():
            raise NotPossible("The dataspace session has expired. Connect again in the Dataspace area.")
        raise NotPossible("The dataspace is not connected. Connect in the Dataspace area and try again.")

    async def plan(self, run: RunState) -> Plan:
        """Who gets what. Sends nothing. `NotPossible` holds the reason."""
        self._require_state(run)
        self._require_connection()
        if not self._registry.configured:
            raise NotPossible("No IFRIC registry is configured, so the machine's builder can't be found.")
        try:
            builder = await self._registry.builder(run.machine_id)
        except NoBuilder as reason:
            raise NotPossible(str(reason)) from None
        try:
            peers = await self._gateway.compatible()
        except Refused as refused:
            raise NotPossible(f"The compatible participants can't be read: {refused.message}") from None
        if builder.company_id not in {peer["participant_id"] for peer in peers}:
            raise NotPossible(
                f"The machine's builder, {builder.name}, is not a compatible participant in the dataspace."
            )
        try:
            access = await self._gateway.access(consumer=builder.company_id)
        except Refused as refused:
            raise NotPossible(f"What the builder may access can't be read: {refused.message}") from None
        sharing = apply_policy(self.tier, access)
        if DIRECT not in sharing.allowed:
            raise NotPossible(
                f"{builder.name} may not have the machine's own data (twin:direct), so nothing could be sent."
            )
        return Plan(builder, sharing)

    async def preflight(self, run: RunState) -> dict[str, Any]:
        try:
            plan = await self.plan(run)
        except NotPossible as reason:
            return {
                "possible": False,
                "reason": str(reason),
                "recipient": None,
                "data": [],
                "withheld": [],
                "sharing_tier": self.tier,
            }
        return {
            "possible": True,
            "reason": None,
            "recipient": plan.recipient(),
            "data": plan.sharing.data(),
            "withheld": list(plan.sharing.withheld),
            "sharing_tier": self.tier,
        }

    # ── The data ─────────────────────────────────────────────────────────────

    async def files(
        self, run: RunState, sharing: Sharing, related_signals: bool | None = None
    ) -> list[tuple[str, bytes]]:
        """The files of what is allowed, read anew. A source failing raises a refusal: nothing goes out partly.

        History holds related entities' signals if those entities may go too, in this sending by default,
        or as `related_signals` says.
        """
        if related_signals is None:
            related_signals = ADJACENTS in sharing.allowed
        try:
            entity = await self._context.get(run.machine_id)
            if entity is None:
                raise unavailable(f"The machine {run.machine_id} can't be read from the context broker.")
            contents: dict[str, Any] = {
                DIRECT: {"entity": entity, "active_alerts": await self._active_alerts(run.machine_id)}
            }
            if ADJACENTS in sharing.allowed:
                contents[ADJACENTS] = await self._related(entity)
            if HISTORY in sharing.allowed:
                contents[HISTORY] = await self._signal_history(entity, related_signals)
        except Refused:
            raise
        except SourceUnavailable as error:
            raise unavailable(f"The machine's data can't be read: {error}") from None
        except Exception as error:
            log.warning("The data of an escalation could not be read: %s", type(error).__name__)
            raise unavailable(f"The machine's data can't be read ({type(error).__name__}).") from None
        return [
            (FILES[capability], json.dumps(contents[capability], ensure_ascii=False, default=str, indent=1).encode())
            for capability in sharing.allowed
        ]

    async def _active_alerts(self, entity_id: str) -> list[dict[str, Any]]:
        return await self._alerts.active(entity_id) if self._alerts else []

    async def _related(self, entity: dict[str, Any]) -> list[dict[str, Any]]:
        related = await self._context.related(entity, MAX_RELATED)
        return [{"entity": item, "active_alerts": await self._active_alerts(item["id"])} for item in related]

    async def _signal_history(self, entity: dict[str, Any], with_related: bool) -> list[dict[str, Any]]:
        """The machine's own signals, and those of its sensors and parts only if related entities may go too."""
        related = await self._context.related(entity, MAX_RELATED) if with_related else []
        ids = [entity["id"], *(item["id"] for item in related)]
        signals = await self._history.recent(ids, HISTORY_WINDOW)
        return [
            {
                "entity_id": signal.entity_id,
                "attribute": signal.attribute,
                "buckets": [
                    bucket.model_dump(mode="json")
                    for bucket in await self._history.metrics(
                        signal.entity_id, signal.attribute, HISTORY_WINDOW, BUCKET
                    )
                ],
            }
            for signal in signals
        ]

    # ── Sending ──────────────────────────────────────────────────────────────

    async def send_files(self, plan: Plan, files: list[tuple[str, bytes]]) -> str:
        """Starts the conversation with the data. The message's ID."""
        answer = await self._gateway.send_files(
            plan.builder.company_id, files, performative="inform", capability=plan.sharing.allowed[-1]
        )
        return answer["message_id"]

    async def conversation_of(self, message_id: str) -> str:
        return (await self._gateway.sent_message(message_id))["conversation_id"]

    async def send_request(self, plan: Plan, conversation_id: str, incident: dict[str, Any]) -> str:
        answer = await self._gateway.send_message(
            plan.builder.company_id,
            performative="request",
            conversation_id=conversation_id,
            reply_expected=True,
            payload=incident,
        )
        return answer["message_id"]


def incident_message(run: RunState, ref: str, plan: Plan, file_names: list[str]) -> dict[str, Any]:
    """The incident as the machine builder reads it. It holds no entity or history: those are the files."""
    decision = run.data
    diagnosis = {key: decision[key] for key in ("question", "root_cause", "recommended_action") if decision.get(key)}
    return {
        "escalation_ref": ref,
        "machine_id": run.machine_id,
        "issue": run.issue,
        "diagnosis": diagnosis,
        "confidence": decision.get("confidence"),
        "sharing_tier": plan.sharing.tier,
        "files": file_names,
    }
