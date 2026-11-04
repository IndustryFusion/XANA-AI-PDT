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
import os
import socket
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from app.config import Settings

# Ports nothing listens on: dependencies that cannot be reached.
CLOSED_PG = "postgresql://xana:s3cret-pw@127.0.0.1:1/memory"
CLOSED_HTTP = "http://127.0.0.1:1"


@pytest.fixture(autouse=True)
def _no_ambient_env(monkeypatch):
    """Tests see only the settings they pass, never the developer's environment."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name.upper(), raising=False)


def make_settings(**overrides) -> Settings:
    values = {
        "postgres_memory_url": CLOSED_PG,
        "timescale_db_url": CLOSED_PG.replace("/memory", "/tsdb"),
        "ngsi_url": CLOSED_HTTP,
        "ollama_url": CLOSED_HTTP,
        "health_timeout_s": 1,
        "health_cache_s": 0,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def block_network(monkeypatch):
    """Fails any attempt to open a network connection."""

    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def _with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{name}"))


@pytest.fixture
def fresh_database():
    """Creates an empty database for one test; yields a factory for its URL. Needs TEST_DATABASE_URL."""
    admin = os.environ.get("TEST_DATABASE_URL")
    if not admin:
        pytest.skip("TEST_DATABASE_URL not set")
    created: list[str] = []

    def make(create: bool = True) -> str:
        name = f"test_{uuid.uuid4().hex[:12]}"
        if create:
            with psycopg.connect(admin, autocommit=True) as conn:
                conn.execute(f'CREATE DATABASE "{name}"')
        created.append(name)
        return _with_database(admin, name)

    def create_later(url: str) -> None:
        with psycopg.connect(admin, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE "{urlsplit(url).path.lstrip("/")}"')

    make.create_later = create_later
    yield make
    with psycopg.connect(admin, autocommit=True) as conn:
        for name in created:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
