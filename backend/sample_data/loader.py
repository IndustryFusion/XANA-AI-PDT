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
"""Loads the sample machine data into the context broker and the time-series store.

Entities are created only when missing, so changes made to them later are kept.
History is written once (recorded in `xana_sample_data`) and ends at load time.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import psycopg
from psycopg import sql

from app.config import Settings
from app.redact import mask_url

log = logging.getLogger(__name__)

DATA_FILE = Path(__file__).with_name("sample-data.json")
DDL_FILE = Path(__file__).with_name("attributes.sql")
DEFAULT_VOCAB = "https://uri.etsi.org/ngsi-ld/default-context/"
XSD = "http://www.w3.org/2001/XMLSchema#"
MARKER = "attribute-history"
BATCH = 50


def read_sample_data(path: Path = DATA_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _broker_headers(settings: Settings) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.ngsi_tenant:
        headers["NGSILD-Tenant"] = settings.ngsi_tenant
    return headers


def wait_for_broker(settings: Settings, client: httpx.Client, timeout_s: float) -> None:
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            if client.get(f"{settings.ngsi_url}/ngsi-ld/v1/types", headers=_broker_headers(settings)).status_code < 500:
                return
        except httpx.TransportError:
            pass
        if time.monotonic() > deadline:
            raise TimeoutError(f"Context broker at {settings.ngsi_url} did not answer within {timeout_s:g} s")
        time.sleep(3)


def load_entities(settings: Settings, entities: list[dict], client: httpx.Client) -> tuple[int, int]:
    """Creates missing entities; returns (created, already present)."""
    created = existing = 0
    url = f"{settings.ngsi_url}/ngsi-ld/v1/entityOperations/create"
    for start in range(0, len(entities), BATCH):
        batch = entities[start : start + BATCH]
        response = client.post(url, json=batch, headers=_broker_headers(settings))
        if response.status_code == 201:
            created += len(batch)
            continue
        if response.status_code != 207:
            raise RuntimeError(f"Creating entities failed: HTTP {response.status_code} {response.text[:300]}")
        body = response.json()
        created += len(body.get("success", []))
        for error in body.get("errors", []):
            if error.get("error", {}).get("status") == 409 or "lready" in json.dumps(error):
                existing += 1
            else:
                raise RuntimeError(f"Creating entity {error.get('entityId')} failed: {error.get('error')}")
    return created, existing


def history_rows(history: list[dict], now: datetime) -> list[tuple]:
    """Rows for the attribute table; each series ends at `now`."""
    rows = []
    for item in history:
        step = timedelta(seconds=item["stepSeconds"])
        values = item["values"]
        attribute_id = f"{DEFAULT_VOCAB}{item['attribute']}"
        for i, value in enumerate(values):
            at = now - step * (len(values) - 1 - i)
            value_type = f"{XSD}double" if isinstance(value, int | float) else f"{XSD}string"
            rows.append((at, item["entityId"], attribute_id, str(value), value_type))
    return rows


def load_history(settings: Settings, history: list[dict], now: datetime | None = None) -> int:
    """Writes the history once; returns the number of rows written (0 if already loaded)."""
    table = settings.timescale_table
    ddl = DDL_FILE.read_text(encoding="utf-8")
    ddl = sql.SQL(ddl).format(
        table=sql.Identifier(*table.split(".")), index=sql.Identifier(f"{table.split('.')[-1]}_entity_time")
    )
    with psycopg.connect(settings.timescale_db_url.get_secret_value(), connect_timeout=10) as conn:
        conn.execute(ddl)
        if conn.execute("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'").fetchone():
            conn.execute(
                "SELECT create_hypertable(%s, 'observedAt', if_not_exists => TRUE, migrate_data => TRUE)", (table,)
            )
        if conn.execute("SELECT 1 FROM xana_sample_data WHERE name = %s", (MARKER,)).fetchone():
            return 0
        rows = history_rows(history, now or datetime.now(UTC).replace(microsecond=0))
        insert = sql.SQL(
            'INSERT INTO {} ("observedAt", "entityId", "attributeId", "value", "valueType") VALUES (%s, %s, %s, %s, %s)'
        ).format(sql.Identifier(*table.split(".")))
        with conn.cursor() as cur:
            cur.executemany(insert, rows)
        conn.execute("INSERT INTO xana_sample_data (name) VALUES (%s)", (MARKER,))
    return len(rows)


def load(settings: Settings, broker_wait_s: float = 300) -> None:
    data = read_sample_data()
    with httpx.Client(timeout=30) as client:
        wait_for_broker(settings, client, broker_wait_s)
        created, existing = load_entities(settings, data["entities"], client)
    log.info("Entities: %d created, %d already present (%s)", created, existing, settings.ngsi_url)
    rows = load_history(settings, data["history"])
    target = mask_url(settings.timescale_db_url.get_secret_value())
    if rows:
        log.info("Attribute history: %d rows written to %s", rows, target)
    else:
        log.info("Attribute history already loaded in %s", target)
