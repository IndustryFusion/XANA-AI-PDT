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
"""The dataspace client's secret, stored only encrypted, and whether the operator wants a connection."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken

from app.memory.store import Database, StoreUnavailable

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class StoredCredential:
    secret: str | None = None
    unreadable: bool = False  # a secret is stored, and this key can't read it
    connect_wanted: bool = True


class CredentialStore:
    def __init__(self, db: Database, key: str | None, ready: Callable[[], Awaitable[None]]) -> None:
        self._db = db
        self._fernet = Fernet(key) if key else None
        self._ready = ready

    async def _prepared(self) -> None:
        try:
            await self._ready()
        except StoreUnavailable:
            raise
        except Exception as error:
            log.warning("The credentials table is not usable: %s", type(error).__name__)
            raise StoreUnavailable("The memory database is not reachable.") from None

    async def read(self) -> StoredCredential:
        await self._prepared()
        async with self._db.transaction() as conn:
            cur = await conn.execute("SELECT encrypted_secret, connect_wanted FROM gateway_credentials")
            row = await cur.fetchone()
        if row is None:
            return StoredCredential()
        if not row["encrypted_secret"]:
            return StoredCredential(connect_wanted=row["connect_wanted"])
        try:
            if self._fernet is None:
                raise InvalidToken
            secret = self._fernet.decrypt(row["encrypted_secret"].encode()).decode()
        except InvalidToken:
            return StoredCredential(unreadable=True, connect_wanted=row["connect_wanted"])
        return StoredCredential(secret=secret, connect_wanted=row["connect_wanted"])

    async def save_secret(self, client_id: str, secret: str) -> None:
        """Stores the secret encrypted. There is no way to store it otherwise."""
        if self._fernet is None:
            raise StoreUnavailable("The secret can't be stored, as no encryption key is configured.")
        encrypted = self._fernet.encrypt(secret.encode()).decode()
        await self._prepared()
        async with self._db.transaction() as conn:
            await conn.execute(
                """
                INSERT INTO gateway_credentials (id, client_id, encrypted_secret, connect_wanted, updated_at)
                VALUES (true, %s, %s, true, now())
                ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id,
                    encrypted_secret = EXCLUDED.encrypted_secret, connect_wanted = true, updated_at = now()
                """,
                (client_id, encrypted),
            )

    async def set_connect_wanted(self, wanted: bool) -> None:
        await self._prepared()
        async with self._db.transaction() as conn:
            await conn.execute(
                """
                INSERT INTO gateway_credentials (id, connect_wanted, updated_at) VALUES (true, %s, now())
                ON CONFLICT (id) DO UPDATE SET connect_wanted = EXCLUDED.connect_wanted, updated_at = now()
                """,
                (wanted,),
            )
