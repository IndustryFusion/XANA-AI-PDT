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
import httpx
import pytest
from fastapi.testclient import TestClient

from app.ngsi.prefixes import CACHE_S, ContextPrefixes
from tests.explorer_support import TOKEN, Broker, app_with

CONFIGURED = "http://context.platform.svc:8080/context.jsonld"
REMOTE = "https://contexts.example/remote.jsonld"
PUBLIC = "93.184.216.34"
INTERNAL = {"internal.example": "10.0.0.5"}


async def resolver(host, port):
    return [INTERNAL.get(host, PUBLIC)]


class Contexts:
    """Context documents by host and path; records requests."""

    def __init__(self, documents: dict[str, object]) -> None:
        self.documents = documents
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        address = f"{request.url.scheme}://{request.headers['host']}{request.url.path}"
        if address not in self.documents:
            return httpx.Response(404)
        document = self.documents[address]
        if isinstance(document, str):
            return httpx.Response(200, text=document)
        return httpx.Response(200, json=document)

    def addresses(self) -> list[str]:
        return [f"{r.url.scheme}://{r.headers['host']}{r.url.path}" for r in self.requests]


def configured(**documents: object) -> dict[str, object]:
    return {CONFIGURED: documents.pop("configured"), **documents}


def prefixes(contexts: Contexts, context_url: str | None = CONFIGURED, **params) -> dict:
    app = app_with(Broker(), contexts=contexts, resolver=resolver, ngsi_context_url=context_url)
    answer = TestClient(app).get("/api/ngsi/prefixes", params=params)
    assert answer.status_code == 200
    return answer.json()


def test_a_context_with_prefixes_lists_only_namespace_terms():
    contexts = Contexts(
        configured(
            configured={
                "@context": [
                    {
                        "@vocab": "https://vocab.example/",
                        "iffb": "https://industry-fusion.org/base/v0.1/",
                        "owl": {"@id": "http://www.w3.org/2002/07/owl#"},
                        "temp": "https://industry-fusion.org/base/v0.1/temp",
                        "hasFilter": {"@id": "iffb:hasFilter", "@type": "@id"},
                        "ex:term": "https://ex.example/",
                        "@base": "https://base.example/",
                        "nothing": None,
                        "notAnIri": "plain/",
                    },
                    REMOTE,
                ]
            },
            **{REMOTE: {"@context": {"schema": "https://schema.org/", "iffb": "https://other.example/base/"}}},
        )
    )
    answer = prefixes(contexts)
    assert answer == {
        "prefixes": [
            {"prefix": "iffb", "namespace": "https://other.example/base/"},  # the later definition wins
            {"prefix": "owl", "namespace": "http://www.w3.org/2002/07/owl#"},
            {"prefix": "schema", "namespace": "https://schema.org/"},
        ],
        "detail": None,
    }


def test_remote_contexts_are_followed_two_levels_deep():
    level = {
        f"https://contexts.example/{n}": {
            "@context": [f"https://contexts.example/{n + 1}", {f"p{n}": f"https://p{n}.example/"}]
        }
        for n in range(1, 5)
    }
    contexts = Contexts(configured(configured={"@context": "https://contexts.example/1"}, **level))
    found = [p["prefix"] for p in prefixes(contexts)["prefixes"]]
    assert found == ["p1", "p2"]
    assert contexts.addresses() == [CONFIGURED, "https://contexts.example/1", "https://contexts.example/2"]


def test_at_most_eight_documents_are_read():
    names = {f"https://contexts.example/{n}": {"@context": {f"p{n}": f"https://p{n}.example/"}} for n in range(10)}
    contexts = Contexts(configured(configured={"@context": list(names)}, **names))
    assert len(prefixes(contexts)["prefixes"]) == 7
    assert len(contexts.requests) == 8


def test_no_context_configured_is_an_empty_list():
    contexts = Contexts({})
    assert prefixes(contexts, context_url=None) == {"prefixes": [], "detail": None}
    assert contexts.requests == []


@pytest.mark.parametrize(
    "document",
    [None, "not json at all", {"no": "context"}, ["a", "list"]],
)
def test_a_context_that_cant_be_read_gives_an_empty_list_and_a_reason_without_address_or_token(document):
    contexts = Contexts({} if document is None else {CONFIGURED: document})
    answer = prefixes(contexts)
    assert answer["prefixes"] == []
    assert answer["detail"]
    for secret in ("context.platform", "svc", "8080", "http", TOKEN, "secret-operator-token"):
        assert secret not in answer["detail"]


def test_an_unreachable_context_gives_a_reason_and_the_other_routes_keep_working():
    def down(request):
        raise httpx.ConnectError(f"cannot connect to {request.url}")

    app = app_with(Broker(), contexts=down, resolver=resolver, ngsi_context_url=CONFIGURED)
    client = TestClient(app)
    answer = client.get("/api/ngsi/prefixes").json()
    assert answer["prefixes"] == []
    assert "context.platform" not in answer["detail"]
    assert client.get("/api/ngsi/types").status_code == 200


def test_no_token_goes_with_the_context_request():
    contexts = Contexts(configured(configured={"@context": {"a": "https://a.example/"}}))
    prefixes(contexts)
    assert "authorization" not in contexts.requests[0].headers


def test_a_caller_named_context_is_ignored():
    contexts = Contexts(configured(configured={"@context": {"a": "https://a.example/"}}))
    answer = prefixes(
        contexts, context="https://evil.example/ctx.jsonld", url="https://evil.example/", ngsi_context_url="x"
    )
    assert answer["prefixes"] == [{"prefix": "a", "namespace": "https://a.example/"}]
    assert contexts.addresses() == [CONFIGURED]


@pytest.mark.parametrize(
    "remote", ["https://internal.example/ctx.jsonld", "file:///etc/passwd", "ftp://contexts.example/ctx.jsonld"]
)
def test_a_remote_context_the_import_would_refuse_is_not_read(remote):
    contexts = Contexts(
        configured(
            configured={"@context": [remote, {"a": "https://a.example/"}]},
            **{remote: {"@context": {"b": "https://b.example/"}}},
        )
    )
    answer = prefixes(contexts)
    assert answer["prefixes"] == [{"prefix": "a", "namespace": "https://a.example/"}]
    assert answer["detail"]
    assert "internal.example" not in answer["detail"]
    assert contexts.addresses() == [CONFIGURED]


def test_an_internal_remote_context_is_named_as_internal():
    remote = "https://internal.example/ctx.jsonld"
    contexts = Contexts(configured(configured={"@context": remote}))
    assert "internal address" in prefixes(contexts)["detail"]


async def test_the_context_is_read_once_per_ten_minutes():
    now = [1000.0]
    contexts = Contexts(configured(configured={"@context": {"a": "https://a.example/"}}))
    reader = ContextPrefixes(
        CONFIGURED, transport=httpx.MockTransport(contexts), resolver=resolver, clock=lambda: now[0]
    )
    first = await reader.prefixes()
    now[0] += CACHE_S - 1
    assert await reader.prefixes() == first
    assert len(contexts.requests) == 1
    now[0] += 1
    await reader.prefixes()
    assert len(contexts.requests) == 2


async def test_a_failure_is_cached_too():
    now = [0.0]
    contexts = Contexts({})
    reader = ContextPrefixes(
        CONFIGURED, transport=httpx.MockTransport(contexts), resolver=resolver, clock=lambda: now[0]
    )
    assert (await reader.prefixes())["prefixes"] == []
    await reader.prefixes()
    assert len(contexts.requests) == 1
