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
"""Incident memory held in process: for tests and standalone use. Lost when the process ends."""

from __future__ import annotations

from datetime import UTC, datetime

from xana_agent.schemas import IncidentRecord, PastIncident


class InMemoryIncidentMemory:
    def __init__(self, incidents: list[PastIncident] | None = None) -> None:
        self.incidents: list[PastIncident] = list(incidents or [])
        self.records: list[IncidentRecord] = []

    async def similar(self, machine_id: str, machine_type: str | None, limit: int) -> list[PastIncident]:
        def newest_first(items: list[PastIncident]) -> list[PastIncident]:
            return sorted(items, key=lambda i: i.resolved_at or datetime.min.replace(tzinfo=UTC), reverse=True)

        same_machine = [i for i in self.incidents if i.machine_id == machine_id]
        same_type = [
            i for i in self.incidents if i.machine_id != machine_id and machine_type and i.machine_type == machine_type
        ]
        return (newest_first(same_machine) + newest_first(same_type))[:limit]

    async def store(self, record: IncidentRecord) -> str:
        incident_id = f"incident-{len(self.records) + 1}"
        self.records.append(record)
        self.incidents.append(
            PastIncident(
                incident_id=incident_id,
                machine_id=record.machine_id,
                machine_type=record.machine_type,
                issue=record.issue,
                root_cause=record.root_cause,
                resolution=record.recommended_action,
                resolved_at=datetime.now(UTC),
            )
        )
        return incident_id
