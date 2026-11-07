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
"""The memory database: runs, incident records and the workflow's memory of confirmed diagnoses."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool, PoolTimeout

from app.redact import Redactor
from app.runs.model import COMPLETED, FAILED, STOPPED, RunState
from xana_agent import IncidentRecord, PastIncident
from xana_agent.sources.base import SourceUnavailable

log = logging.getLogger(__name__)


class StoreUnavailable(Exception):
    """The memory database could not be used. The message is safe to show."""


class Database:
    """A small connection pool, opened at startup without waiting for the database."""

    def __init__(self, url: str, timeout_s: float = 3, redactor: Redactor | None = None) -> None:
        self._url = url
        self._timeout = timeout_s
        self._redact = redactor or Redactor()
        self._pool: AsyncConnectionPool | None = None

    async def open(self) -> None:
        if self._pool is None:
            self._pool = AsyncConnectionPool(
                self._url,
                min_size=1,
                max_size=5,
                open=False,
                timeout=self._timeout,
                kwargs={"connect_timeout": max(1, round(self._timeout)), "autocommit": True},
                check=AsyncConnectionPool.check_connection,
                name="memory",
            )
            await self._pool.open(wait=False)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @contextlib.asynccontextmanager
    async def transaction(self) -> AsyncIterator[psycopg.AsyncConnection]:
        """A connection inside one transaction. Database failures become `StoreUnavailable`."""
        await self.open()
        try:
            async with self._pool.connection() as conn, conn.transaction():
                conn.row_factory = dict_row
                yield conn
        except PoolTimeout:
            raise StoreUnavailable("The memory database is not reachable.") from None
        except psycopg.Error as error:
            log.warning("Memory database error: %s", self._redact(error))
            raise StoreUnavailable("The memory database could not complete the request.") from None


# ── Runs ─────────────────────────────────────────────────────────────────────


class RunStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def save(self, run: RunState) -> RunState:
        """Writes the run in one transaction and returns it as stored.

        A run that has left `running` without an incident number receives the next one here.
        """
        async with self._db.transaction() as conn:
            if run.incident_id is None and run.status != "running":
                cur = await conn.execute("SELECT nextval('incident_number') AS number")
                run = replace(run, incident_id=(await cur.fetchone())["number"])
            await conn.execute(
                """
                INSERT INTO runs (run_id, incident_number, machine_id, issue, status, data, steps, round,
                                  clarifications, rejected, started_at, updated_at,
                                  escalation, outbox, conversation_id, attempt)
                VALUES (%(run_id)s, %(incident_id)s, %(machine_id)s, %(issue)s, %(status)s, %(data)s, %(steps)s,
                        %(round)s, %(clarifications)s, %(rejected)s, %(started_at)s, %(updated_at)s,
                        %(escalation)s, %(outbox)s, %(conversation_id)s, %(attempt)s)
                ON CONFLICT (run_id) DO UPDATE SET
                    incident_number = EXCLUDED.incident_number, status = EXCLUDED.status, data = EXCLUDED.data,
                    steps = EXCLUDED.steps, round = EXCLUDED.round, clarifications = EXCLUDED.clarifications,
                    rejected = EXCLUDED.rejected, updated_at = EXCLUDED.updated_at,
                    escalation = EXCLUDED.escalation, outbox = EXCLUDED.outbox,
                    conversation_id = EXCLUDED.conversation_id, attempt = EXCLUDED.attempt
                """,
                _run_row(run),
            )
        return run

    async def load(self) -> list[RunState]:
        async with self._db.transaction() as conn:
            cur = await conn.execute("SELECT * FROM runs ORDER BY started_at")
            rows = await cur.fetchall()
        return [
            RunState(
                run_id=r["run_id"],
                machine_id=r["machine_id"],
                issue=r["issue"],
                status=r["status"],
                started_at=r["started_at"],
                updated_at=r["updated_at"],
                data=r["data"],
                steps=tuple(r["steps"]),
                round=r["round"],
                clarifications=tuple(r["clarifications"]),
                rejected=tuple(r["rejected"]),
                incident_id=r["incident_number"],
                escalation=r["escalation"],
                outbox=tuple(r["outbox"]),
                conversation_id=r["conversation_id"],
                attempt=r["attempt"],
            )
            for r in rows
        ]


def _run_row(run: RunState) -> dict[str, Any]:
    return {
        "run_id": run.run_id,
        "incident_id": run.incident_id,
        "machine_id": run.machine_id,
        "issue": run.issue,
        "status": run.status,
        "data": Jsonb(run.data),
        "steps": Jsonb(list(run.steps)),
        "round": run.round,
        "clarifications": Jsonb(list(run.clarifications)),
        "rejected": Jsonb(list(run.rejected)),
        "started_at": run.started_at,
        "updated_at": run.updated_at,
        "escalation": Jsonb(run.escalation) if run.escalation is not None else None,
        "outbox": Jsonb(list(run.outbox)),
        "conversation_id": run.conversation_id,
        "attempt": Jsonb(run.attempt) if run.attempt is not None else None,
    }


# ── Incidents ────────────────────────────────────────────────────────────────

OUTCOMES = (COMPLETED, FAILED, STOPPED, "mb_closed")


def resolution_text(run: RunState) -> str | None:
    match run.status:
        case "completed":
            return run.data.get("recommended_action")
        case "stopped":
            return run.data.get("reason") or "Stopped by the operator."
        case "failed":
            return f"The run failed: {run.data.get('error')}"
    return None


class IncidentStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    def memory_for(self, run: RunState) -> PostgresIncidentMemory:
        return PostgresIncidentMemory(self._db, run)

    async def archive(self, run: RunState, at: datetime) -> int:
        """Writes the run's history record with its full trace and removes the run, in one transaction."""
        decision = run.last_decision()
        completed = run.status == COMPLETED
        source = run.data if completed else decision or {}
        async with self._db.transaction() as conn:
            cur = await conn.execute(
                """
                INSERT INTO incidents (number, run_id, machine_id, machine_type, issue, outcome, root_cause,
                                       recommended_action, decision, resolution, started_at, closed_at, archived_at,
                                       builder, escalation, conversation_id)
                VALUES (COALESCE(%(number)s, nextval('incident_number')), %(run_id)s, %(machine_id)s,
                        %(machine_type)s, %(issue)s, %(outcome)s, %(root_cause)s, %(recommended_action)s,
                        %(decision)s, %(resolution)s, %(started_at)s, %(at)s, %(at)s,
                        %(builder)s, %(escalation)s, %(conversation_id)s)
                ON CONFLICT (run_id) DO UPDATE SET
                    number = EXCLUDED.number,
                    machine_type = COALESCE(EXCLUDED.machine_type, incidents.machine_type),
                    outcome = EXCLUDED.outcome, root_cause = EXCLUDED.root_cause,
                    recommended_action = EXCLUDED.recommended_action, decision = EXCLUDED.decision,
                    resolution = EXCLUDED.resolution, closed_at = EXCLUDED.closed_at,
                    archived_at = EXCLUDED.archived_at, builder = EXCLUDED.builder,
                    escalation = EXCLUDED.escalation, conversation_id = EXCLUDED.conversation_id
                RETURNING id
                """,
                {
                    "number": run.incident_id,
                    "run_id": run.run_id,
                    "machine_id": run.machine_id,
                    "machine_type": _machine_type(run),
                    "issue": run.issue,
                    "outcome": run.status,
                    "root_cause": source.get("root_cause"),
                    "recommended_action": source.get("recommended_action"),
                    "decision": Jsonb(decision) if decision is not None else None,
                    "resolution": resolution_text(run),
                    "started_at": run.started_at,
                    "at": at,
                    "builder": run.escalation["recipient"]["name"] if run.escalation else None,
                    "escalation": Jsonb(run.escalation) if run.escalation else None,
                    "conversation_id": run.conversation_id,
                },
            )
            incident_id = (await cur.fetchone())["id"]
            await _write_trace(conn, incident_id, list(run.steps))
            await conn.execute("DELETE FROM runs WHERE run_id = %s", (run.run_id,))
        return incident_id

    async def list(
        self,
        machine_id: str | None = None,
        outcomes: list[str] | None = None,
        closed_from: date | None = None,
        closed_to: date | None = None,
    ) -> list[dict[str, Any]]:
        """History records, newest first. The date range is inclusive and read in UTC."""
        where = ["archived_at IS NOT NULL"]
        params: dict[str, Any] = {}
        if machine_id:
            where.append("machine_id = %(machine_id)s")
            params["machine_id"] = machine_id
        if outcomes:
            where.append("outcome = ANY(%(outcomes)s)")
            params["outcomes"] = outcomes
        if closed_from:
            where.append("closed_at >= %(after)s")
            params["after"] = datetime.combine(closed_from, time.min, UTC)
        if closed_to:
            where.append("closed_at < %(before)s")
            params["before"] = datetime.combine(closed_to + timedelta(days=1), time.min, UTC)
        query = f"SELECT * FROM incidents WHERE {' AND '.join(where)} ORDER BY closed_at DESC, id DESC"  # noqa: S608
        async with self._db.transaction() as conn:
            cur = await conn.execute(query, params)
            return [_incident_summary(r) for r in await cur.fetchall()]

    async def get(self, incident_id: int) -> dict[str, Any] | None:
        """A history record with its decision, resolution and trace."""
        async with self._db.transaction() as conn:
            cur = await conn.execute(
                "SELECT * FROM incidents WHERE id = %s AND archived_at IS NOT NULL", (incident_id,)
            )
            row = await cur.fetchone()
            if row is None:
                return None
            cur = await conn.execute("SELECT * FROM agent_traces WHERE incident_id = %s ORDER BY step", (incident_id,))
            trace = [
                {
                    "node": t["action"],
                    "input": t["input"],
                    "output": t["output"],
                    "at": t["timestamp"].isoformat(),
                    "round": t["round"],
                }
                for t in await cur.fetchall()
            ]
        return _incident_summary(row) | {
            "decision": row["decision"],
            "resolution": row["resolution"],
            "builder": row["builder"],
            "escalation": row["escalation"],
            "conversation_id": row["conversation_id"],
            "conversation": [],
            "trace": trace,
            "run_id": row["run_id"],
        }

    async def set_reopened(self, incident_id: int, run_id: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute("UPDATE incidents SET reopened_run_id = %s WHERE id = %s", (run_id, incident_id))


def _incident_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "number": row["number"],
        "machine_id": row["machine_id"],
        "issue": row["issue"],
        "outcome": row["outcome"],
        "root_cause": row["root_cause"],
        "escalated": row["escalation"] is not None,
        "escalation_ref": row["escalation"]["ref"] if row["escalation"] else None,
        "started_at": row["started_at"].isoformat(),
        "closed_at": row["closed_at"].isoformat(),
        "reopened_run_id": row["reopened_run_id"],
    }


