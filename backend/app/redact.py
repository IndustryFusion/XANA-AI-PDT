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
import re
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

MASK = "***"
# What may hold a token wherever it appears, known to this process or not.
_URL_PASSWORD = re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*://[^/\s:@]*:)[^@\s/]+@")
_JWT = re.compile(r"\beyJ[\w\-]+\.[\w\-]+(\.[\w\-]*)?")
_BEARER = re.compile(r"\b(Bearer|Key)\s+[\w\-.~+/=]{8,}")


_SECRET_NAME = re.compile("password|passwd|pwd|token|key|secret", re.IGNORECASE)


def mask_url(url: str) -> str:
    """The URL with its password, and query values that name a secret, replaced by `***`."""
    try:
        parts = urlsplit(url)
        pairs = parse_qsl(parts.query, keep_blank_values=True)
        password = parts.password
    except ValueError:
        return MASK
    if any(_SECRET_NAME.search(name) for name, _ in pairs):
        masked = [(name, MASK if _SECRET_NAME.search(name) else value) for name, value in pairs]
        parts = parts._replace(query=urlencode(masked, safe="*"))
    if password is None:
        return urlunsplit(parts)
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
        result = _URL_PASSWORD.sub(rf"\g<1>{MASK}@", result)
        result = _JWT.sub(MASK, result)
        return _BEARER.sub(rf"\g<1> {MASK}", result)


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
