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
"""Failures of the services behind the explorer, in the backend's error kinds."""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.errors import Refused, bad_gateway, conflict, invalid, not_found, unauthorized

MAX_REASON = 500
_ADDRESS = re.compile(r"\b[A-Za-z][A-Za-z0-9+.\-]*://[^\s\"'<>]+")


def scrubbed(reason: str) -> str:
    """A service's reason, without any address in it: those can be internal ones."""
    return _ADDRESS.sub("[address]", reason)[:MAX_REASON]


def reason_from(response: httpx.Response) -> str | None:
    """What a service says about a rejected request, if it says anything usable."""
    try:
        body: Any = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    for key in ("detail", "message", "title"):
        text = body.get(key)
        if isinstance(text, str) and text.strip():
            return scrubbed(text.strip())
    return None


def refusal(service: str, response: httpx.Response) -> Refused:
    """The refusal for an answer that isn't a success."""
    status = response.status_code
    if status in (401, 403):
        return unauthorized(f"{service} refused the request (HTTP {status}); check the operator's sign-in and roles.")
    if status >= 500:
        return bad_gateway(f"{service} failed (HTTP {status}).")
    reason = reason_from(response) or f"{service} answered HTTP {status}."
    if status == 404:
        return not_found(reason)
    if status == 409:
        return conflict(reason)
    if status in (400, 422):
        return invalid(reason)
    return bad_gateway(f"{service} answered HTTP {status}.")


def unreachable(service: str, error: httpx.HTTPError) -> Refused:
    # The exception's text can hold the address, so only its kind is passed on.
    return bad_gateway(f"{service} cannot be reached ({type(error).__name__}).")
