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
"""A stub of the IFRIC registry's routes that the backend uses, for the local environment.

It answers as the registry does for the sample machines, and doesn't check tokens. Not for any other use.

    python -m sample_data.ifric_stub [port]
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import unquote

OWNER = os.environ.get("IFRIC_STUB_OWNER", "urn:ifric:sample-factory-owner")
BUILDER = os.environ.get("IFRIC_STUB_BUILDER", "urn:ifric:sample-machine-builder")
FACTORY = "urn:ngsi-ld:Factory:plant-north"
COMPANIES = {
    OWNER: {"company_ifric_id": OWNER, "company_name": "Sample Factory Owner", "city": "Berlin", "country": "Germany"},
    BUILDER: {"company_ifric_id": BUILDER, "company_name": "Sample Machine Builder"},
}
FACTORIES = {
    FACTORY: {
        "factory_id": FACTORY,
        "owner_company_ifric_id": OWNER,
        "location_name": "Plant North",
        "city": "Berlin",
        "country": "Germany",
    }
}


def answer_for(path: str) -> Any:
    """The registry's answer for a path."""
    parts = [unquote(part) for part in path.strip("/").split("/")]
    match parts:
        case ["company", "get-company-details", identifier]:
            return [COMPANIES[identifier]] if identifier in COMPANIES else []
        case ["company", "assets", identifier, "manufacturer"]:
            if identifier.startswith("urn:ngsi-ld:Machine:"):
                return COMPANIES[BUILDER]
            return {"company": None, "message": f"No company data found for asset URN: {identifier}"}
        case ["company", "factories", identifier]:
            return FACTORIES.get(identifier) or {"factory": None, "message": "No factory data found"}
        case ["company", "factories", identifier, "owner"]:
            return COMPANIES[OWNER] if identifier in FACTORIES else {"owner": None, "message": "No factory data found"}
    return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - the name http.server calls
        answer = answer_for(self.path.split("?")[0])
        body = json.dumps(answer if answer is not None else {"message": "Not found"}).encode()
        self.send_response(404 if answer is None else 200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4007
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104 - inside its container
