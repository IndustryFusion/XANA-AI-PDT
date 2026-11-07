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
"""A dataspace in-process: an identity provider and a gateway that follow the contract, for stub tests."""

from __future__ import annotations

import asyncio
import base64
import json
import re
from typing import Any
from urllib.parse import parse_qs

import httpx

from tests.conftest import make_settings

KEY = "qcXAgZOKO96Cwvcq6oFyV8Q0Abj4XikFe9vZeGD5ioA="
GATEWAY = "http://gateway.test"
KEYCLOAK = "http://keycloak.test/auth"
FACTORY = "urn:ifric:factory-owner"
BUILDER = "urn:ifric:machine-builder"
SECRET = "the-real-client-secret"


def jwt(**claims: Any) -> str:
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"x.{body}.y"


def gateway_settings(**overrides: Any):
    values = {
        "gateway_url": GATEWAY,
        "gateway_keycloak_url": KEYCLOAK,
        "gateway_client_id": FACTORY,
        "settings_encryption_key": KEY,
    }
    return make_settings(**(values | overrides))


class Dataspace:
    """The identity provider and the gateway. Change its fields to make it fail."""

    def __init__(self) -> None:
        self.secret = SECRET
        self.expires_in = 300
        self.provider_status: int | None = None
        self.provider_down = False
        self.gateway_down = False
        self.status_for: dict[str, int] = {}  # "METHOD path" → status to answer with
        self.grants = 0
        self.valid_tokens: set[str] = set()
        self.requests: list[httpx.Request] = []
        self.access_at: dict[str, list[dict[str, Any]]] = {
            BUILDER: [{"capability": "mb:confidential", "label": "l", "status": "auto", "source": "default"}]
        }
        self.access_here: dict[str, list[dict[str, Any]]] = {
            BUILDER: [
                {"capability": "twin:direct", "status": "auto", "source": "default"},
                {"capability": "twin:adjacents", "status": "on-request", "source": "default"},
                {"capability": "twin:history", "status": "pending", "source": "explicit"},
            ]
        }
        self.capability_requests: list[dict[str, Any]] = [
            {
                "id": "r1",
                "consumer_id": BUILDER,
                "capability": "twin:history",
                "status": "pending",
                "conversation_id": None,
                "purpose": "Compare",
                "note": "n",
                "decision_note": None,
                "requested_at": "2026-11-06T10:00:00+00:00",
                "resolved_at": None,
            }
        ]
        self.policies: list[dict[str, Any]] = []
        self.sent: list[dict[str, Any]] = []  # what was accepted, in order: messages and file bundles
        self.message_status: dict[str, str] = {}
        self.fail_status: dict[str, str] = {}
        self.conversations: dict[str, dict[str, Any]] = {}
        self.refused: list[dict[str, Any]] = []
        self.inbox: list[dict[str, Any]] = []
        self.acks: list[str] = []
        self.downloads: dict[str, bytes] = {}
        self.holds: dict[str, asyncio.Event] = {}  # "METHOD path" → waits until set
        self.reached: dict[str, int] = {}

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        # Gives way, as a real connection does, or concurrent requests would run one after another.
        await asyncio.sleep(0.001)
        self.requests.append(request)
        if request.url.host == "keycloak.test":
            return self._token(request)
        return await self._gateway(request)

    def calls(self, method: str, path: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.method == method and r.url.path == path]

    def _token(self, request: httpx.Request) -> httpx.Response:
        if self.provider_down:
            raise httpx.ConnectError("refused")
        if self.provider_status:
            return httpx.Response(self.provider_status, json={"error": "server"})
        assert request.url.path == "/auth/realms/dataspace/protocol/openid-connect/token"
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        assert form["grant_type"] == "client_credentials"
        if form["client_secret"] != self.secret:
            return httpx.Response(401, json={"error": "invalid_client"})
        self.grants += 1
        token = jwt(participant_id=form["client_id"], azp=form["client_id"], grant=self.grants)
        self.valid_tokens.add(token)
        return httpx.Response(200, json={"access_token": token, "expires_in": self.expires_in, "token_type": "Bearer"})

    async def _gateway(self, request: httpx.Request) -> httpx.Response:
        if self.gateway_down:
            raise httpx.ConnectError("refused")
        path = request.url.path
        key = f"{request.method} {path}"
        self.reached[key] = self.reached.get(key, 0) + 1
        if key in self.holds:
            await self.holds[key].wait()
        forced = self.status_for.get(key)
        if forced:
            return httpx.Response(forced, json={"detail": f"forced {forced}"})
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if request.headers.get("authorization", "").removeprefix("Bearer ") not in self.valid_tokens:
            return httpx.Response(401, json={"detail": "bad token"})
        return self.route(request)

    def route(self, request: httpx.Request) -> httpx.Response:
        path, query = request.url.path, request.url.params
        if path == "/participants/compatible":
            return httpx.Response(200, json=[{"participant_id": BUILDER, "participant_type": "t", "hosted": True}])
        if path == "/capabilities/access":
            if "provider" in query:
                return httpx.Response(200, json=self.access_at.get(query["provider"], []))
            return httpx.Response(200, json=self.access_here.get(query["consumer"], []))
        if path == "/capabilities/requests" and request.method == "GET":
            wanted = query.get("status")
            return httpx.Response(
                200, json=[r for r in self.capability_requests if not wanted or r["status"] == wanted]
            )
        if path.startswith("/capabilities/requests/"):
            found = next((r for r in self.capability_requests if r["id"] == path.rsplit("/", 1)[1]), None)
            if found is None:
                return httpx.Response(404, json={"detail": "no such request"})
            if found["status"] != "pending":
                return httpx.Response(409, json={"detail": "already resolved"})
            body = json.loads(request.content)
            found |= {
                "status": "approved" if body["action"] == "approve" else "denied",
                "decision_note": body.get("note"),
                "resolved_at": "2026-11-07T10:00:00+00:00",
            }
            return httpx.Response(200, json=found)
        if path == "/capabilities/policy":
            body = json.loads(request.content)
            self.policies.append(body)
            status = {"approve": "approved", "deny": "denied", "reset": "on-request"}[body["action"]]
            source = "default" if body["action"] == "reset" else "explicit"
            return httpx.Response(
                200,
                json={
                    "consumer_id": body["consumer_id"],
                    "capability": body["capability"],
                    "status": status,
                    "source": source,
                },
            )  # noqa: E501
        if path == "/inbox/messages":
            wanted = query.get("status")
            return httpx.Response(200, json=[m for m in self.inbox if not wanted or m["status"] == wanted])
        if path.startswith("/inbox/messages/"):
            return self._inbox_item(request, path)
        if path.startswith("/conversations/"):
            return self._conversation(path.rsplit("/", 1)[1])
        if path == "/outbox/files":
            return self._accept_files(request)
        if path == "/outbox/messages":
            return self._accept_message(request)
        if path.startswith("/outbox/messages/"):
            return self._outbox_read(path)
        return httpx.Response(404, json={"detail": "not found"})

    def _accepted(self, record: dict[str, Any]) -> httpx.Response:
        record["message_id"] = f"m-{len(self.sent) + 1}"
        record["conversation_id"] = record.get("conversation_id") or f"c-{len(self.sent) + 1}"
        self.sent.append(record)
        self.message_status[record["message_id"]] = "pending"
        body = {"message_id": record["message_id"], "status": "pending", "applied": True, "conversation_state": "OPEN"}
        return httpx.Response(202, json=body)

    def _accept_files(self, request: httpx.Request) -> httpx.Response:
        boundary = request.headers["content-type"].split("boundary=")[1].encode()
        fields: dict[str, Any] = {"files": {}, "kind": "files"}
        for part in request.content.split(b"--" + boundary):
            if b"\r\n\r\n" not in part:
                continue
            head, body = part.split(b"\r\n\r\n", 1)
            body = body.removesuffix(b"\r\n")
            name = re.search(rb'name="([^"]+)"', head).group(1).decode()
            filename = re.search(rb'filename="([^"]+)"', head)
            if filename:
                fields["files"][filename.group(1).decode()] = json.loads(body)
            else:
                fields[name] = body.decode()
        return self._accepted(fields)

    def _accept_message(self, request: httpx.Request) -> httpx.Response:
        body = {**json.loads(request.content), "kind": "message"}
        conversation = self.conversations.get(body.get("conversation_id"))
        if conversation and conversation["state"].startswith("CLOSED") and body["performative"] != "close":
            if body["performative"] != "reopen" or conversation["outcome"] in ("escalated", "superseded"):
                return self._refuse(body, "conversation_closed")
        if (
            conversation
            and conversation["state"] == "ESCALATING"
            and conversation.get("escalated_by") == BUILDER
            and body["performative"] in ("close", "deescalate")
        ):
            return self._refuse(body, "not_escalator")
        answer = self._accepted(body)
        self._move(body)
        return answer

    def _refuse(self, body: dict[str, Any], reason: str) -> httpx.Response:
        """As the contract says: a refused send is kept, and listed with `applied: false`."""
        message_id = f"refused-{len(self.refused) + 1}"
        self.refused.append({**body, "message_id": message_id})
        conversation = self.conversations[body["conversation_id"]]
        return httpx.Response(
            409,
            json={
                "error": "conversation_state_violation",
                "reason": reason,
                "message_id": message_id,
                "conversation_state": conversation["state"],
            },
        )

    def _move(self, body: dict[str, Any]) -> None:
        conversation = self.conversations.setdefault(body["conversation_id"], {"state": "OPEN", "outcome": None})
        match body["performative"]:
            case "close":
                conversation |= {"state": f"CLOSED_{body['outcome'].upper()}", "outcome": body["outcome"]}
            case "escalate":
                conversation |= {"state": "ESCALATING", "escalated_by": body.get("sender", FACTORY)}
            case "deescalate" | "reopen":
                conversation |= {"state": "OPEN", "outcome": None, "escalated_by": None}

    def _conversation(self, conversation_id: str) -> httpx.Response:
        known = self.conversations.get(conversation_id, {"state": "OPEN", "outcome": None})
        messages = [
            {
                "message_id": m["message_id"],
                "direction": "sent",
                "performative": m.get("performative"),
                "payload": m.get("payload"),
                "in_reply_to": m.get("in_reply_to"),
                "capability": m.get("capability"),
                "outcome": m.get("outcome"),
                "has_files": m.get("kind") == "files",
                "applied": True,
                "status": self.message_status.get(m["message_id"], "notified"),
            }
            for m in self.sent
            if m["conversation_id"] == conversation_id
        ]
        messages += [
            {
                "message_id": m["message_id"],
                "direction": "sent",
                "performative": m.get("performative"),
                "payload": m.get("payload"),
                "in_reply_to": m.get("in_reply_to"),
                "capability": m.get("capability"),
                "applied": False,
                "status": "rejected",
            }
            for m in self.refused
            if m["conversation_id"] == conversation_id
        ]
        messages += [
            {"message_id": m["message_id"], "direction": "received", "performative": m.get("performative")}
            for m in self.inbox
            if m["conversation_id"] == conversation_id
        ]
        return httpx.Response(200, json={"conversation_id": conversation_id, **known, "messages": messages})

    def deliver(self, performative: str, conversation_id: str, **fields: Any) -> str:
        """A message from the machine builder arrives, moving this side's copy as the adapter would."""
        message_id = fields.pop("message_id", f"in-{len(self.inbox) + 1}")
        self.inbox.append(
            {
                "message_id": message_id,
                "conversation_id": conversation_id,
                "performative": performative,
                "status": "received",
                "created_at": f"2026-11-07T10:{len(self.inbox):02d}:00+00:00",
                "received_at": f"2026-11-07T10:{len(self.inbox):02d}:00+00:00",
                "sender_participant": BUILDER,
                "has_files": False,
                "payload": {},
            }
            | fields
        )
        self._move({"conversation_id": conversation_id, "performative": performative, "sender": BUILDER, **fields})
        return message_id

    def _inbox_item(self, request: httpx.Request, path: str) -> httpx.Response:
        parts = path.split("/")
        found = next((m for m in self.inbox if m["message_id"] == parts[3]), None)
        if found is None:
            return httpx.Response(404, json={"detail": "no such message"})
        if parts[-1] == "ack":
            found["status"] = "acked"
            self.acks.append(found["message_id"])
            return httpx.Response(204)
        if parts[-1] == "download":
            content = self.downloads.get(found["message_id"])
            return httpx.Response(200, content=content) if content else httpx.Response(404, json={"detail": "gone"})
        return httpx.Response(200, json=found)

    def _outbox_read(self, path: str) -> httpx.Response:
        parts = path.split("/")
        found = next((m for m in self.sent if m["message_id"] == parts[3]), None)
        if found is None:
            return httpx.Response(404, json={"detail": "no such message"})
        if parts[-1] == "status":
            status = self.message_status[found["message_id"]]
            error = self.fail_status.get(found["message_id"])
            return httpx.Response(
                200, json={"message_id": found["message_id"], "status": status, "error_message": error}
            )
        return httpx.Response(200, json=found)
