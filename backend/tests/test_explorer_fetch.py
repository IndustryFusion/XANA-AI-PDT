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
import asyncio
import socket

import httpx
import pytest

from app.errors import Refused
from app.ngsi import fetch as fetch_module
from app.ngsi.fetch import MAX_BYTES, fetch_document, is_public

PUBLIC = "93.184.216.34"


async def public(host, port):
    return [PUBLIC]


def answers(*items):
    """A transport answering in turn; records requests. Fails the test on one more request."""
    queue = list(items)
    seen = []

    def handler(request):
        seen.append(request)
        return queue.pop(0)

    transport = httpx.MockTransport(handler)
    transport.seen = seen
    return transport


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "127.1.2.3",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",  # noqa: S104
        "224.0.0.1",
        "239.1.1.1",
        "240.0.0.1",
        "255.255.255.255",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:169.254.169.254",
        "2002:7f00:1::",
        "64:ff9b::7f00:1",
        "2001:0:4136:e378:8000:63bf:80ff:fffe",
        "not an address",
    ],
)
def test_internal_addresses(address):
    assert not is_public(address)


@pytest.mark.parametrize("address", [PUBLIC, "1.1.1.1", "2606:4700:4700::1111", "::ffff:1.1.1.1", "64:ff9b::101:101"])
def test_public_addresses(address):
    assert is_public(address)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://localhost/x",
        "http://[::1]/x",
        "http://[::ffff:127.0.0.1]/x",
        "http://2130706433/x",
        "http://0x7f.0.0.1/x",
        "http://127.1/x",
        "http://0/x",
    ],
)
async def test_literal_forms_resolve_and_are_refused_with_no_connection(url):
    transport = answers()
    with pytest.raises(Refused) as caught:
        await fetch_document(url, transport=transport)
    assert caught.value.kind == "invalid"
    assert "internal" in caught.value.message
    assert "127" not in caught.value.message
    assert transport.seen == []


async def test_name_with_one_internal_answer_among_public_ones_is_refused():
    async def mixed(host, port):
        return [PUBLIC, "10.0.0.1"]

    transport = answers()
    with pytest.raises(Refused):
        await fetch_document("https://rebind.example/x", resolver=mixed, transport=transport)
    assert transport.seen == []


@pytest.mark.parametrize(
    "url",
    ["ftp://example.org/x", "file:///etc/passwd", "gopher://example.org/", "not a url", "https://", "http://[bad/x"],
)
async def test_other_schemes_and_nonsense(url):
    with pytest.raises(Refused) as caught:
        await fetch_document(url, resolver=public, transport=answers())
    assert caught.value.kind == "invalid"


@pytest.mark.parametrize("url", ["https://user:pw@example.org/x", "https://user@example.org/x"])
async def test_credentials_in_the_url(url):
    with pytest.raises(Refused) as caught:
        await fetch_document(url, resolver=public, transport=answers())
    assert caught.value.kind == "invalid"


async def test_connection_goes_to_the_checked_address_with_the_original_name():
    transport = answers(httpx.Response(200, json=[{"id": "urn:a", "type": "T"}]))
    result = await fetch_document("https://docs.example:8443/a.json", resolver=public, transport=transport)
    request = transport.seen[0]
    assert request.url.host == PUBLIC
    assert request.url.port == 8443
    assert request.headers["Host"] == "docs.example:8443"
    assert request.extensions["sni_hostname"] == "docs.example"
    assert result == {"url": "https://docs.example:8443/a.json", "document": [{"id": "urn:a", "type": "T"}]}


async def test_later_dns_answer_is_never_asked_for():
    """A resolver that would turn internal on the second question is asked once per hop."""
    calls = []

    async def rebinding(host, port):
        calls.append(host)
        return [PUBLIC] if len(calls) == 1 else ["127.0.0.1"]

    transport = answers(httpx.Response(200, json={}))
    await fetch_document("https://rebind.example/x", resolver=rebinding, transport=transport)
    assert calls == ["rebind.example"]
    assert transport.seen[0].url.host == PUBLIC


