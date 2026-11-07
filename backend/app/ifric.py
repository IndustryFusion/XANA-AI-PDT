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
"""The IFRIC registry, for the backend only: company names, machine builders and factories.

The registry is used as it is, with the dataspace token. Why each failure gives what it does is in
the `gh-27-ifric-registry` design.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.errors import invalid, not_found, unavailable

log = logging.getLogger(__name__)

SERVICE = "The IFRIC registry"
TIMEOUT_S = 10
MAX_RESOLVED = 200
DIRECTORY_FOR_S = 300  # the company directory is read again after this, or sooner with another token
ASSET_NAMES = ("asset_name", "product_name", "name")
AT_ONCE = 8


class NoBuilder(Exception):
    """A machine has no usable builder. The message is the reason, safe to show."""


class _Failed(Exception):
    """The registry gave no usable answer. The message is safe to show."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Builder:
    company_id: str
    name: str


def _segment(identifier: str) -> str:
    return quote(identifier, safe="")


def _record(answer: Any, key: str) -> dict[str, Any] | None:
    """The record in an answer: a list of them, `{key: record}`, or the record itself. None means not found."""
    if isinstance(answer, list):
        answer = answer[0] if answer else None
    elif isinstance(answer, dict) and key in answer:
        answer = answer[key]
    return answer if isinstance(answer, dict) and answer else None


