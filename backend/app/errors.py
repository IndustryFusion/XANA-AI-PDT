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
"""Refused requests: a stable kind the UI maps directly, and a readable message."""

from __future__ import annotations

from typing import Literal

Kind = Literal["not_found", "conflict", "invalid", "unavailable", "unauthorized"]

HTTP_STATUS: dict[Kind, int] = {
    "not_found": 404,
    "conflict": 409,
    "invalid": 422,
    "unavailable": 503,
    "unauthorized": 401,
}


class Refused(Exception):
    def __init__(self, kind: Kind, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self._status = status

    @property
    def http_status(self) -> int:
        return self._status or HTTP_STATUS[self.kind]

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "message": self.message}


def not_found(message: str) -> Refused:
    return Refused("not_found", message)


def conflict(message: str) -> Refused:
    return Refused("conflict", message)


def invalid(message: str) -> Refused:
    return Refused("invalid", message)


def unauthorized(message: str) -> Refused:
    return Refused("unauthorized", message)


def unavailable(message: str) -> Refused:
    return Refused("unavailable", message)


def bad_gateway(message: str) -> Refused:
    """A service behind the backend cannot be used. The message names it, and holds no address or token."""
    return Refused("unavailable", message, status=502)