async def test_redirect_to_internal_address_is_refused_with_no_connection_to_it():
    async def by_name(host, port):
        return ["169.254.169.254"] if host == "metadata.internal" else [PUBLIC]

    redirect = httpx.Response(302, headers={"Location": "http://metadata.internal/latest"})
    transport = answers(redirect)
    with pytest.raises(Refused) as caught:
        await fetch_document("https://docs.example/a", resolver=by_name, transport=transport)
    assert caught.value.kind == "invalid"
    assert [r.url.host for r in transport.seen] == [PUBLIC]


async def test_redirect_to_another_scheme_is_refused():
    transport = answers(httpx.Response(302, headers={"Location": "file:///etc/passwd"}))
    with pytest.raises(Refused):
        await fetch_document("https://docs.example/a", resolver=public, transport=transport)


async def test_redirect_within_limits_is_followed_and_relative_location_works():
    transport = answers(httpx.Response(301, headers={"Location": "/b"}), httpx.Response(200, json=[]))
    result = await fetch_document("https://docs.example/a", resolver=public, transport=transport)
    assert result["url"] == "https://docs.example/b"


async def test_too_many_redirects():
    loop = [httpx.Response(302, headers={"Location": "/again"}) for _ in range(4)]
    with pytest.raises(Refused) as caught:
        await fetch_document("https://docs.example/a", resolver=public, transport=answers(*loop))
    assert caught.value.http_status == 502


async def test_too_large_stops_reading():
    produced = []

    async def endless():
        for _ in range(100):
            produced.append(1)
            yield b"x" * (1024 * 1024)

    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=endless()))
    with pytest.raises(Refused) as caught:
        await fetch_document("https://docs.example/a", resolver=public, transport=transport)
    assert caught.value.kind == "invalid"
    assert len(produced) * 1024 * 1024 <= MAX_BYTES + 2 * 1024 * 1024


async def test_not_json_and_error_answers():
    with pytest.raises(Refused) as caught:
        await fetch_document(
            "https://docs.example/a", resolver=public, transport=answers(httpx.Response(200, text="<html>"))
        )
    assert caught.value.kind == "invalid"
    with pytest.raises(Refused) as caught:
        await fetch_document("https://docs.example/a", resolver=public, transport=answers(httpx.Response(404)))
    assert caught.value.http_status == 502


async def test_unknown_host_is_502_not_a_refusal_of_an_internal_address():
    async def nothing(host, port):
        raise socket.gaierror("no such host")

    with pytest.raises(Refused) as caught:
        await fetch_document("https://nope.example/a", resolver=nothing, transport=answers())
    assert caught.value.http_status == 502
    assert "nope" not in caught.value.message


async def test_proxies_from_the_environment_are_ignored(monkeypatch):
    seen = {}
    real = httpx.AsyncClient

    def spying(**kwargs):
        seen.update(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(fetch_module.httpx, "AsyncClient", spying)
    transport = answers(httpx.Response(200, json=[]))
    await asyncio.wait_for(fetch_document("https://docs.example/a", resolver=public, transport=transport), 5)
    assert seen["trust_env"] is False
    assert transport.seen[0].url.host == PUBLIC


@pytest.mark.parametrize(
    "url",
    [
        "http://exa mple.org/",
        "http://[::1",
        "http://%zz/",
        "http://a..b/",
        "http://" + "x" * 300 + ".example/",
        "http://.example/",
        "https://exam\x00ple.org/",
        "http://host:99999/",
        "http://host:port/",
    ],
)
async def test_malformed_urls_are_invalid_and_not_a_crash(url):
    async def names(host, port):
        host.encode("idna")
        return [PUBLIC]

    try:
        await fetch_document(url, resolver=names, transport=answers(httpx.Response(200, json=[])))
    except Refused as refused:
        assert refused.kind in ("invalid", "unavailable")
