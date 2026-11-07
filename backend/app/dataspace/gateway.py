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
"""The gateway's routes, in the terms of the UI's data interface. The contract is `gateway-api.md`."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from urllib.parse import quote

import httpx

from app.dataspace.connection import GatewayConnection
from app.errors import Refused, bad_gateway, conflict, invalid, not_found, unavailable

log = logging.getLogger(__name__)

SERVICE = "The dataspace gateway"
READ_TIMEOUT_S = 30
# The gateway gives up on an adapter after 120 seconds, so a send may take that long.
SEND_TIMEOUT_S = 130

ACCESS_STATUS = {
    "auto": "granted",
    "approved": "granted",
    "on-request": "default",
    "pending": "default",
    "denied": "denied",
}
POLICY_ACTIONS = ("approve", "deny", "reset")
LEVELS = ("standard", "elevated", "restricted")
DECISIONS = ("approve", "deny")

NameLookup = Callable[[list[str]], Awaitable[dict[str, str]]]


async def _no_names(ids: list[str]) -> dict[str, str]:
    return {}


class GatewayClient:
    def __init__(
        self,
        connection: GatewayConnection,
        transport: httpx.AsyncBaseTransport | None = None,
        names: NameLookup = _no_names,
    ) -> None:
        self.connection = connection
        self._transport = transport
        self.names = names

    async def request(
        self, method: str, path: str, *, limit_s: float = READ_TIMEOUT_S, **kwargs: Any
    ) -> httpx.Response:
        """A request with the token, renewing it once if the gateway refuses it. Refusals are raised."""
        token = self.connection.token()
        if token is None:
            raise unavailable("Not connected to the dataspace.")
        response = await self._send(method, path, token, limit_s, kwargs)
        if response.status_code == 401:
            token = await self.connection.renew_refused(token)
            if token is None:
                raise unavailable("The dataspace refused the token, and it could not be renewed.")
            response = await self._send(method, path, token, limit_s, kwargs)
        if response.status_code >= 400:
            raise refusal(response)
        return response

    async def _send(self, method: str, path: str, token: str, limit_s: float, kwargs: dict[str, Any]) -> httpx.Response:
        url = f"{self.connection.gateway_url}{path}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=limit_s, transport=self._transport) as client:
                return await client.request(method, url, headers=headers, **kwargs)
        except httpx.TimeoutException:
            raise unavailable(f"{SERVICE} did not answer in time.") from None
        except httpx.HTTPError:
            raise unavailable(f"{SERVICE} can't be reached.") from None

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self.request(method, path, **kwargs)
        try:
            return response.json()
        except ValueError:
            raise bad_gateway(f"{SERVICE} sent an answer that isn't JSON.") from None

    async def healthy(self) -> None:
        """Whether the gateway itself answers. Needs no token."""
        try:
            async with httpx.AsyncClient(timeout=READ_TIMEOUT_S, transport=self._transport) as client:
                response = await client.get(f"{self.connection.gateway_url}/health")
        except httpx.HTTPError:
            raise unavailable(f"{SERVICE} can't be reached.") from None
        if response.status_code != 200:
            raise unavailable(f"{SERVICE} answered HTTP {response.status_code}.")

    # ── Messages ─────────────────────────────────────────────────────────────

    async def send_files(self, receiver: str, files: list[tuple[str, bytes]], **fields: Any) -> dict[str, Any]:
        """`POST /outbox/files`. The contract's answer, with `message_id`."""
        form = {"receiver_participant": receiver} | {k: str(v) for k, v in fields.items() if v is not None}
        parts = [("files", (name, content, "application/json")) for name, content in files]
        return _accepted(await self._json("POST", "/outbox/files", data=form, files=parts, limit_s=SEND_TIMEOUT_S))

    async def send_message(self, receiver: str, **fields: Any) -> dict[str, Any]:
        """`POST /outbox/messages`. The contract's answer, with `message_id`."""
        body = {"receiver_participant": receiver} | {k: v for k, v in fields.items() if v is not None}
        return _accepted(await self._json("POST", "/outbox/messages", json=body, limit_s=SEND_TIMEOUT_S))

    async def sent_message(self, message_id: str) -> dict[str, Any]:
        answer = await self._json("GET", f"/outbox/messages/{quote(message_id, safe='')}")
        if not isinstance(answer, dict) or not answer.get("conversation_id"):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return answer

    async def message_status(self, message_id: str) -> dict[str, Any]:
        answer = await self._json("GET", f"/outbox/messages/{quote(message_id, safe='')}/status")
        if not isinstance(answer, dict) or not isinstance(answer.get("status"), str):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return answer

    async def inbox(self, status: str) -> list[dict[str, Any]]:
        answer = await self._json("GET", "/inbox/messages", params={"status": status})
        if not isinstance(answer, list):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return [item for item in answer if isinstance(item, dict) and item.get("message_id")]

    async def ack(self, message_id: str) -> None:
        await self.request("POST", f"/inbox/messages/{quote(message_id, safe='')}/ack")

    async def conversation(self, conversation_id: str) -> dict[str, Any]:
        answer = await self._json("GET", f"/conversations/{quote(conversation_id, safe='')}")
        if not isinstance(answer, dict):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return answer

    async def download(self, message_id: str, limit: int) -> bytes | None:
        """A received message's files. None if larger than `limit`, which are left at the gateway."""
        collected = bytearray()
        async for chunk in self.iter_download(message_id):
            collected.extend(chunk)
            if len(collected) > limit:
                return None
        return bytes(collected)

    async def iter_download(self, message_id: str) -> AsyncIterator[bytes]:
        token = self.connection.token()
        if token is None:
            raise unavailable("Not connected to the dataspace.")
        url = f"{self.connection.gateway_url}/inbox/messages/{quote(message_id, safe='')}/download"
        for may_renew in (True, False):
            try:
                async with (
                    httpx.AsyncClient(timeout=SEND_TIMEOUT_S, transport=self._transport) as client,
                    client.stream("GET", url, headers={"Authorization": f"Bearer {token}"}) as response,
                ):
                    if response.status_code == 401 and may_renew:
                        token = await self.connection.renew_refused(token)
                        if token is None:
                            raise unavailable("The dataspace refused the token, and it could not be renewed.")
                        continue
                    if response.status_code >= 400:
                        await response.aread()
                        raise refusal(response)
                    async for chunk in response.aiter_bytes():
                        yield chunk
                    return
            except httpx.TimeoutException:
                raise unavailable(f"{SERVICE} did not answer in time.") from None
            except httpx.HTTPError:
                raise unavailable(f"{SERVICE} can't be reached.") from None

    # ── Peers ────────────────────────────────────────────────────────────────

    async def compatible(self) -> list[dict[str, Any]]:
        answer = await self._json("GET", "/participants/compatible")
        if not isinstance(answer, list):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return [item for item in answer if isinstance(item, dict) and item.get("participant_id")]

    async def access(self, *, provider: str | None = None, consumer: str | None = None) -> list[dict[str, Any]]:
        params = {"provider": provider} if provider else {"consumer": consumer}
        answer = await self._json("GET", "/capabilities/access", params=params)
        if not isinstance(answer, list):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return [item for item in answer if isinstance(item, dict)]

    async def peers(self) -> list[dict[str, Any]]:
        peers = await self.compatible()
        ids = [peer["participant_id"] for peer in peers]
        names = await self.names(ids)

        async def offered(peer_id: str) -> list[str] | None:
            try:
                return [item["capability"] for item in await self.access(provider=peer_id) if "capability" in item]
            except Refused as refused:
                log.warning("The capabilities of a peer could not be read: %s", refused.message)
                return None

        found, levels = await asyncio.gather(
            asyncio.gather(*(offered(peer_id) for peer_id in ids)),
            asyncio.gather(*(self._level_of(peer_id) for peer_id in ids)),
        )
        return [
            {
                "id": peer_id,
                "name": names.get(peer_id) or peer_id,
                "capabilities": capabilities or [],
                "capabilities_unavailable": capabilities is None,
                "access_level": level["access_level"],
            }
            for peer_id, capabilities, level in zip(ids, found, levels, strict=True)
        ]

    async def _level_of(self, peer_id: str) -> dict[str, Any]:
        """The peer's access level here, from the statuses the gateway reports, or no level and the reason."""
        try:
            here = await self.access(consumer=peer_id)
        except Refused as refused:
            log.warning("A peer's access could not be read: %s", refused.message)
            return {"peer_id": peer_id, "access_level": None, "approved": [], "error": refused.message}
        statuses = {item.get("capability"): item.get("status") for item in here}
        approved = [capability for capability, status in statuses.items() if status == "approved"]
        level = "elevated" if approved else "restricted" if "denied" in statuses.values() else "standard"
        return {"peer_id": peer_id, "access_level": level, "approved": approved, "error": None}

    async def access_levels(self) -> dict[str, Any]:
        """Each compatible peer's access level here, with its name, and the number of peers per level."""
        ids = [peer["participant_id"] for peer in await self.compatible()]
        levels, names = await asyncio.gather(
            asyncio.gather(*(self._level_of(peer_id) for peer_id in ids)), self.names(ids)
        )
        counts = {level: 0 for level in (*LEVELS, "unknown")}
        for entry in levels:
            counts[entry["access_level"] or "unknown"] += 1
            entry["name"] = names.get(entry["peer_id"]) or entry["peer_id"]
        return {"peers": list(levels), "counts": counts}

    async def peer_capabilities(self, peer_id: str) -> dict[str, Any]:
        if peer_id not in {peer["participant_id"] for peer in await self.compatible()}:
            raise not_found(f"No compatible peer {peer_id} is known.")
        at_peer, here = await asyncio.gather(self.access(provider=peer_id), self.access(consumer=peer_id))
        names = await self.names([peer_id])
        return {
            "peer_id": peer_id,
            "name": names.get(peer_id) or peer_id,
            "at_peer": [_policy(item) for item in at_peer],
            "here": [_policy(item) for item in here],
        }

    async def policies(self) -> list[dict[str, Any]]:
        """What each compatible peer may access here."""
        ids = [peer["participant_id"] for peer in await self.compatible()]

        async def here(peer_id: str) -> dict[str, Any]:
            try:
                found = await self.access(consumer=peer_id)
            except Refused as refused:
                return {"peer_id": peer_id, "capabilities": [], "error": refused.message, "access_level": None}
            statuses = [item.get("status") for item in found]
            level = "elevated" if "approved" in statuses else "restricted" if "denied" in statuses else "standard"
            return {"peer_id": peer_id, "capabilities": [_policy(i) for i in found], "access_level": level}

        return list(await asyncio.gather(*(here(peer_id) for peer_id in ids)))

    # ── Capability requests and policy ───────────────────────────────────────

    async def capability_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        answer = await self._json("GET", "/capabilities/requests", params={"status": status} if status else None)
        if not isinstance(answer, list):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        requests = [_request(item) for item in answer if isinstance(item, dict)]
        requests.sort(key=lambda r: r["requested_at"] or "", reverse=True)
        requests.sort(key=lambda r: r["status"] != "pending")
        return requests

    async def decide_request(self, request_id: str, action: str, note: str | None = None) -> dict[str, Any]:
        if action not in DECISIONS:
            raise invalid(f"{action} is not a decision. Use approve or deny.")
        body: dict[str, Any] = {"action": action}
        if note:
            body["note"] = note
        try:
            answer = await self._json("PATCH", f"/capabilities/requests/{quote(request_id, safe='')}", json=body)
        except Refused as refused:
            if refused.kind != "conflict":
                raise
            raise conflict(await self._already_decided(request_id, refused.message)) from None
        return _request(answer)

    async def _already_decided(self, request_id: str, fallback: str) -> str:
        try:
            for request in await self.capability_requests():
                if request["id"] == request_id:
                    return f"Capability request {request_id} was already {request['status']}."
        except Refused:
            pass
        return fallback

    async def request_capability(self, provider: str, capability: str, **optional: Any) -> dict[str, Any]:
        body = {"provider_participant": provider, "capability": capability}
        body |= {key: value for key, value in optional.items() if value}
        return _request(await self._json("POST", "/capabilities/requests", json=body))

    async def set_policy(self, consumer: str, capability: str, action: str) -> dict[str, Any]:
        if action not in POLICY_ACTIONS:
            raise invalid(f"{action} is not a policy action. Use approve, deny or reset.")
        body = {"consumer_id": consumer, "capability": capability, "action": action}
        answer = await self._json("POST", "/capabilities/policy", json=body)
        return {**answer, "status": ACCESS_STATUS.get(answer.get("status"), answer.get("status"))}


