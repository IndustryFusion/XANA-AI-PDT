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
"""Typed content: what the language model answers, and what the workflow exchanges with its caller."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field


def normalise_confidence(value: Any) -> float:
    """A confidence in [0, 1]. Values above 1 are read as percentages, then clamped."""
    number = float(value)
    if number > 1:
        number /= 100
    return min(1.0, max(0.0, number))


Confidence = Annotated[float, BeforeValidator(normalise_confidence)]

Verdict = Literal["confirmed", "plausible", "inconclusive", "refuted"]


# ── Model answers ────────────────────────────────────────────────────────────


class HypothesisDraft(BaseModel):
    title: str = Field(description="Short statement of the suspected root cause")
    confidence: Confidence = Field(description="Confidence from 0 to 1")
    evidence: list[str] = Field(description="Observations this hypothesis rests on")


class HypothesisList(BaseModel):
    """Two or three hypotheses for the issue."""

    hypotheses: list[HypothesisDraft] = Field(min_length=2)


class PlannedQuery(BaseModel):
    hypothesis_id: str
    entity_id: str = Field(description="One of the observed entity IDs")
    attribute: str = Field(description="Attribute name, for example 'value' or 'temperature'")
    window_hours: float = Field(default=24, description="How far back to look, in hours")
    bucket_minutes: int = Field(default=60, description="Aggregation interval, in minutes")


class PlannedLookup(BaseModel):
    hypothesis_id: str
    entity_id: str = Field(description="One of the observed entity IDs")


class ValidationPlan(BaseModel):
    """Targeted checks of the hypotheses against the machine's data."""

    queries: list[PlannedQuery] = Field(description="Attribute history queries, at least one per hypothesis")
    lookups: list[PlannedLookup] = Field(description="Fresh reads of an entity's current values")


class ValidatedHypothesis(BaseModel):
    id: str = Field(description="Hypothesis ID, for example h1-2")
    verdict: Verdict
    confidence: Confidence = Field(description="Updated confidence from 0 to 1")
    validation: str = Field(description="What the data showed, or which data was missing")


class ValidatedHypothesisList(BaseModel):
    """The verdict on every hypothesis."""

    hypotheses: list[ValidatedHypothesis]


class Question(BaseModel):
    """A question to the operator naming the information that is missing."""

    question: str


class Decision(BaseModel):
    """The proposed root cause and what to do about it."""

    hypothesis_id: str = Field(description="ID of the hypothesis chosen as the root cause")
    recommended_action: str
    reasoning: str


# ── Round input and results ──────────────────────────────────────────────────


class Rejection(BaseModel):
    root_cause: str
    reason: str = ""


class RoundInput(BaseModel):
    """What the caller knows about a run when it starts a round."""

    machine_id: str
    issue: str
    round: int = 1
    clarifications: list[str] = Field(default_factory=list)
    rejected: list[Rejection] = Field(default_factory=list)


class PastIncident(BaseModel):
    incident_id: str
    machine_id: str
    machine_type: str | None = None
    issue: str
    root_cause: str
    resolution: str
    resolved_at: datetime | None = None


class IncidentRecord(BaseModel):
    """A confirmed incident, as it is stored in incident memory."""

    machine_id: str
    machine_type: str | None = None
    issue: str
    root_cause: str
    recommended_action: str
    confidence: float | None = None
    trace: list[dict[str, Any]] = Field(default_factory=list)


@dataclass(frozen=True)
class StepEvent:
    """One completed step."""

    node: str
    input: dict[str, Any]
    output: dict[str, Any]
    at: datetime

    def as_dict(self) -> dict[str, Any]:
        return {"node": self.node, "input": self.input, "output": self.output, "at": self.at.isoformat()}


OutcomeKind = Literal["awaiting_input", "awaiting_confirmation", "completed", "failed"]


@dataclass(frozen=True)
class Outcome:
    """How a round or the act call ended. Always the last event."""

    kind: OutcomeKind
    confidence: float | None = None
    threshold: float | None = None
    question: str | None = None
    root_cause: str | None = None
    recommended_action: str | None = None
    incident_id: str | None = None
    node: str | None = None
    error: str | None = None
    decision: dict[str, Any] = field(default_factory=dict)
