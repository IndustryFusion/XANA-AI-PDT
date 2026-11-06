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
"""What the workflow needs from its data sources. All reads; nothing here writes to the factory."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel

from xana_agent.schemas import IncidentRecord, PastIncident

Trend = Literal["rising", "falling", "stable"]


class SourceUnavailable(Exception):
    """A data source could not be reached, or answered with an error. The message is safe to show."""


class SignalHistory(BaseModel):
    """Recent history of one numeric attribute."""

    entity_id: str
    attribute: str
    last: float
    last_at: datetime
    count: int
    minimum: float
    maximum: float
    trend: Trend


class Bucket(BaseModel):
    start: datetime
    minimum: float
    maximum: float
    average: float
    last: float
    count: int


class AttributeChange(BaseModel):
    """A relationship target or text value that was set."""

    entity_id: str
    attribute: str
    at: datetime
    value: str
    kind: Literal["relationship", "text"]


class LifecycleEvent(BaseModel):
    entity_id: str
    entity_type: str | None = None
    at: datetime
    event: Literal["created", "deleted"]


@runtime_checkable
class ContextSource(Protocol):
    """Current state of entities (NGSI-LD context broker)."""

    async def get(self, entity_id: str) -> dict[str, Any] | None:
        """The entity, or None if it does not exist."""
        ...

    async def related(self, entity: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        """Entities one relationship away from `entity`, in either direction."""
        ...


@runtime_checkable
class HistorySource(Protocol):
    """Attribute history (time-series store)."""

    async def recent(self, entity_ids: list[str], window: timedelta) -> list[SignalHistory]:
        """The last value and trend of every numeric attribute of the entities within `window`."""
        ...

    async def metrics(self, entity_id: str, attribute: str, window: timedelta, bucket: timedelta) -> list[Bucket]:
        """Minimum, maximum, average and last value per time bucket, oldest first."""
        ...


@runtime_checkable
class ChangeHistorySource(Protocol):
    """What a history source may offer besides numbers. A source without it is taken to have none."""

    async def changes(self, entity_ids: list[str], window: timedelta, limit: int = 50) -> list[AttributeChange]:
        """Relationship and text values set within `window`, newest first."""
        ...

    async def lifecycle(self, entity_ids: list[str], window: timedelta, limit: int = 50) -> list[LifecycleEvent]:
        """Entities created or deleted within `window`, newest first."""
        ...


@runtime_checkable
class IncidentMemory(Protocol):
    """Confirmed incidents."""

    async def similar(self, machine_id: str, machine_type: str | None, limit: int) -> list[PastIncident]:
        """Incidents of the same machine first, then of the same machine type; newest first within each."""
        ...

    async def store(self, record: IncidentRecord) -> str:
        """Stores a confirmed incident and returns its ID."""
        ...


def trend(change: float, spread: float, mean: float) -> Trend:
    """Classifies the change of a signal over its window.

    `change` is the fitted change from the start to the end of the window and
    `spread` the standard deviation. A change counts when it exceeds the spread
    and 1 % of the mean level, so noise around a steady level stays `stable`.
    """
    significant = max(spread, abs(mean) * 0.01, 1e-9)
    if change > significant:
        return "rising"
    if change < -significant:
        return "falling"
    return "stable"
