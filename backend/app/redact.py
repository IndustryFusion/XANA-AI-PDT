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
from urllib.parse import unquote, urlsplit, urlunsplit

MASK = "***"
# What may hold a token wherever it appears, known to this process or not.
_URL_PASSWORD = re.compile(r"([A-Za-z][A-Za-z0-9+.\-]*://[^/\s:@]*:)[^@\s/]+@")
_JWT = re.compile(r"\beyJ[\w\-]+\.[\w\-]+(\.[\w\-]*)?")
_BEARER = re.compile(r"\b(Bearer|Key)\s+[\w\-.~+/=]{8,}")


_SECRET_WORDS = {"password", "sslpassword", "passwd", "pwd", "token", "key", "apikey", "secret"}
_NAME_WORD = re.compile(r"[A-Z]?[a-z]+|[A-Z]+")
_PAIR = re.compile(r"(^|[&;])([^=&;]*)=([^&;]*)")


def _names_a_secret(name: str) -> bool:
    return any(word.lower() in _SECRET_WORDS for word in _NAME_WORD.findall(unquote(name)))


def _mask_pairs(text: str) -> str:
    """Query or fragment text, with the values of pairs named as a secret masked."""
    return _PAIR.sub(lambda m: f"{m[1]}{m[2]}={MASK}" if _names_a_secret(m[2]) else m[0], text)


def mask_url(url: str) -> str:
    """The URL with its password, and query or fragment values named as a secret, replaced by `***`."""
    try:
        parts = urlsplit(url)
        password = parts.password
    except ValueError:
        return MASK
    parts = parts._replace(query=_mask_pairs(parts.query), fragment=_mask_pairs(parts.fragment))
    if password is None:
        return urlunsplit(parts)
    # The host part as it is: with several hosts, or an odd port, it can't be read as one host and port.
    host = parts.netloc.rpartition("@")[2]
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
