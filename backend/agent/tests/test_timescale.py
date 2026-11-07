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

import psycopg
import pytest

from xana_agent.sources import SourceUnavailable, TimescaleHistorySource
from xana_agent.sources.base import trend

VALUE = "https://uri.etsi.org/ngsi-ld/default-context/value"
STATUS = "https://uri.etsi.org/ngsi-ld/default-context/status"
DOUBLE = "http://www.w3.org/2001/XMLSchema#double"
SENSOR = "urn:ngsi-ld:Sensor:press-01-oil-temperature"


@pytest.mark.parametrize(
    ("change", "spread", "mean", "expected"),
    [(10, 2.9, 55, "rising"), (-10, 2.9, 55, "falling"), (0.1, 1.0, 55, "stable"), (0.0, 0.0, 0.0, "stable")],
)
def test_trend(change, spread, mean, expected):
    assert trend(change, spread, mean) == expected


def _load(url, now):
    """24 h of a rising temperature every 5 minutes, a machine status and one deleted outlier."""
    rows = [(now - timedelta(minutes=5 * i), SENSOR, VALUE, str(70 - i * 0.05), DOUBLE, False) for i in range(288)]
    rows.append((now - timedelta(hours=30), SENSOR, VALUE, "10", DOUBLE, False))  # outside the window
    rows.append((now - timedelta(minutes=1), SENSOR, VALUE, "999", DOUBLE, True))  # deleted
    rows.append((now, "urn:ngsi-ld:Machine:press-01", STATUS, "running", "string", False))
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            'INSERT INTO attributes ("observedAt", "entityId", "attributeId", "value", "valueType", "deleted") '
            "VALUES (%s, %s, %s, %s, %s, %s)",
            rows,
        )


@pytest.mark.db
async def test_recent_reports_last_value_and_trend(history_database):
    now = datetime.now(UTC)
    _load(history_database, now)
    history = await TimescaleHistorySource(history_database).recent(
        [SENSOR, "urn:ngsi-ld:Machine:press-01"], timedelta(hours=24)
    )
    assert len(history) == 1  # the text status is not a numeric signal
    signal = history[0]
    assert (signal.entity_id, signal.attribute) == (SENSOR, "value")
    assert signal.last == pytest.approx(70)
    assert signal.count == 288
    assert signal.minimum == pytest.approx(70 - 287 * 0.05)
    assert signal.trend == "rising"


@pytest.mark.db
async def test_observations_are_the_entitys_own_values_of_every_type(history_database):
    now = datetime.now(UTC)
    _load(history_database, now)
    source = TimescaleHistorySource(history_database)
    machine = await source.observations("urn:ngsi-ld:Machine:press-01", timedelta(hours=24))
    assert [(o.attribute, o.value, o.value_type) for o in machine] == [("status", "running", "string")]
    sensor = await source.observations(SENSOR, timedelta(hours=24))
    assert len(sensor) == 288  # neither the deleted value nor the one outside the window
    assert float(sensor[0].value) == 70 and sensor[0].at >= sensor[-1].at
    assert len(await source.observations(SENSOR, timedelta(hours=24), limit=10)) == 10


@pytest.mark.db
async def test_observations_keep_only_the_attributes_asked_for(history_database):
    _load(history_database, datetime.now(UTC))
    source = TimescaleHistorySource(history_database)
    machine = "urn:ngsi-ld:Machine:press-01"
    assert len(await source.observations(machine, timedelta(hours=24), ["status"])) == 1
    assert len(await source.observations(machine, timedelta(hours=24), [STATUS])) == 1
    assert await source.observations(machine, timedelta(hours=24), ["value"]) == []
    assert await source.observations(machine, timedelta(hours=24), []) == []


@pytest.mark.db
async def test_metrics_are_bucketed(history_database):
    _load(history_database, datetime.now(UTC))
    source = TimescaleHistorySource(history_database)
    buckets = await source.metrics(SENSOR, "value", timedelta(hours=6), timedelta(hours=1))
    assert 6 <= len(buckets) <= 7
    assert all(b.minimum <= b.average <= b.maximum for b in buckets)
    assert buckets[-1].last == pytest.approx(70)
    assert [b.start for b in buckets] == sorted(b.start for b in buckets)
    # The full attribute IRI matches too.
    assert len(await source.metrics(SENSOR, VALUE, timedelta(hours=6), timedelta(hours=1))) == len(buckets)


@pytest.mark.db
async def test_queries_run_read_only(history_database):
    source = TimescaleHistorySource(history_database)
    with pytest.raises(SourceUnavailable):
        await source._read(
            'INSERT INTO {table} ("observedAt", "entityId", "attributeId") VALUES (now(), %(e)s, %(e)s)', {"e": "x"}
        )
    with psycopg.connect(history_database) as conn:
        assert conn.execute("SELECT count(*) FROM attributes").fetchone()[0] == 0


@pytest.mark.db
async def test_missing_table_is_reported(history_database):
    source = TimescaleHistorySource(history_database, table="other_attributes")
    with pytest.raises(SourceUnavailable, match="table not found"):
        await source.recent([SENSOR], timedelta(hours=1))


async def test_unreachable_database_raises_source_unavailable():
    source = TimescaleHistorySource("postgresql://xana:s3cret@127.0.0.1:1/tsdb", connect_timeout_s=1)
    with pytest.raises(SourceUnavailable) as raised:
        await source.recent([SENSOR], timedelta(hours=1))
    assert "s3cret" not in str(raised.value)


def test_invalid_table_name_is_refused():
    with pytest.raises(ValueError, match="Invalid table"):
        TimescaleHistorySource("postgresql://localhost/tsdb", table="attributes; DROP TABLE x")
