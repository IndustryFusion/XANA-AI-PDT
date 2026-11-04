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
"""History source over the attribute history table in TimescaleDB (or plain PostgreSQL).

One row per attribute observation: "observedAt", "entityId", "attributeId"
(an IRI or a short name), "value" as text, "valueType" and "deleted". Every
query runs in a read-only transaction.
"""

from __future__ import annotations

import re
from datetime import timedelta

import psycopg
from psycopg import sql

from xana_agent.sources.base import Bucket, SignalHistory, SourceUnavailable, trend

_NUMBER = r"^\s*[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?\s*$"
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")

_RECENT = """
WITH points AS (
    SELECT "entityId" AS entity_id, "attributeId" AS attribute_id, "observedAt" AS at,
           CAST("value" AS double precision) AS v
    FROM {table}
    WHERE "entityId" = ANY(%(entities)s) AND "observedAt" > now() - %(window)s
      AND NOT "deleted" AND "value" ~ %(number)s
)
SELECT entity_id, attribute_id,
       (array_agg(v ORDER BY at DESC))[1] AS last,
       max(at) AS last_at, count(*) AS n, min(v), max(v), avg(v),
       coalesce(stddev_samp(v), 0) AS spread,
       coalesce(regr_slope(v, extract(epoch FROM at)), 0)
           * extract(epoch FROM max(at) - min(at)) AS change
FROM points
GROUP BY entity_id, attribute_id
ORDER BY entity_id, attribute_id
"""

# date_bin is plain PostgreSQL (14+); it gives the same buckets as TimescaleDB's time_bucket.
_METRICS = """
SELECT date_bin(%(bucket)s, "observedAt", TIMESTAMPTZ '2000-01-01') AS start,
       min(v), max(v), avg(v), (array_agg(v ORDER BY "observedAt" DESC))[1], count(*)
FROM (
    SELECT "observedAt", CAST("value" AS double precision) AS v
    FROM {table}
    WHERE "entityId" = %(entity)s AND ("attributeId" = %(attribute)s OR "attributeId" LIKE %(suffix)s
                                        OR "attributeId" LIKE %(fragment)s)
      AND "observedAt" > now() - %(window)s AND NOT "deleted" AND "value" ~ %(number)s
) AS points
GROUP BY start
ORDER BY start
"""


class TimescaleHistorySource:
    def __init__(self, url: str, table: str = "attributes", connect_timeout_s: float = 5) -> None:
        if not _IDENTIFIER.match(table):
            raise ValueError(f"Invalid table name: {table!r}")
        self._url = url
        self._table = sql.Identifier(*table.split("."))
        self._connect_timeout_s = connect_timeout_s

    async def _read(self, query: str, params: dict) -> list[tuple]:
        try:
            async with await psycopg.AsyncConnection.connect(
                self._url, connect_timeout=max(1, round(self._connect_timeout_s))
            ) as conn:
                await conn.set_read_only(True)
                async with conn.cursor() as cur:
                    await cur.execute(sql.SQL(query).format(table=self._table), params)
                    return await cur.fetchall()
        except psycopg.Error as exc:
            raise SourceUnavailable(_describe(exc)) from None

    async def recent(self, entity_ids: list[str], window: timedelta) -> list[SignalHistory]:
        if not entity_ids:
            return []
        rows = await self._read(_RECENT, {"entities": entity_ids, "window": window, "number": _NUMBER})
        return [
            SignalHistory(
                entity_id=entity_id,
                attribute=short_name(attribute_id),
                last=last,
                last_at=last_at,
                count=count,
                minimum=minimum,
                maximum=maximum,
                trend=trend(change, spread, average),
            )
            for entity_id, attribute_id, last, last_at, count, minimum, maximum, average, spread, change in rows
        ]

    async def metrics(self, entity_id: str, attribute: str, window: timedelta, bucket: timedelta) -> list[Bucket]:
        escaped = attribute.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = await self._read(
            _METRICS,
            {
                "entity": entity_id,
                "attribute": attribute,
                "suffix": f"%/{escaped}",
                "fragment": f"%#{escaped}",
                "window": window,
                "bucket": bucket,
                "number": _NUMBER,
            },
        )
        return [
            Bucket(start=start, minimum=lo, maximum=hi, average=avg, last=last, count=n)
            for start, lo, hi, avg, last, n in rows
        ]


def short_name(attribute_id: str) -> str:
    """`https://uri.etsi.org/ngsi-ld/default-context/value` → `value`."""
    return re.split(r"[/#]", attribute_id)[-1] or attribute_id


def _describe(exc: psycopg.Error) -> str:
    # Messages from the driver may contain the host and user; keep only the kind of failure.
    if isinstance(exc, psycopg.OperationalError):
        return "Time-series store not reachable."
    if isinstance(exc, psycopg.errors.UndefinedTable):
        return "Attribute history table not found."
    return f"Time-series query failed ({type(exc).__name__})."