class RegistryClient:
    def __init__(
        self,
        settings: Settings,
        token: Callable[[], str | None],
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = settings.ifric_url and settings.ifric_url.rstrip("/")
        self._token = token
        self._transport = transport
        self._clock = clock
        self._directory: tuple[float, str, dict[str, str]] | None = None  # when, for which token, id → name
        self._reading = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._url)

    async def _get(self, path: str) -> Any:
        if not self._url:
            raise _Failed("No IFRIC registry is configured.")
        token = self._token()
        if token is None:
            raise _Failed("Not connected to the dataspace, so the IFRIC registry can't be asked.")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.get(f"{self._url}{path}", headers=headers)
        except httpx.TimeoutException:
            raise _Failed(f"{SERVICE} did not answer in time.") from None
        except httpx.HTTPError:
            raise _Failed(f"{SERVICE} can't be reached.") from None
        if response.status_code in (401, 403):
            raise _Failed(f"{SERVICE} refused the dataspace token (HTTP {response.status_code}).", response.status_code)
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise _Failed(f"{SERVICE} failed (HTTP {response.status_code}).", response.status_code)
        try:
            return response.json()
        except ValueError:
            raise _Failed(f"{SERVICE} sent an answer that isn't JSON.") from None

    # ── Names ────────────────────────────────────────────────────────────────

    async def names(self, ids: list[str]) -> dict[str, str]:
        """`{id: name}`. An unknown ID is left out, and a failed lookup has an empty name."""
        unique = list(dict.fromkeys(ids))
        if len(unique) > MAX_RESOLVED:
            raise invalid(f"Ask for at most {MAX_RESOLVED} names at a time.")
        slots = asyncio.Semaphore(AT_ONCE)

        async def one(identifier: str) -> tuple[str, str | None]:
            async with slots:
                failed = False
                try:
                    answer = await self._get(f"/company/get-company-details/{_segment(identifier)}")
                except _Failed as failure:
                    log.info("A company's details gave no name: %s", failure)
                    answer, failed = None, True
                company = _record(answer, "company")
                name = company.get("company_name") if company else None
                if isinstance(name, str) and name:
                    return identifier, name
                # The details are only a party's own: a peer is named by the directory, a factory by its owner.
                name = (await self._directory_names()).get(identifier) or await self._owner(_segment(identifier))
                if name:
                    return identifier, name
            return identifier, "" if failed else None

        return {key: name for key, name in await asyncio.gather(*(one(i) for i in unique)) if name is not None}

    async def _directory_names(self) -> dict[str, str]:
        """`{company ID: name}` from the registry's company directory, read once in `DIRECTORY_FOR_S`."""
        token = self._token() or ""
        async with self._reading:
            kept = self._directory
            if kept and kept[1] == token and self._clock() - kept[0] < DIRECTORY_FOR_S:
                return kept[2]
            try:
                answer = await self._get("/company/get-all-companies")
            except _Failed as failure:
                log.info("The company directory was not read: %s", failure)
                return {}
            listed = (
                answer
                if isinstance(answer, list)
                else (answer or {}).get("companies")
                if isinstance(answer, dict)
                else []
            )
            names = {
                item["company_ifric_id"]: item["company_name"]
                for item in listed or []
                if isinstance(item, dict)
                and isinstance(item.get("company_ifric_id"), str)
                and isinstance(item.get("company_name"), str)
                and item["company_name"]
            }
            self._directory = (self._clock(), token, names)
            return names

    async def machine_names(self, machine_ids: list[str]) -> dict[str, str]:
        """`{machine ID: asset name}` for the machines the registry names. The others are left out."""
        unique = list(dict.fromkeys(machine_ids))
        if len(unique) > MAX_RESOLVED:
            raise invalid(f"Ask for at most {MAX_RESOLVED} machines at a time.")
        slots = asyncio.Semaphore(AT_ONCE)

        async def one(machine_id: str) -> tuple[str, str | None]:
            async with slots:
                try:
                    asset = _record(await self._get(f"/company/assets/{_segment(machine_id)}"), "asset")
                except _Failed as failure:
                    log.info("A machine's asset name was not read: %s", failure)
                    return machine_id, None
            for key in ASSET_NAMES:
                if asset and isinstance(asset.get(key), str) and asset[key]:
                    return machine_id, asset[key]
            return machine_id, None

        return {key: name for key, name in await asyncio.gather(*(one(m) for m in unique)) if name}

    # ── Builders ─────────────────────────────────────────────────────────────

    async def builder(self, machine_id: str) -> Builder:
        """The machine's builder, or `NoBuilder` with the reason. Asks with the entity ID as it is."""
        try:
            answer = await self._get(f"/company/assets/{_segment(machine_id)}/manufacturer")
        except _Failed as failure:
            if failure.status == 403:
                raise NoBuilder(
                    "The IFRIC registry refused: this company is not a party to the machine, "
                    "or the participant is not known as a company."
                ) from None
            raise NoBuilder(str(failure)) from None
        company = _record(answer, "company")
        if company is None:
            raise NoBuilder(f"The IFRIC registry does not know the machine {machine_id}, so it has no known builder.")
        company_id, name = company.get("company_ifric_id"), company.get("company_name")
        if not isinstance(company_id, str) or not company_id:
            raise NoBuilder(f"The IFRIC registry named no company for the machine {machine_id}.")
        return Builder(company_id, name if isinstance(name, str) and name else company_id)

    async def builders(self, machine_ids: list[str]) -> dict[str, str]:
        """`{machine_id: builder's name}`, leaving out machines without one."""
        unique = list(dict.fromkeys(machine_ids))
        if len(unique) > MAX_RESOLVED:
            raise invalid(f"Ask for at most {MAX_RESOLVED} machines at a time.")
        slots = asyncio.Semaphore(AT_ONCE)

        async def one(machine_id: str) -> tuple[str, str | None]:
            async with slots:
                try:
                    return machine_id, (await self.builder(machine_id)).name
                except NoBuilder as reason:
                    log.info("No builder for a machine: %s", reason)
                    return machine_id, None

        return {key: name for key, name in await asyncio.gather(*(one(m) for m in unique)) if name}

    # ── Factories ────────────────────────────────────────────────────────────

    async def factory(self, factory_id: str | None) -> dict[str, Any]:
        if not factory_id:
            raise not_found("No factory is known for this session or configuration.")
        segment = _segment(factory_id)
        try:
            found = _record(await self._get(f"/company/factories/{segment}"), "factory")
        except _Failed as failure:
            raise unavailable(str(failure)) from None
        if found is None:
            raise not_found(f"The IFRIC registry does not know the factory {factory_id}.")
        result: dict[str, Any] = {
            "id": found.get("factory_id") or factory_id,
            "name": found.get("location_name") or factory_id,
            "owner": await self._owner(segment),
            "location": None,
        }
        if found.get("city") and found.get("country"):
            result["location"] = {"city": found["city"], "country": found["country"]}
        return result

    async def _owner(self, segment: str) -> str | None:
        try:
            owner = _record(await self._get(f"/company/factories/{segment}/owner"), "owner")
        except _Failed as failure:
            log.info("A factory's owner is left out: %s", failure)
            return None
        name = owner.get("company_name") if owner else None
        return name if isinstance(name, str) and name else None

    # ── State ────────────────────────────────────────────────────────────────

    async def check(self, participant_id: str | None) -> tuple[str, str]:
        """(status, detail) of the registry. A refused token is a failure: no route would work with it."""
        if participant_id is None:
            return "degraded", "Not connected to the dataspace, so the IFRIC registry can't be asked"
        try:
            await self._get(f"/company/get-company-details/{_segment(participant_id)}")
        except _Failed as failure:
            return "error", str(failure)
        return "ok", "Answers with the dataspace token"

    async def status(self, participant_id: str | None) -> dict[str, Any]:
        if not self.configured:
            return {"configured": False, "state": "not_configured", "detail": "No IFRIC registry is configured."}
        state, detail = await self.check(participant_id)
        return {"configured": True, "state": state, "detail": detail}
