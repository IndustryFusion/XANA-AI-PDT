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
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest

from sample_data.loader import history_rows, load_entities, load_history, read_sample_data
from tests.conftest import make_settings

DATA = read_sample_data()


def test_sample_data_has_machines_components_and_history():
    types = {e["type"] for e in DATA["entities"]}
    assert {"Machine", "Component", "Sensor"} <= types
    machines = [e["id"] for e in DATA["entities"] if e["type"] == "Machine"]
    assert "urn:ngsi-ld:Machine:laser-cutter-01" in machines
    components = [e for e in DATA["entities"] if e["type"] == "Component"]
    assert all(c["partOf"]["object"] in machines for c in components)


def test_history_covers_24_hours_and_ends_now():
    now = datetime(2026, 11, 4, 12, tzinfo=UTC)
    rows = history_rows(DATA["history"], now)
    sensor_rows = [r for r in rows if r[1] == "urn:ngsi-ld:Sensor:laser-cutter-01-temperature"]
    assert max(r[0] for r in sensor_rows) == now
    assert now - min(r[0] for r in sensor_rows) >= timedelta(hours=23, minutes=55)
    assert sensor_rows[0][4].endswith("#double")


def broker(existing: set[str]):
    created: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/ngsi-ld/v1/entityOperations/create"
        batch = __import__("json").loads(request.content)
        errors = [
            {"entityId": e["id"], "error": {"status": 409, "title": "Already exists"}}
            for e in batch
            if e["id"] in existing
        ]
        ok = [e["id"] for e in batch if e["id"] not in existing]
        created.extend(ok)
        existing.update(ok)
        if not errors:
            return httpx.Response(201)
        return httpx.Response(207, json={"success": ok, "errors": errors})

    return httpx.Client(transport=httpx.MockTransport(handler), base_url="http://broker"), created


def test_entities_created_once():
    settings = make_settings(ngsi_url="http://broker")
    existing: set[str] = set()
    client, created = broker(existing)
    assert load_entities(settings, DATA["entities"], client) == (len(DATA["entities"]), 0)
    assert load_entities(settings, DATA["entities"], client) == (0, len(DATA["entities"]))
    assert len(created) == len(DATA["entities"])


def test_unexpected_broker_error_is_raised():
    settings = make_settings(ngsi_url="http://broker")
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(400, text="bad")))
    with pytest.raises(RuntimeError, match="HTTP 400"):
        load_entities(settings, DATA["entities"][:1], client)


@pytest.mark.db
def test_history_loaded_once(fresh_database):
    url = fresh_database()
    settings = make_settings(timescale_db_url=url)
    now = datetime.now(UTC).replace(microsecond=0)
    written = load_history(settings, DATA["history"], now)
    assert written == len(history_rows(DATA["history"], now))
    assert load_history(settings, DATA["history"]) == 0
    with psycopg.connect(url) as conn:
        count, latest = conn.execute('SELECT count(*), max("observedAt") FROM attributes').fetchone()
    assert count == written
    assert latest == now


@pytest.mark.db
async def test_timeseries_check_sees_the_table(fresh_database):
    from app.health import HealthService
    from app.memory.migrate import Migrator

    url = fresh_database()
    settings = make_settings(timescale_db_url=url)
    service = HealthService(settings, Migrator(""))
    assert (await service._timeseries())[0] == "degraded"
    load_history(settings, DATA["history"][:1])
    assert (await service._timeseries())[0] == "ok"


OLD_LAYOUT = """
CREATE TABLE attributes (
    "observedAt" TIMESTAMPTZ NOT NULL, "entityId" TEXT NOT NULL, "attributeId" TEXT NOT NULL,
    "attributeType" TEXT NOT NULL DEFAULT 'https://uri.etsi.org/ngsi-ld/Property',
    "nodeType" TEXT NOT NULL DEFAULT '@value', "value" TEXT, "valueType" TEXT, "datasetId" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE xana_sample_data (name TEXT PRIMARY KEY, loaded_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO xana_sample_data (name) VALUES ('attribute-history');
INSERT INTO attributes ("observedAt", "entityId", "attributeId", "value") VALUES (now(), 'urn:old', 'urn:attr', '1');
"""


@pytest.mark.db
def test_a_database_from_before_the_platforms_layout_gains_its_columns_and_keeps_its_data(fresh_database):
    url = fresh_database()
    with psycopg.connect(url) as conn:
        conn.execute(OLD_LAYOUT)
    settings = make_settings(timescale_db_url=url)
    written = load_history(settings, DATA["history"], entities=DATA["entities"])
    assert written > 0
    with psycopg.connect(url) as conn:
        kept = conn.execute("""SELECT "id", "datasetId" FROM attributes WHERE "entityId" = 'urn:old'""").fetchone()
        assert kept == ("urn:old\\urn:attr\\@none", "@none")
        assert conn.execute("SELECT count(*) FROM entities").fetchone()[0] == len(DATA["entities"])
        # The old series isn't written again, only the state and lifecycle are added, once.
        assert load_history(settings, DATA["history"], entities=DATA["entities"]) == 0
        conn.execute("""INSERT INTO attributes ("id", "observedAt", "entityId", "attributeId", "deleted")
                        VALUES ('x', now(), 'urn:n', 'urn:a', NULL)""")


@pytest.mark.db
def test_snapshot_rows_hang_sub_attributes_on_their_parent(fresh_database):
    url = fresh_database()
    load_history(make_settings(timescale_db_url=url), DATA["history"], entities=DATA["entities"])
    with psycopg.connect(url) as conn:
        orphans = conn.execute(
            """SELECT count(*) FROM attributes c WHERE c."parentId" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM attributes p WHERE p."id" = c."parentId")"""
        ).fetchone()[0]
        children = conn.execute('SELECT count(*) FROM attributes WHERE "parentId" IS NOT NULL').fetchone()[0]
    assert orphans == 0
    assert children > 0
