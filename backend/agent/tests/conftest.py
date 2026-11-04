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

# The attribute history layout of IFF installations and of the local environment's sample data.
ATTRIBUTES_DDL = """
CREATE TABLE attributes (
    "observedAt"     TIMESTAMPTZ NOT NULL,
    "entityId"       TEXT NOT NULL,
    "attributeId"    TEXT NOT NULL,
    "attributeType"  TEXT NOT NULL DEFAULT 'https://uri.etsi.org/ngsi-ld/Property',
    "nodeType"       TEXT NOT NULL DEFAULT '@value',
    "value"          TEXT,
    "valueType"      TEXT,
    "datasetId"      TEXT,
    "deleted"        BOOLEAN NOT NULL DEFAULT false
)
"""


@pytest.fixture(autouse=True)
def _block_network(request, monkeypatch):
    """Package tests never use the network; `db` tests reach only the test database (through libpq)."""
    if request.node.get_closest_marker("db"):
        return

    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture
def history_database():
    """An empty database with the attribute table; yields its URL. Needs TEST_DATABASE_URL."""
    admin = os.environ.get("TEST_DATABASE_URL")
    if not admin:
        pytest.skip("TEST_DATABASE_URL not set")
    name = f"test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    url = urlunsplit(urlsplit(admin)._replace(path=f"/{name}"))
    with psycopg.connect(url) as conn:
        conn.execute(ATTRIBUTES_DDL)
    yield url
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
