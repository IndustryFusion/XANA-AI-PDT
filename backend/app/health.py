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
"""Health of the backend's dependencies: memory, time-series store, context broker, language model."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Literal

import httpx
import psycopg

from app.config import Settings
from app.dataspace.gateway import GatewayClient
from app.errors import Refused
from app.events.subscription import ACTIVE, DELIVERY_FAILING, NOT_CONFIGURED, TENANT_LIMIT, WAITING, MachineWatch
from app.ifric import RegistryClient
from app.memory.migrate import Migrator
from app.redact import mask_url

log = logging.getLogger(__name__)

Status = Literal["ok", "degraded", "error"]
Probe = Callable[[], Awaitable[tuple[Status, str]]]

UNCONFIRMED = "could not be confirmed, so it is assumed to be available"
NO_DATASPACE = "No dataspace is configured"
NO_REGISTRY = "No IFRIC registry is configured"
NO_EVENTS = (
    "Machine events aren't configured: CALLBACK_BASE_URL is not set. A subscription made earlier stays in the "
    "context broker, and goes on delivering, until it is deleted there"
)
NO_MODEL_LIST = (404, 405, 501)  # an OpenAI-compatible server need not offer a model list

LABELS = {
    "memory": "Memory database",
    "timeseries": "Time-series store",
    "broker": "Context broker",
    "llm": "Language model",
    "gateway": "Dataspace gateway",
    "connector": "Dataspace connector",
    "ifric": "IFRIC registry",
    "machine_events": "Machine events",
}


@dataclass
class Check:
    id: str
    label: str
    status: Status
    latency_ms: int | None
    detail: str


def overall(statuses: list[Status]) -> Status:
    if all(s == "ok" for s in statuses):
        return "ok"
    if all(s == "error" for s in statuses):
        return "error"
    return "degraded"


class HealthService:
    """Runs the checks concurrently, each with a timeout, and caches the report briefly."""

    def __init__(
        self,
        settings: Settings,
        migrator: Migrator,
        probes: dict[str, Probe] | None = None,
        clock: Callable[[], float] = time.monotonic,
        transport: httpx.AsyncBaseTransport | None = None,
        token: Callable[[], str | None] | None = None,
        gateway: GatewayClient | None = None,
        registry: RegistryClient | None = None,
        machine_watch: MachineWatch | None = None,
    ) -> None:
        self._machine_watch = machine_watch
        self._registry = registry
        self._token = token
        self._gateway = gateway
        self._s = settings
        self._transport = transport
        self._migrator = migrator
        self._redact = settings.redactor()
        self._probes = probes or {
            "memory": self._memory,
            "timeseries": self._timeseries,
            "broker": self._broker,
            "llm": self._llm,
            "gateway": self._gateway_check,
            "connector": self._connector_check,
            "ifric": self._ifric_check,
            "machine_events": self._machine_events_check,
        }
        self._clock = clock
        self._cached: tuple[float, dict] | None = None
        self._lock = asyncio.Lock()

    async def report(self, fresh: bool = False) -> dict:
        async with self._lock:
            now = self._clock()
            if not fresh and self._cached and now - self._cached[0] < self._s.health_cache_s:
                return self._cached[1]
            checks = await asyncio.gather(*(self._run(cid, probe) for cid, probe in self._probes.items()))
            result = {
                "overall": overall(
                    [c.status for c in checks if c.detail not in (NO_DATASPACE, NO_REGISTRY, NO_EVENTS)]
                ),
                "checked_at": datetime.now(UTC).isoformat(),
                "checks": [asdict(c) for c in checks],
                "models": self._models(checks),
            }
            self._cached = (now, result)
            return result

    async def model_problem(self) -> str | None:
        """Why the language model cannot be used right now, or None. Bounded by the check timeout."""
        probe = self._probes.get("llm")
        if probe is None:
            return None
        check = await self._run("llm", probe)
        return None if _usable(check) else f"The language model is not available: {check.detail}"

    def _models(self, checks: list[Check]) -> list[dict[str, object]]:
        s = self._s
        available = any(c.id == "llm" and _usable(c) for c in checks)
        name = "scripted" if s.llm_provider == "scripted" else s.llm_model
        return [{"name": name, "role": "agent", "provider": s.llm_label, "available": available}]

    async def _run(self, cid: str, probe: Probe) -> Check:
        start = time.perf_counter()
        timeout = self._s.health_timeout_s
        try:
            status, detail = await asyncio.wait_for(probe(), timeout)
        except TimeoutError:
            status, detail = "error", f"No answer within {timeout:g} s"
        except Exception as error:  # noqa: BLE001 - every failure is a reportable state
            status, detail = "error", _describe(error)
        detail = self._redact(detail)
        if status != "ok":
            log.warning("Health check %s: %s (%s)", cid, status, detail)
        latency = round((time.perf_counter() - start) * 1000)
        return Check(cid, LABELS.get(cid, cid), status, latency, detail)

    # Probes ------------------------------------------------------------------

    async def _memory(self) -> tuple[Status, str]:
        url = self._s.postgres_memory_url.get_secret_value()
        await _select_one(url, self._s.health_timeout_s)
        if not self._migrator.up_to_date:
            await self._migrator.try_apply()
        if self._migrator.error:
            return "error", self._migrator.error
        if not self._migrator.up_to_date:
            return "error", f"Reachable at {mask_url(url)}, but the schema could not be updated"
        migrations = _plural(len(self._migrator.applied), "migration")
        return "ok", f"Reachable at {mask_url(url)}; schema up to date ({migrations})"

    async def _timeseries(self) -> tuple[Status, str]:
        url = self._s.timescale_db_url.get_secret_value()
        table = self._s.timescale_table
        async with await _connect(url, self._s.health_timeout_s) as conn:
            cur = await conn.execute("SELECT to_regclass(%s)", (table,))
            exists = (await cur.fetchone())[0] is not None
        if not exists:
            return "degraded", f"Reachable at {mask_url(url)}, but table {table} does not exist"
        return "ok", f"Reachable at {mask_url(url)}; table {table} present"

    async def _broker(self) -> tuple[Status, str]:
        headers = {"Accept": "application/json"}
        if self._s.ngsi_tenant:
            headers["NGSILD-Tenant"] = self._s.ngsi_tenant
        if self._token and (token := self._token()):
            headers["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(timeout=self._s.health_timeout_s, transport=self._transport) as client:
            response = await client.get(f"{self._s.ngsi_url.rstrip('/')}/ngsi-ld/v1/types", headers=headers)
        if response.status_code != 200:
            return "error", f"{self._s.ngsi_url} answered HTTP {response.status_code}"
        return "ok", f"Reachable at {self._s.ngsi_url}"

    async def _llm(self) -> tuple[Status, str]:
        s = self._s
        if s.llm_provider == "scripted":
            return "ok", "Scripted answers, no model"
        # Shorter than the check's own limit, so that a slow answer can be told from no answer.
        limit = httpx.Timeout(s.health_timeout_s * 0.8)
        async with httpx.AsyncClient(timeout=limit, transport=self._transport) as client:
            try:
                return await self._llm_state(client)
            except httpx.ReadTimeout:
                return "degraded", f"{self._label()} did not list its models in time; the model {UNCONFIRMED}"

    async def _gateway_check(self) -> tuple[Status, str]:
        if self._gateway is None or not self._s.gateway_url:
            return "ok", NO_DATASPACE
        await self._gateway.healthy()
        return "ok", f"Reachable at {self._s.gateway_url}"

    async def _connector_check(self) -> tuple[Status, str]:
        if self._gateway is None or not self._s.gateway_url:
            return "ok", NO_DATASPACE
        if self._gateway.connection.token() is None:
            return "degraded", "Not connected to the dataspace, so the path to the connector can't be checked"
        await self._gateway.request("GET", "/capabilities/requests", params={"status": "pending"})
        return "ok", "The participant's adapter answers; the connector behind it can't be checked from here"

    async def _ifric_check(self) -> tuple[Status, str]:
        if self._registry is None or not self._registry.configured:
            return "ok", NO_REGISTRY
        participant = self._gateway.connection.participant_id if self._gateway else None
        return await self._registry.check(participant)

    async def _machine_events_check(self) -> tuple[Status, str]:
        watch = self._machine_watch
        if watch is None or watch.state == NOT_CONFIGURED:
            return "ok", NO_EVENTS
        if watch.state == ACTIVE:
            return "ok", watch.detail
        return ("degraded" if watch.state in (WAITING, DELIVERY_FAILING, TENANT_LIMIT) else "error"), watch.detail

    def _label(self) -> str:
        return (self._s.llm_provider_name or "Ollama") if self._s.llm_provider == "ollama" else self._s.llm_label

    async def _llm_state(self, client: httpx.AsyncClient) -> tuple[Status, str]:
        s = self._s
        model = s.llm_model
        label = self._label()
        if s.llm_provider == "ollama":
            response = await client.get(f"{s.ollama_url.rstrip('/')}/api/tags")
            response.raise_for_status()
            names = {m.get("name", "") for m in response.json().get("models", [])}
            if model in names or f"{model}:latest" in names:
                return "ok", f"{label} at {s.ollama_url}, model {model} available"
            return "degraded", f"{label} at {s.ollama_url} is reachable, but model {model} is not downloaded yet"
        if s.llm_provider == "anthropic":
            # The list is not searched for the model: it is paged, and aliases aren't listed.
            # A wrong model name shows when the first request fails.
            response = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": s.anthropic_api_key.get_secret_value(), "anthropic-version": "2023-06-01"},
            )
        else:
            base = (s.openai_base_url or "https://api.openai.com/v1").rstrip("/")
            key = s.openai_api_key
            headers = {"Authorization": f"Bearer {key.get_secret_value()}"} if key else {}
            response = await client.get(f"{base}/models", headers=headers)
            if response.status_code in NO_MODEL_LIST:
                return "degraded", f"{label} does not list its models; the model {UNCONFIRMED}"
            if response.status_code == 200 and not _lists_model(response, model):
                return "degraded", f"{label} is reachable, but does not list model {model}"
        if response.status_code in (401, 403):
            return "error", f"{label} rejected the API key"
        if response.status_code != 200:
            return "error", f"{label} answered HTTP {response.status_code}"
        return "ok", f"{label} reachable, model {model}"


async def _connect(url: str, connect_timeout_s: float) -> psycopg.AsyncConnection:
    return await psycopg.AsyncConnection.connect(url, connect_timeout=max(1, round(connect_timeout_s)), autocommit=True)


async def _select_one(url: str, connect_timeout_s: float) -> None:
    async with await _connect(url, connect_timeout_s) as conn:
        await conn.execute("SELECT 1")


def _usable(check: Check) -> bool:
    """Whether a language model check allows work to start: a list that can't be read proves nothing."""
    return check.status == "ok" or (check.status == "degraded" and check.detail.endswith(UNCONFIRMED))


def _lists_model(response: httpx.Response, model: str) -> bool:
    """Whether an OpenAI-style model list holds `model`. A list without entries proves nothing."""
    try:
        listed = {str(item.get("id")) for item in response.json().get("data", [])}
    except (ValueError, AttributeError):
        return True
    return not listed or model in listed


def _describe(error: Exception) -> str:
    if isinstance(error, Refused):
        return error.message
    if isinstance(error, httpx.ConnectError | psycopg.OperationalError | OSError):
        return f"Not reachable: {str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__}"
    if isinstance(error, httpx.HTTPStatusError):
        return f"Answered HTTP {error.response.status_code}"
    return f"{type(error).__name__}: {error}"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"