def _machine_type(run: RunState) -> str | None:
    for step in reversed(run.steps):
        if step["node"] in ("decide", "observe") and step["output"].get("machine_type"):
            return step["output"]["machine_type"]
    return None


async def _write_trace(conn: psycopg.AsyncConnection, incident_id: int, steps: list[dict[str, Any]]) -> None:
    await conn.execute("DELETE FROM agent_traces WHERE incident_id = %s", (incident_id,))
    if not steps:
        return
    async with conn.cursor() as cur:
        await cur.executemany(
            """
            INSERT INTO agent_traces (incident_id, step, round, action, input, output, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    incident_id,
                    n,
                    s.get("round", 1),
                    s["node"],
                    Jsonb(s.get("input")),
                    Jsonb(s.get("output")),
                    datetime.fromisoformat(s["at"]),
                )
                for n, s in enumerate(steps, start=1)
            ],
        )


class PostgresIncidentMemory:
    """The workflow's incident memory for one run: confirmed diagnoses in the `incidents` table."""

    def __init__(self, db: Database, run: RunState) -> None:
        self._db = db
        self._run = run

    async def similar(self, machine_id: str, machine_type: str | None, limit: int) -> list[PastIncident]:
        try:
            async with self._db.transaction() as conn:
                cur = await conn.execute(
                    """
                    SELECT id, machine_id, machine_type, issue, root_cause, recommended_action, confirmed_at
                    FROM incidents
                    WHERE confirmed AND run_id <> %(run_id)s
                      AND (machine_id = %(machine_id)s
                           OR (%(machine_type)s::text IS NOT NULL AND machine_type = %(machine_type)s))
                    ORDER BY (machine_id = %(machine_id)s) DESC, confirmed_at DESC, id DESC
                    LIMIT %(limit)s
                    """,
                    {
                        "run_id": self._run.run_id,
                        "machine_id": machine_id,
                        "machine_type": machine_type,
                        "limit": limit,
                    },
                )
                rows = await cur.fetchall()
        except StoreUnavailable as error:
            raise SourceUnavailable(f"Incident memory: {error}") from None
        return [
            PastIncident(
                incident_id=str(r["id"]),
                machine_id=r["machine_id"],
                machine_type=r["machine_type"],
                issue=r["issue"],
                root_cause=r["root_cause"],
                resolution=r["recommended_action"] or "",
                resolved_at=r["confirmed_at"],
            )
            for r in rows
        ]

    async def store(self, record: IncidentRecord) -> str:
        """Records the confirmed diagnosis. Storing the same run again updates its record."""
        run = self._run
        try:
            async with self._db.transaction() as conn:
                cur = await conn.execute(
                    """
                    INSERT INTO incidents (number, run_id, machine_id, machine_type, issue, root_cause,
                                           recommended_action, confirmed, confirmed_at, started_at)
                    VALUES (COALESCE(%(number)s, nextval('incident_number')), %(run_id)s, %(machine_id)s,
                            %(machine_type)s, %(issue)s, %(root_cause)s, %(action)s, true, now(), %(started_at)s)
                    ON CONFLICT (run_id) DO UPDATE SET
                        machine_type = EXCLUDED.machine_type, root_cause = EXCLUDED.root_cause,
                        recommended_action = EXCLUDED.recommended_action, confirmed = true,
                        confirmed_at = COALESCE(incidents.confirmed_at, EXCLUDED.confirmed_at)
                    RETURNING id
                    """,
                    {
                        "number": run.incident_id,
                        "run_id": run.run_id,
                        "machine_id": record.machine_id,
                        "machine_type": record.machine_type,
                        "issue": record.issue,
                        "root_cause": record.root_cause,
                        "action": record.recommended_action,
                        "started_at": run.started_at,
                    },
                )
                incident_id = (await cur.fetchone())["id"]
                await _write_trace(conn, incident_id, record.trace)
        except StoreUnavailable as error:
            raise SourceUnavailable(f"Incident memory: {error}") from None
        return str(incident_id)
