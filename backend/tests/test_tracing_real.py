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
"""Traces reach the configured Langfuse address, with the real tracing package and a stand-in server.

Needs the `tracing` extra; without it these are skipped. Each test runs in its own process, as the
tracing client is set up once per process.
"""

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

pytest.importorskip("langfuse")

BACKEND = Path(__file__).resolve().parents[1]

ROUND = """
import asyncio, json, os
from app.config import load_settings
from tests.conftest import make_settings
from app.tracing import tracing_callbacks
from tests.runs_support import MACHINE, Script
from tests.test_tracing import _Memory
from xana_agent import Workflow
from xana_agent.schemas import RoundInput
from xana_agent.testing import FakeContextSource, FakeHistorySource, sample_entities, sample_history

async def main():
    # The address and keys come from the settings only: the tracing client must not find them by itself.
    given = json.loads(os.environ.get("TEST_SETTINGS") or "{}")
    settings = make_settings(**given) if given else load_settings()
    callbacks = tracing_callbacks(settings)
    workflow = Workflow(Script().model(), FakeContextSource(sample_entities()), FakeHistorySource(sample_history()),
                        _Memory(), callbacks=callbacks)
    metadata = {"langfuse_session_id": "run-1", "machine_id": MACHINE, "round": 1}
    events = [e async for e in workflow.analyse(RoundInput(machine_id=MACHINE, issue="noise"), metadata)]
    assert events
    if callbacks:
        from langfuse import get_client
        get_client().flush()
    print("callbacks", len(callbacks))

asyncio.run(main())
"""


class StandIn:
    """A Langfuse server that records what reaches it."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        seen = self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("content-length") or 0)
                self.rfile.read(length)
                seen.append(("POST", self.path, dict(self.headers)))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b"{}")

            def do_GET(self):  # noqa: N802
                seen.append(("GET", self.path, dict(self.headers)))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"data": []}).encode())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


def run_round(env: dict[str, str]) -> subprocess.CompletedProcess:
    clean = {k: v for k, v in os.environ.items() if not k.startswith("LANGFUSE_")}
    return subprocess.run(  # noqa: S603 - this interpreter, with this file's own script
        [sys.executable, "-c", ROUND],
        cwd=BACKEND,
        env=clean | {"LLM_PROVIDER": "scripted", "LANGFUSE_TRACING_ENVIRONMENT": "test"} | env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.parametrize("name", ["LANGFUSE_HOST", "LANGFUSE_BASE_URL"])
def test_traces_reach_the_configured_server(name):
    with StandIn() as server:
        done = run_round({name: server.url, "LANGFUSE_PUBLIC_KEY": "pk-lf-test", "LANGFUSE_SECRET_KEY": "sk-lf-test"})
        assert done.returncode == 0, done.stderr[-2000:]
        assert "callbacks 1" in done.stdout
    traces = [r for r in server.requests if r[0] == "POST" and r[1].endswith("/api/public/otel/v1/traces")]
    assert traces, server.requests
    headers = {key.lower(): value for key, value in traces[0][2].items()}
    assert headers.get("authorization", "").startswith("Basic ")  # with the keys


@pytest.mark.parametrize("name", ["langfuse_host", "langfuse_base_url"])
def test_the_address_is_passed_to_the_tracing_client(name):
    """Settings from a file, say, reach the client only through the backend: the client reads no file."""
    with StandIn() as server:
        given = {name: server.url, "langfuse_public_key": "pk-lf-test", "langfuse_secret_key": "sk-lf-test"}
        done = run_round({"TEST_SETTINGS": json.dumps(given)})
        assert done.returncode == 0, done.stderr[-2000:]
    assert [r for r in server.requests if r[1].endswith("/api/public/otel/v1/traces")], server.requests


def test_without_keys_nothing_is_sent():
    with StandIn() as server:
        done = run_round({"LANGFUSE_HOST": server.url})
        assert done.returncode == 0, done.stderr[-2000:]
        assert "callbacks 0" in done.stdout
    assert server.requests == []