def _accepted(answer: Any) -> dict[str, Any]:
    if not isinstance(answer, dict) or not isinstance(answer.get("message_id"), str):
        raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
    return answer


def _policy(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "capability": item.get("capability"),
        "status": ACCESS_STATUS.get(item.get("status"), "default"),
        "label": item.get("label"),
        "description": item.get("description"),
        "decision_note": item.get("decision_note"),
    }


def _request(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "requester_id": item.get("consumer_id"),
        "capability": item.get("capability"),
        "purpose": item.get("purpose"),
        "requested_at": item.get("requested_at"),
        "status": item.get("status"),
        "note": item.get("decision_note"),
        "decided_at": item.get("resolved_at"),
    }


def refusal(response: httpx.Response) -> Refused:
    """A gateway error in the backend's terms. The gateway's reason is passed on; it holds no address or token."""
    status = response.status_code
    reason = _reason(response)
    if status == 404:
        return not_found(reason or "The dataspace doesn't know it.")
    if status == 403:
        return conflict(reason or "The dataspace refused it for this participant.")
    if status == 409:
        return conflict(reason or "The conversation's state doesn't allow it.")
    if status in (400, 413, 422):
        return invalid(reason or "The dataspace refused the request.")
    return bad_gateway(f"{SERVICE} failed (HTTP {status}).")


def _reason(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    for key in ("reason", "detail"):
        if isinstance(body.get(key), str) and body[key]:
            return body[key][:300]
    return None
