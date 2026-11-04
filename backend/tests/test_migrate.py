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
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.health import HealthService
from app.main import create_app
from app.memory.migrate import MIGRATIONS_DIR, MigrationError, Migrator
from tests.conftest import make_settings

pytestmark = pytest.mark.db


def applied(url):
    with psycopg.connect(url) as conn:
        return [r[0] for r in conn.execute("SELECT name FROM schema_migrations ORDER BY name")]


def write(directory, name, sql):
    (directory / name).write_text(sql)


@pytest.fixture
def migrations(tmp_path):
    for path in MIGRATIONS_DIR.glob("*.sql"):
        write(tmp_path, path.name, path.read_text())
    write(tmp_path, "002_things.sql", "CREATE TABLE things (id INT PRIMARY KEY);")
    return tmp_path


async def test_empty_database_gets_all_migrations_in_order(fresh_database, migrations):
    url = fresh_database()
    newly = await Migrator(url, migrations).apply()
    assert newly == ["001_schema_migrations.sql", "002_things.sql"]
    assert applied(url) == newly


async def test_restart_applies_nothing_and_keeps_data(fresh_database, migrations):
    url = fresh_database()
    await Migrator(url, migrations).apply()
    with psycopg.connect(url) as conn:
        conn.execute("INSERT INTO things VALUES (1)")
    assert await Migrator(url, migrations).apply() == []
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT count(*) FROM things").fetchone()[0] == 1


async def test_only_new_migration_applied(fresh_database, migrations):
    url = fresh_database()
    await Migrator(url, migrations).apply()
    write(migrations, "003_more.sql", "ALTER TABLE things ADD COLUMN label TEXT;")
    assert await Migrator(url, migrations).apply() == ["003_more.sql"]


async def test_failing_migration_leaves_nothing(fresh_database, migrations):
    url = fresh_database()
    await Migrator(url, migrations).apply()
    write(migrations, "003_broken.sql", "CREATE TABLE half_done (id INT); SELECT * FROM missing_table;")
    migrator = Migrator(url, migrations)
    with pytest.raises(MigrationError, match="003_broken.sql"):
        await migrator.apply()
    assert "003_broken.sql" not in applied(url)
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT to_regclass('half_done')").fetchone()[0] is None

    s = make_settings(postgres_memory_url=url)
    status, detail = await HealthService(s, migrator)._memory()
    assert status == "error"
    assert "003_broken.sql" in detail


async def test_memory_reachable_later(fresh_database):
    url = fresh_database(create=False)
    with TestClient(create_app(make_settings(postgres_memory_url=url))) as client:
        memory = next(c for c in client.get("/api/diagnostics?fresh=true").json()["checks"] if c["id"] == "memory")
        assert memory["status"] == "error"
        fresh_database.create_later(url)
        memory = next(c for c in client.get("/api/diagnostics?fresh=true").json()["checks"] if c["id"] == "memory")
    assert memory["status"] == "ok", memory
    assert applied(url) == ["001_schema_migrations.sql"]


async def test_concurrent_runners_apply_once(fresh_database, migrations):
    import asyncio

    url = fresh_database()
    results = await asyncio.gather(Migrator(url, migrations).apply(), Migrator(url, migrations).apply())
    assert sorted(len(r) for r in results) == [0, 2]
