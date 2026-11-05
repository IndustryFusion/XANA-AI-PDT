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
"""Keeps secrets out of responses and logs."""

from __future__ import annotations

import logging
from urllib.parse import unquote, urlsplit, urlunsplit

MASK = "***"


def mask_url(url: str) -> str:
    """The URL with its password replaced by `***`."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return MASK
    if parts.password is None:
        return url
    host = parts.hostname or ""
    if parts.port is not None:
        host = f"{host}:{parts.port}"
    user = f"{parts.username}:" if parts.username else ":"
    return urlunsplit(parts._replace(netloc=f"{user}{MASK}@{host}"))


def url_password(url: str) -> str | None:
    try:
        password = urlsplit(url).password
    except ValueError:
        return None
    return unquote(password) if password else None


class Redactor:
    """Replaces known secret values in text."""

    def __init__(self, secrets: list[str | None] = ()) -> None:
        self._secrets = sorted({s for s in secrets if s and len(s) >= 4}, key=len, reverse=True)

    def __call__(self, text: object) -> str:
        result = str(text)
        for secret in self._secrets:
            result = result.replace(secret, MASK)
        return result


class RedactingFilter(logging.Filter):
    """Logging filter that removes secrets from every record it passes."""

    def __init__(self, redactor: Redactor) -> None:
        super().__init__()
        self._redact = redactor

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if record.exc_info:
            message = f"{message}\n{logging.Formatter().formatException(record.exc_info)}"
            record.exc_info = None
            record.exc_text = None
        record.msg = self._redact(message)
        record.args = ()
        return True
