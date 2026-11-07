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

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        # Gives way, as a real connection does, or concurrent requests would run one after another.
        await asyncio.sleep(0.001)
        self.requests.append(request)
        if request.url.host == "keycloak.test":
            return self._token(request)
        return self._gateway(request)

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

    def _gateway(self, request: httpx.Request) -> httpx.Response:
        if self.gateway_down:
            raise httpx.ConnectError("refused")
        path = request.url.path
        forced = self.status_for.get(f"{request.method} {path}")
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
        return httpx.Response(404, json={"detail": "not found"})
