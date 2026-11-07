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
"""What each data-sharing tier allows. The dataspace doesn't enforce capability access, so this is the filter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

DIRECT = "twin:direct"
ADJACENTS = "twin:adjacents"
HISTORY = "twin:history"

TIERS: dict[str, tuple[str, ...]] = {
    "minimal": (DIRECT,),
    "adjacent": (DIRECT, ADJACENTS),
    "timeseries": (DIRECT, ADJACENTS, HISTORY),
}
LABELS = {
    DIRECT: "The machine's entity data and active alerts",
    ADJACENTS: "Related entities and their active alerts",
    HISTORY: "Signal history of the last 24 hours",
}
FILES = {DIRECT: "machine.json", ADJACENTS: "related-entities.json", HISTORY: "signal-history.json"}
# The access statuses under which the dataspace says this consumer may have the data.
ALLOWED_ACCESS = ("auto", "approved")


@dataclass(frozen=True)
class Sharing:
    """What may go to one consumer, and what may not, and why."""

    tier: str
    allowed: tuple[str, ...]
    withheld: tuple[dict[str, str], ...]

    def data(self) -> list[dict[str, str]]:
        return [{"label": LABELS[capability], "category": capability} for capability in self.allowed]


def apply_policy(tier: str, access: list[dict[str, Any]]) -> Sharing:
    """Filters to the tier and to the access the dataspace reports. A capability it doesn't list isn't allowed."""
    statuses = {item.get("capability"): item.get("status") for item in access}
    allowed, withheld = [], []
    for capability in TIERS[tier]:
        status = statuses.get(capability)
        if status in ALLOWED_ACCESS:
            allowed.append(capability)
        else:
            reason = f"Access of this machine builder is {status or 'not known'}, so it is held back."
            withheld.append({"label": LABELS[capability], "category": capability, "reason": reason})
    for capability, label in LABELS.items():
        if capability not in TIERS[tier]:
            reason = f"The tier {tier} doesn't include it."
            withheld.append({"label": label, "category": capability, "reason": reason})
    return Sharing(tier, tuple(allowed), tuple(withheld))
