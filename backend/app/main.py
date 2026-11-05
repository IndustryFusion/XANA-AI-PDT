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
"""Application factory."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api import diagnostics
from app.config import Settings, load_settings
from app.health import HealthService
from app.memory.migrate import Migrator
from app.redact import RedactingFilter, Redactor

log = logging.getLogger(__name__)


def configure_logging(settings: Settings, redactor: Redactor) -> None:
    """Root logging with secret redaction; uvicorn is started with `log_config=None` so it uses this."""
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter(redactor))
    logging.basicConfig(level=settings.log_level, handlers=[handler], force=True)


def create_app(settings: Settings | None = None, health: HealthService | None = None) -> FastAPI:
    settings = settings or load_settings()
    redactor = settings.redactor()
    migrator = Migrator(
        settings.postgres_memory_url.get_secret_value(), redactor=redactor, connect_timeout=settings.health_timeout_s
    )
    health = health or HealthService(settings, migrator)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Startup never waits for, or fails on, a dependency: migrations that cannot run now
        # run later from the memory health check.
        task = asyncio.create_task(migrator.try_apply())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(title="XANA AI PDT backend", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.migrator = migrator
    app.state.health = health
    app.include_router(diagnostics.router)
    return app
