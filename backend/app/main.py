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
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import timedelta

from fastapi import FastAPI
from langchain_core.language_models import BaseChatModel

from app.api import auth, diagnostics, errors, incidents, runs, stream
from app.auth import KeycloakSession
from app.config import Settings, get_llm, load_settings
from app.health import HealthService
from app.memory.migrate import Migrator
from app.memory.store import Database, IncidentStore, RunStore
from app.redact import RedactingFilter, Redactor
from app.runs.machines import MachineResolver
from app.runs.manager import RunManager
from app.tracing import tracing_callbacks
from xana_agent import NgsiContextSource, TimescaleHistorySource, Workflow
from xana_agent.sources.base import ContextSource, HistorySource, IncidentMemory

log = logging.getLogger(__name__)


def configure_logging(settings: Settings, redactor: Redactor) -> None:
    """Root logging with secret redaction; uvicorn is started with `log_config=None` so it uses this."""
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter(redactor))
    logging.basicConfig(level=settings.log_level, handlers=[handler], force=True)


@dataclass(frozen=True)
class AgentDeps:
    """What the diagnostic workflow reads from, and how a short machine name is resolved."""

    llm: BaseChatModel
    context: ContextSource
    history: HistorySource
    machines: MachineResolver

    @classmethod
    def from_settings(cls, s: Settings, token: Callable[[], str | None] | None = None) -> AgentDeps:
        return cls(
            llm=get_llm(s),
            context=NgsiContextSource(s.ngsi_url, s.ngsi_tenant, token=token),
            history=TimescaleHistorySource(s.timescale_db_url.get_secret_value(), s.timescale_table),
            machines=MachineResolver(s.ngsi_url, s.ngsi_tenant, s.health_timeout_s, token=token),
        )


def create_app(
    settings: Settings | None = None,
    health: HealthService | None = None,
    agent: AgentDeps | None = None,
    session: KeycloakSession | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    redactor = settings.redactor()
    memory_url = settings.postgres_memory_url.get_secret_value()
    migrator = Migrator(memory_url, redactor=redactor, connect_timeout=settings.health_timeout_s)
    session = session or KeycloakSession(settings)
    health = health or HealthService(settings, migrator, token=session.token)
    agent = agent or AgentDeps.from_settings(settings, token=session.token)
    db = Database(memory_url, settings.health_timeout_s, redactor)
    incident_store = IncidentStore(db)
    callbacks = tracing_callbacks(settings)

    def workflow(memory: IncidentMemory) -> Workflow:
        return Workflow(
            agent.llm,
            agent.context,
            agent.history,
            memory,
            threshold=settings.decision_confidence_threshold,
            llm_timeout_s=settings.llm_timeout_s,
            history_window=timedelta(hours=24),
            callbacks=callbacks,
        )

    manager = RunManager(
        RunStore(db),
        incident_store,
        workflow,
        agent.machines,
        migrator,
        max_concurrent_rounds=settings.max_concurrent_rounds,
        model_problem=health.model_problem,
    )

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Startup never waits for, or fails on, a dependency. If the memory database is not
        # reachable yet, migrations and the restore of stored runs happen on the first request
        # that needs them (or from the memory health check).
        await db.open()
        task = asyncio.create_task(manager.start_up())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        try:
            await manager.shut_down()
            await session.close()
        finally:
            await db.close()

    app = FastAPI(title="XANA AI PDT backend", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.session = session
    app.state.migrator = migrator
    app.state.health = health
    app.state.runs = manager
    app.state.incidents = incident_store
    errors.install(app)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        """Liveness only: the backend works without its dependencies, so it does not check them."""
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(diagnostics.router)
    app.include_router(runs.router)
    app.include_router(incidents.router)
    app.include_router(stream.router)
    return app
