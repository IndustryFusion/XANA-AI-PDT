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
"""Fetches an import document from a public address. Never reaches an internal one.

Every address a host resolves to must be public, and the connection goes to the checked address,
so that a second DNS answer can't redirect it. Redirects are followed here, and checked the same way.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from app.errors import bad_gateway, invalid

MAX_BYTES = 10 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT_S = 10
REFUSED = "This address can't be imported from: it is an internal address."
SOURCE = "The document's address"
_NAT64 = ipaddress.ip_network("64:ff9b::/96")

Resolver = Callable[[str, int], Awaitable[list[str]]]


async def resolve(host: str, port: int) -> list[str]:
    answers = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(answer[4][0]) for answer in answers]


def is_public(address: str) -> bool:
    """Whether an address is on the public internet, looking inside the forms that wrap IPv4 in IPv6."""
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return is_public(str(ip.ipv4_mapped))
        if ip.sixtofour is not None:
            return is_public(str(ip.sixtofour))
        if ip.teredo is not None:
            return is_public(str(ip.teredo[1]))
        if ip in _NAT64:
            return is_public(str(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)))
    # `is_global` alone lets multicast through.
    return ip.is_global and not (ip.is_multicast or ip.is_reserved or ip.is_unspecified or ip.is_link_local)


def _checked_url(url: str) -> tuple[str, int, httpx.URL]:
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise invalid("Enter a complete URL, for example https://…") from None
    if not isinstance(url, str) or parts.scheme not in ("http", "https"):
        raise invalid("Only http and https URLs can be imported.")
    if not parts.hostname:
        raise invalid("Enter a complete URL, for example https://…")
    if parts.username or parts.password:
        raise invalid("A URL with a user name or password can't be imported.")
    try:
        return parts.hostname, port or (443 if parts.scheme == "https" else 80), httpx.URL(url.strip())
    except (httpx.InvalidURL, ValueError):
        raise invalid("Enter a complete URL, for example https://…") from None


async def _public_address(host: str, port: int, resolver: Resolver) -> str:
    try:
        addresses = await resolver(host, port)
    except OSError:
        raise bad_gateway(f"{SOURCE} could not be resolved.") from None
    except UnicodeError:
        raise invalid("Enter a complete URL, for example https://…") from None
    if not addresses or not all(is_public(address) for address in addresses):
        raise invalid(REFUSED)
    return addresses[0]


async def fetch_document(
    url: str,
    resolver: Resolver = resolve,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """`{url, document}`. Refuses internal addresses as `invalid`; other failures are 502."""
    current = url
    # Environment proxies would make the connection somewhere other than the checked address.
    async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=transport, trust_env=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            host, port, target = _checked_url(current)
            address = await _public_address(host, port, resolver)
            headers = {"Host": target.netloc.decode("ascii"), "Accept": "application/json, application/ld+json"}
            try:
                request = client.build_request(
                    "GET", target.copy_with(host=address), headers=headers, extensions={"sni_hostname": host}
                )
            except (httpx.InvalidURL, ValueError, UnicodeError):
                raise invalid("Enter a complete URL, for example https://…") from None
            try:
                response = await client.send(request, stream=True)
            except httpx.HTTPError as error:
                raise bad_gateway(f"{SOURCE} cannot be reached ({type(error).__name__}).") from None
            try:
                if response.is_redirect and response.headers.get("location"):
                    current = urljoin(current, response.headers["location"])
                    continue
                if response.status_code != 200:
                    raise bad_gateway(f"{SOURCE} answered HTTP {response.status_code}.")
                return {"url": current, "document": await _read_json(response)}
            finally:
                await response.aclose()
    raise bad_gateway(f"{SOURCE} redirected more than {MAX_REDIRECTS} times.")


async def _read_json(response: httpx.Response) -> Any:
    received = bytearray()
    try:
        async for chunk in response.aiter_bytes():
            received += chunk
            if len(received) > MAX_BYTES:
                raise invalid(f"The document is larger than {MAX_BYTES // (1024 * 1024)} MB.")
    except httpx.HTTPError as error:
        raise bad_gateway(f"{SOURCE} stopped answering ({type(error).__name__}).") from None
    try:
        return json.loads(bytes(received))
    except ValueError:
        raise invalid("The document is not valid JSON.") from None
