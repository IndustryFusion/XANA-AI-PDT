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
"""A run's persisted state, the operations each status allows, and the shapes the API returns."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from xana_agent import Outcome

RUNNING = "running"
AWAITING_INPUT = "awaiting_input"
AWAITING_CONFIRMATION = "awaiting_confirmation"
COMPLETED = "completed"
FAILED = "failed"
STOPPED = "stopped"
AWAITING_MACHINE_BUILDER = "awaiting_machine_builder"
AWAITING_OPERATOR_APPROVAL = "awaiting_operator_approval"
AWAITING_RECOMMENDATION_REVIEW = "awaiting_recommendation_review"
MB_CLOSED = "mb_closed"

CONVERSATION = (AWAITING_MACHINE_BUILDER, AWAITING_OPERATOR_APPROVAL, AWAITING_RECOMMENDATION_REVIEW)
OPEN = (RUNNING, AWAITING_INPUT, AWAITING_CONFIRMATION, *CONVERSATION)
FINISHED = (COMPLETED, FAILED, STOPPED, MB_CLOSED)
ESCALATABLE = (AWAITING_INPUT, AWAITING_CONFIRMATION)

# Operation → the statuses that allow it. Anything else is refused as a conflict.
ALLOWED: dict[str, tuple[str, ...]] = {
    "clarify": (AWAITING_INPUT,),
    "confirm": (AWAITING_CONFIRMATION,),
    "stop": OPEN,
    "archive": FINISHED,
    "escalate": ESCALATABLE,
}

# Steps the operator adds. They belong to the round they answer and are kept when a round runs again.
OPERATOR_STEPS = ("clarification", "resolution")


@dataclass(frozen=True)
class RunState:
    """Everything stored about a run. Replaced as a whole on every change."""

    run_id: str
    machine_id: str
    issue: str
    status: str
    started_at: datetime
    updated_at: datetime
    data: dict[str, Any] = field(default_factory=dict)
    steps: tuple[dict[str, Any], ...] = ()
    round: int = 1
    clarifications: tuple[str, ...] = ()
    rejected: tuple[dict[str, Any], ...] = ()
    incident_id: int | None = None
    escalation: dict[str, Any] | None = None
    outbox: tuple[dict[str, Any], ...] = ()
    conversation_id: str | None = None
    attempt: dict[str, Any] | None = None  # how far an escalation that failed got

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "incident_id": self.incident_id,
            "machine_id": self.machine_id,
            "issue": self.issue,
            "status": self.status,
            "started_at": self.started_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "escalation_ref": self.escalation["ref"] if self.escalation else None,
        }

    def view(self) -> dict[str, Any]:
        """The run as `GET /api/agent/status` and the stream's snapshot return it."""
        return self.summary() | {
            "data": self.data,
            "steps": list(self.steps),
            "escalation": self.escalation,
            "outbox": self.outbox_status(),
            "reopenable": self.status in (STOPPED, MB_CLOSED)
            and bool(self.conversation_id)
            and self.data.get("reopenable") is not False,
        }

    def outbox_status(self) -> list[dict[str, Any]]:
        """Delivery of what was sent, in the interface's terms."""
        return [
            {key: entry[key] for key in ("message_id", "status", "kind", "error") if key in entry}
            for entry in self.outbox
        ]

    def last_decision(self) -> dict[str, Any] | None:
        """The output of the latest decide step."""
        return next((s["output"] for s in reversed(self.steps) if s["node"] == "decide"), None)

    def restart_point(self) -> tuple[tuple[dict[str, Any], ...], str]:
        """The steps to keep and the work to redo when the backend stopped during this run's round.

        After a confirmation only the act step is redone; otherwise the current round's
        workflow steps are dropped and the round runs again from observe.
        """
        current = [i for i, s in enumerate(self.steps) if s.get("round") == self.round]
        confirmed = [i for i in current if _is_confirmation(self.steps[i])]
        if confirmed:
            return self.steps[: confirmed[-1] + 1], "act"
        keep = tuple(s for s in self.steps if s.get("round") != self.round or s["node"] in OPERATOR_STEPS)
        return keep, "analyse"


def _is_confirmation(step: dict[str, Any]) -> bool:
    return step["node"] == "resolution" and step["output"].get("confirmed") is True


def outcome_state(outcome: Outcome, rejected: tuple[dict[str, Any], ...]) -> tuple[str, dict[str, Any]]:
    """The status and state data a workflow outcome leads to."""
    match outcome.kind:
        case "awaiting_input":
            return AWAITING_INPUT, {
                "question": outcome.question,
                "confidence": outcome.confidence,
                "threshold": outcome.threshold,
            }
        case "awaiting_confirmation":
            return AWAITING_CONFIRMATION, {
                "root_cause": outcome.root_cause,
                "recommended_action": outcome.recommended_action,
                "confidence": outcome.confidence,
                "rejected": list(rejected),
            }
        case "completed":
            return COMPLETED, {
                "root_cause": outcome.root_cause,
                "recommended_action": outcome.recommended_action,
                "confidence": outcome.confidence,
                "incident_logged": True,
            }
    return FAILED, {"error": outcome.error or "The run failed.", "node": outcome.node}
