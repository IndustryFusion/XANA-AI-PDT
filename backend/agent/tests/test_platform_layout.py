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
"""The time-series source on the platform's table layout, where `deleted` may be null."""

from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from xana_agent.sources import SourceUnavailable, TimescaleHistorySource

pytestmark = pytest.mark.db

ENTITY = "urn:m:1"
IRI = "https://industry-fusion.com/types/v0.9/"
PROPERTY = "https://uri.etsi.org/ngsi-ld/Property"
RELATIONSHIP = "https://uri.etsi.org/ngsi-ld/Relationship"
WINDOW = timedelta(hours=24)

PLATFORM_DDL = """
DROP TABLE attributes;
CREATE TABLE attributes (
    "id" TEXT NOT NULL, "parentId" TEXT, "observedAt" TIMESTAMPTZ NOT NULL, "modifiedAt" TIMESTAMPTZ NOT NULL,
    "entityId" TEXT NOT NULL, "attributeId" TEXT NOT NULL, "attributeType" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL, "nodeType" TEXT NOT NULL, "value" TEXT, "valueType" TEXT, "unitCode" TEXT,
    "lang" TEXT, "deleted" BOOLEAN, PRIMARY KEY ("id", "observedAt", "datasetId")
);
CREATE TABLE entities (
    "id" TEXT NOT NULL, "observedAt" TIMESTAMPTZ NOT NULL, "modifiedAt" TIMESTAMPTZ NOT NULL,
    "type" TEXT NOT NULL, "deleted" BOOLEAN, PRIMARY KEY ("id", "observedAt")
);
"""


def add(conn, name, hours_ago, value, deleted=False, kind=PROPERTY, entity=ENTITY):
    at = datetime.now(UTC) - timedelta(hours=hours_ago)
    conn.execute(
        'INSERT INTO attributes ("id", "observedAt", "modifiedAt", "entityId", "attributeId", "attributeType", '
        '"datasetId", "nodeType", "value", "deleted") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
        (f"{entity}\\{name}", at, at, entity, f"{IRI}{name}", kind, "@none", "@value", value, deleted),
    )


def add_entity(conn, entity, hours_ago, deleted=False, entity_type="Machine"):
    at = datetime.now(UTC) - timedelta(hours=hours_ago)
    conn.execute(
        'INSERT INTO entities ("id", "observedAt", "modifiedAt", "type", "deleted") VALUES (%s, %s, %s, %s, %s)',
        (entity, at, at, entity_type, deleted),
    )


@pytest.fixture
def platform(history_database):
    with psycopg.connect(history_database) as conn:
        conn.execute(PLATFORM_DDL)
    return history_database


async def test_rows_with_a_null_deleted_flag_count(platform):
    with psycopg.connect(platform) as conn:
        add(conn, "temp", 3, "40", deleted=None)
        add(conn, "temp", 2, "41", deleted=None)
        add(conn, "temp", 1, "42", deleted=False)
        add(conn, "temp", 0.5, None, deleted=True)
    source = TimescaleHistorySource(platform)
    [signal] = await source.recent([ENTITY], WINDOW)
    assert signal.count == 3
    assert signal.last == 42
    buckets = await source.metrics(ENTITY, "temp", WINDOW, timedelta(hours=24))
    assert sum(b.count for b in buckets) == 3


async def test_relationship_and_text_changes_newest_first_without_repeats(platform):
    with psycopg.connect(platform) as conn:
        add(conn, "hasFilter", 5, "urn:f:1", kind=RELATIONSHIP)
        add(conn, "hasFilter", 4, "urn:f:1", kind=RELATIONSHIP)
        add(conn, "hasFilter", 3, "urn:f:2", kind=RELATIONSHIP, deleted=None)
        add(conn, "state", 2, "ON")
        add(conn, "temp", 1, "42")
        add(conn, "state", 30, "OLD")
        add(conn, "gone", 1, None, deleted=True)
        add(conn, "other", 1, "x", entity="urn:m:2")
    changes = await TimescaleHistorySource(platform).changes([ENTITY], WINDOW)
    assert [(c.attribute, c.value, c.kind) for c in changes] == [
        ("state", "ON", "text"),
        ("hasFilter", "urn:f:2", "relationship"),
        ("hasFilter", "urn:f:1", "relationship"),
    ]


async def test_changes_are_limited(platform):
    with psycopg.connect(platform) as conn:
        for i in range(10):
            add(conn, "state", i + 1, f"s{i}")
    changes = await TimescaleHistorySource(platform).changes([ENTITY], WINDOW, limit=3)
    assert [c.value for c in changes] == ["s0", "s1", "s2"]


async def test_lifecycle_tells_created_and_deleted_from_other_changes(platform):
    with psycopg.connect(platform) as conn:
        add_entity(conn, "urn:new", 2, deleted=None)
        add_entity(conn, "urn:old", 100)
        add_entity(conn, "urn:old", 2)
        add_entity(conn, "urn:gone", 100)
        add_entity(conn, "urn:gone", 1, deleted=True)
        add_entity(conn, "urn:elsewhere", 1)
    events = await TimescaleHistorySource(platform).lifecycle(["urn:new", "urn:old", "urn:gone"], WINDOW)
    assert [(e.entity_id, e.event) for e in events] == [("urn:gone", "deleted"), ("urn:new", "created")]


async def test_no_entities_means_no_query(history_database):
    source = TimescaleHistorySource("postgresql://nobody@127.0.0.1:1/none")
    assert await source.changes([], WINDOW) == []
    assert await source.lifecycle([], WINDOW) == []


async def test_missing_entities_table_is_a_source_error(history_database):
    with pytest.raises(SourceUnavailable, match="table not found"):
        await TimescaleHistorySource(history_database).lifecycle([ENTITY], WINDOW)


async def test_the_earlier_sample_layout_still_works(history_database):
    with psycopg.connect(history_database) as conn:
        conn.execute(
            'INSERT INTO attributes ("observedAt", "entityId", "attributeId", "value") VALUES (now(), %s, %s, %s)',
            (ENTITY, f"{IRI}temp", "40"),
        )
    [signal] = await TimescaleHistorySource(history_database).recent([ENTITY], WINDOW)
    assert signal.last == 40


async def test_reads_stay_read_only(platform):
    source = TimescaleHistorySource(platform)
    with pytest.raises(SourceUnavailable):
        await source._read("INSERT INTO attributes (id) VALUES ('x') RETURNING id", {})
