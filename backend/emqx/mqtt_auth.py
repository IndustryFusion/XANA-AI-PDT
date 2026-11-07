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
"""For tests: a small service with the rules of the platform's MQTT bridge. Not for use.

EMQX asks it about every connection (`/auth`) and topic (`/acl`). A token signed by the realm with
`Factory-Admin` or `Factory-Reader` on client `scorpio` may connect under any name, and such a client
may use any topic outside `spBv1.0/`. Standard library only, as it runs on a plain Python image.
"""

import base64
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEYCLOAK = sys.argv[1]
FACTORY_ROLES = {"Factory-Admin", "Factory-Reader"}
factory_clients: set[str] = set()


def decoded(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def verified_claims(token: str) -> dict | None:
    """The claims of an unexpired token that the realm signed with RS256, or None."""
    try:
        head, body, signature = token.split(".")
        url = f"{KEYCLOAK}/realms/iff/protocol/openid-connect/certs"
        with urllib.request.urlopen(url, timeout=5) as answer:  # noqa: S310 - the address is this test's own
            keys = json.load(answer)["keys"]
        key = next(k for k in keys if k["kid"] == json.loads(decoded(head))["kid"])
        modulus = int.from_bytes(decoded(key["n"]), "big")
        exponent = int.from_bytes(decoded(key["e"]), "big")
        size = (modulus.bit_length() + 7) // 8
        message = pow(int.from_bytes(decoded(signature), "big"), exponent, modulus).to_bytes(size, "big")
        if not message.endswith(hashlib.sha256(f"{head}.{body}".encode()).digest()):
            return None
        claims = json.loads(decoded(body))
    except Exception:  # noqa: BLE001 - anything unreadable is refused
        return None
    return claims if claims.get("exp", 0) > time.time() else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args: object) -> None:
        pass

    def answer(self, allowed: bool) -> None:
        body = json.dumps({"result": "allow" if allowed else "deny"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        claims = verified_claims(request.get("password") or "")
        roles = set(((claims or {}).get("resource_access", {}).get("scorpio") or {}).get("roles", []))
        if roles & FACTORY_ROLES:
            factory_clients.add(request.get("clientid"))
            self.answer(True)
        else:
            self.answer(False)

    def do_GET(self) -> None:
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
        topic = query.get("topic", "")
        if topic.startswith("$SYS/"):
            self.answer(True)
        elif topic.startswith("spBv1.0/"):
            self.answer(False)
        else:
            self.answer(query.get("clientid") in factory_clients)


ThreadingHTTPServer(("0.0.0.0", 3025), Handler).serve_forever()  # noqa: S104 - inside the test's network
