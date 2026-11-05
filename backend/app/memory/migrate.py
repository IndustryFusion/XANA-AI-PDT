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
"""Applies the SQL files in `backend/migrations` once each, in file-name order."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import psycopg

from app.redact import Redactor

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
# Advisory lock key, so that two backend processes never apply the same file.
LOCK_KEY = 0x58414E41


class MigrationError(Exception):
    pass


class Migrator:
    """Applies pending migrations and remembers the outcome for the health report."""

    def __init__(
        self, url: str, directory: Path = MIGRATIONS_DIR, redactor: Redactor | None = None, connect_timeout: float = 3
    ) -> None:
        self._url = url
        self._directory = directory
        self._redact = redactor or Redactor()
        self._connect_timeout = max(1, round(connect_timeout))
        self._lock = asyncio.Lock()
        self.up_to_date = False
        self.applied: list[str] = []
        self.error: str | None = None

    def files(self) -> list[Path]:
        return sorted(self._directory.glob("*.sql"), key=lambda p: p.name)

    async def apply(self) -> list[str]:
        """Applies pending migrations; returns the names applied now. Raises on failure."""
        async with self._lock:
            newly: list[str] = []
            async with await psycopg.AsyncConnection.connect(
                self._url, autocommit=True, connect_timeout=self._connect_timeout
            ) as conn:
                await conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
                try:
                    applied = await self._applied(conn)
                    for path in self.files():
                        if path.name in applied:
                            continue
                        try:
                            async with conn.transaction():
                                await conn.execute(path.read_text(encoding="utf-8"))
                                await conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                        except psycopg.Error as error:
                            self.error = f"Migration {path.name} failed: {self._redact(error)}"
                            self.up_to_date = False
                            log.error(self.error)
                            raise MigrationError(self.error) from None
                        newly.append(path.name)
                        log.info("Applied migration %s", path.name)
                finally:
                    await conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
            self.applied = sorted(applied | set(newly))
            self.error = None
            self.up_to_date = True
            return newly

    async def try_apply(self) -> bool:
        """Like `apply`, but reports failure as False instead of raising."""
        try:
            await self.apply()
        except MigrationError:
            return False
        except (psycopg.Error, OSError) as error:
            log.warning("Memory database not reachable; migrations pending: %s", self._redact(error))
            return False
        return True

    @staticmethod
    async def _applied(conn: psycopg.AsyncConnection) -> set[str]:
        cur = await conn.execute("SELECT to_regclass('schema_migrations')")
        if (await cur.fetchone())[0] is None:
            return set()
        cur = await conn.execute("SELECT name FROM schema_migrations")
        return {row[0] for row in await cur.fetchall()}
