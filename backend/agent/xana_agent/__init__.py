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
"""XANA AI PDT diagnostic agent workflow.

A self-contained package: it can be installed, imported and tested without
the backend service, which is one of its consumers.

    workflow = Workflow(llm, context, history, memory, threshold=0.9)
    async for event in workflow.analyse(RoundInput(machine_id=..., issue=...)):
        ...  # StepEvent per completed step, then one Outcome
"""

from xana_agent import testing as _testing
from xana_agent.schemas import IncidentRecord, Outcome, PastIncident, Rejection, RoundInput, StepEvent
from xana_agent.scripted import ScriptedChatModel, example_for, register_example
from xana_agent.sources import (
    AlertaAlertSource,
    ContextSource,
    HistorySource,
    IncidentMemory,
    InMemoryIncidentMemory,
    NgsiContextSource,
    SourceUnavailable,
    TimescaleHistorySource,
)
from xana_agent.workflow import Workflow

# Without a model, the scripted provider gives a complete, confident diagnosis.
_testing.register_scripted_answers()

__all__ = [
    "AlertaAlertSource",
    "ContextSource",
    "HistorySource",
    "InMemoryIncidentMemory",
    "IncidentMemory",
    "IncidentRecord",
    "NgsiContextSource",
    "Outcome",
    "PastIncident",
    "Rejection",
    "RoundInput",
    "ScriptedChatModel",
    "SourceUnavailable",
    "StepEvent",
    "TimescaleHistorySource",
    "Workflow",
    "example_for",
    "register_example",
]
