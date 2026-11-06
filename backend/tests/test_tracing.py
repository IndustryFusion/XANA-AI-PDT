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
"""Tracing is optional: off without keys, a warning without the package, metadata with a run."""

import logging
import sys
import types

from langchain_core.callbacks import BaseCallbackHandler

from app.tracing import tracing_callbacks
from tests.conftest import make_settings
from tests.runs_support import MACHINE, Script
from xana_agent import Workflow
from xana_agent.schemas import RoundInput
from xana_agent.testing import FakeContextSource, FakeHistorySource, sample_entities, sample_history

KEYS = {"langfuse_public_key": "pk", "langfuse_secret_key": "sk-lf-secret"}


def test_off_without_keys(monkeypatch):
    monkeypatch.setitem(sys.modules, "langfuse", None)
    assert tracing_callbacks(make_settings()) == []


def test_keys_without_the_package_warn_and_run_on(monkeypatch, caplog):
    monkeypatch.setitem(sys.modules, "langfuse", None)
    with caplog.at_level(logging.WARNING):
        assert tracing_callbacks(make_settings(**KEYS)) == []
    assert "not installed" in caplog.text
    assert "sk-lf-secret" not in caplog.text


def stand_in(monkeypatch, client=None):
    package = types.ModuleType("langfuse")
    package.Langfuse = client or (lambda **kwargs: None)
    integration = types.ModuleType("langfuse.langchain")

    class Handler(BaseCallbackHandler):
        def __init__(self, public_key=None):
            self.public_key = public_key
            self.metadata = []

        def on_chain_start(self, serialized, inputs, *, metadata=None, **kwargs):
            self.metadata.append(metadata)

    integration.CallbackHandler = Handler
    monkeypatch.setitem(sys.modules, "langfuse", package)
    monkeypatch.setitem(sys.modules, "langfuse.langchain", integration)


def test_a_failing_tracer_does_not_stop_the_app(monkeypatch, caplog):
    def broken(**kwargs):
        raise RuntimeError("sk-lf-secret was refused")

    stand_in(monkeypatch, broken)
    with caplog.at_level(logging.WARNING):
        assert tracing_callbacks(make_settings(**KEYS)) == []
    assert "sk-lf-secret" not in caplog.text


async def test_round_passes_metadata_to_the_callback(monkeypatch):
    stand_in(monkeypatch)
    handler = tracing_callbacks(make_settings(**KEYS))[0]
    workflow = Workflow(
        Script().model(),
        FakeContextSource(sample_entities()),
        FakeHistorySource(sample_history()),
        _Memory(),
        callbacks=[handler],
    )
    metadata = {"langfuse_session_id": "run-1", "machine_id": MACHINE, "round": 2}
    events = [e async for e in workflow.analyse(RoundInput(machine_id=MACHINE, issue="noise"), metadata)]
    assert events
    assert handler.metadata
    assert handler.metadata[0]["langfuse_session_id"] == "run-1"
    assert handler.metadata[0]["round"] == 2


class _Memory:
    async def similar(self, *args, **kwargs):
        return []

    async def store(self, *args, **kwargs):
        return 1

    def __getattr__(self, name):
        async def nothing(*args, **kwargs):
            return []

        return nothing
