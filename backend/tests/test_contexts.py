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
"""The contexts an imported entity may name, and their list in the System area."""

from __future__ import annotations

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import errors, ngsi
from app.errors import Refused
from app.ngsi.contexts import INTERNAL, UNENCRYPTED, UNRESOLVED, ContextAllowList, looks_external
from tests.conftest import make_settings

IFF = "https://industryfusion.github.io/contexts/staging/opcua/v0.2/context.jsonld"


class Rows:
    """A fake memory database holding the `allowed_contexts` table."""

    def __init__(self, fail: bool = False) -> None:
        self.urls: dict[str, str | None] = {}
        self.fail = fail

    @asynccontextmanager
    async def transaction(self):
        if self.fail:
            raise ConnectionError("no database")
        yield self

    async def execute(self, sql, params=()):
        rows = self

        class Cursor:
            rowcount = 0

            async def fetchall(self):
                return [{"url": url} for url in sorted(rows.urls)]

        cursor = Cursor()
        if sql.startswith("INSERT"):
            rows.urls.setdefault(params[0], params[1])
        elif sql.startswith("DELETE"):
            cursor.rowcount = 1 if rows.urls.pop(params[0], False) is not False else 0
        return cursor


def resolver(addresses):
    async def resolve(host, port):
        if addresses is None:
            raise OSError("no such host")
        return addresses

    return resolve


def allow_list(db=None, deployment=(), addresses=("93.184.216.34",)):
    return ContextAllowList(db, list(deployment), resolver=resolver(list(addresses) if addresses else addresses))


def test_core_built_in_and_deployment_contexts_are_allowed():
    contexts = allow_list(deployment=["https://example.org/ctx.jsonld", "https://ctx.example.com/"])
    assert contexts.allowed("https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld")
    assert contexts.allowed(IFF)
    assert contexts.allowed("https://example.org/ctx.jsonld")
    assert contexts.allowed("https://ctx.example.com/any/depth.jsonld")
    assert not contexts.allowed("https://example.org/ctx.jsonld.evil")
    assert not contexts.allowed("https://industryfusion.github.io.evil.example/contexts/x")
    assert not contexts.allowed("http://keycloak:8080/realms/iff")


async def test_added_contexts_are_allowed_listed_and_removed():
    rows = Rows()
    contexts = allow_list(rows)
    await contexts.add("https://example.org/mine.jsonld", "alice")
    answer = await contexts.entries(True, "Factory-Admin on client scorpio")
    assert contexts.allowed("https://example.org/mine.jsonld")
    mine = {"url": "https://example.org/mine.jsonld", "source": "added", "removable": True, "label": None}
    assert mine in answer["contexts"]
    assert [c["source"] for c in answer["contexts"]][:2] == ["core", "built_in"]
    assert rows.urls == {"https://example.org/mine.jsonld": "alice"}
    with pytest.raises(Refused):  # allowed already, by the built-in entry
        await contexts.add(IFF, "alice")
    await contexts.remove("https://example.org/mine.jsonld")
    assert not contexts.allowed("https://example.org/mine.jsonld")
    with pytest.raises(Refused):
        await contexts.remove("https://example.org/mine.jsonld")


@pytest.mark.parametrize(
    "url", ["ftp://example.org/c", "https://", "https://user:pw@example.org/c", "no url", "x" * 3000]
)
async def test_only_plain_http_urls_can_be_added(url):
    with pytest.raises(Refused):
        await allow_list(Rows()).add(url, None)


async def test_the_risks_of_a_context():
    assert await allow_list().risks("https://example.org/c.jsonld") == []
    assert await allow_list().risks("http://example.org/c.jsonld") == [UNENCRYPTED]
    assert await allow_list(addresses=["10.0.0.5"]).risks("https://ctx.corp.example/c") == [INTERNAL]
    assert await allow_list(addresses=None).risks("https://nowhere.example/c") == [UNRESOLVED]


async def test_a_database_that_fails():
    contexts = allow_list(Rows(fail=True))
    answer = await contexts.entries(True, "Factory-Admin on client scorpio")
    assert answer["detail"] and "can't be read" in answer["detail"]
    assert contexts.allowed(IFF)
    with pytest.raises(Refused):
        await contexts.add("https://example.org/c.jsonld", None)


@pytest.mark.parametrize(
    ("url", "named"),
    [
        ("https://example.org/c.jsonld", True),
        ("http://169.254.169.254/latest/meta-data", False),
        ("http://keycloak:8080/realms/iff", False),
        ("http://scorpio.iff.svc.cluster.local:9090/c", False),
        ("http://10.0.0.5/c", False),
        ("http://fuseki.local/c", False),
    ],
)
def test_only_external_looking_contexts_are_named(url, named):
    assert looks_external(url) is named


def app_with_contexts(contexts, roles=("Factory-Admin",)):
    app = FastAPI()
    app.state.contexts = contexts

    class Session:
        client_id = "scorpio"

        def status(self):
            return {"user": {"username": "alice"}}

        def client_roles(self):
            return list(roles)

    app.state.session = Session()
    errors.install(app)
    app.include_router(ngsi.router)
    return TestClient(app)


def test_the_routes_list_check_add_and_remove():
    rows = Rows()
    client = app_with_contexts(allow_list(rows))
    listed = client.get("/api/ngsi/contexts").json()
    assert listed["editable"] is True and listed["detail"] is None
    assert client.get("/api/ngsi/contexts/risks", params={"url": "http://example.org/c"}).json() == {
        "risks": [UNENCRYPTED]
    }
    added = client.post("/api/ngsi/contexts", json={"url": "https://example.org/c.jsonld"})
    assert added.status_code == 200 and rows.urls == {"https://example.org/c.jsonld": "alice"}
    assert client.delete("/api/ngsi/contexts", params={"url": "https://example.org/c.jsonld"}).status_code == 200
    assert client.delete("/api/ngsi/contexts", params={"url": "https://example.org/c.jsonld"}).status_code == 404
    assert client.post("/api/ngsi/contexts", json={"url": "ftp://x"}).status_code == 422


def test_without_a_database_the_list_is_not_editable():
    client = app_with_contexts(
        allow_list(None, deployment=[make_settings().ngsi_context_url or "https://example.org/c"])
    )
    assert client.get("/api/ngsi/contexts").json()["editable"] is False
    assert client.post("/api/ngsi/contexts", json={"url": "https://example.org/x.jsonld"}).status_code == 503


class SlowRows(Rows):
    """Rows whose next read answers what it saw when it started, once `release` is set."""

    def __init__(self) -> None:
        super().__init__()
        self.release = None

    async def execute(self, sql, params=()):
        cursor = await super().execute(sql, params)
        if sql.startswith("SELECT") and self.release is not None:
            seen = await cursor.fetchall()
            release, self.release = self.release, None

            class Late:
                async def fetchall(self):
                    await release.wait()
                    return seen

            return Late()
        return cursor


async def test_a_read_that_overlaps_a_removal_doesnt_bring_it_back():
    import asyncio

    rows = SlowRows()
    rows.urls["https://example.org/x.jsonld"] = None
    contexts = allow_list(rows)
    release = rows.release = asyncio.Event()
    reading = asyncio.create_task(contexts.refresh())  # sees the context, then waits
    await asyncio.sleep(0)
    removing = asyncio.create_task(contexts.remove("https://example.org/x.jsonld"))
    await asyncio.sleep(0)
    release.set()
    await reading
    await removing
    assert not contexts.allowed("https://example.org/x.jsonld")
    await contexts.refresh()
    assert not contexts.allowed("https://example.org/x.jsonld")


@pytest.mark.parametrize("url", ["https://example.org:99999/c.jsonld", "https://example.org:abc/c.jsonld"])
async def test_a_url_with_a_port_that_isnt_one_is_refused(url):
    rows = Rows()
    with pytest.raises(Refused):
        await allow_list(rows).add(url, None)
    assert rows.urls == {}


@pytest.mark.parametrize(
    "url",
    [
        "https://industryfusion.github.io/contexts/../other/c.jsonld",
        "https://industryfusion.github.io/contexts/%2e%2e/other/c.jsonld",
        "https://industryfusion.github.io/contexts/%2E%2E/other/c.jsonld",
        "https://industryfusion.github.io/contexts/a/./../../other/c.jsonld",
    ],
)
def test_dot_segments_dont_reach_past_an_entry(url):
    assert not allow_list().allowed(url)


@pytest.mark.parametrize("url", ["http://10.0.0.5./c", "http://localhost./x", "http://keycloak.svc./x"])
def test_a_root_dot_doesnt_hide_an_internal_host(url):
    assert not looks_external(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://schema.org/docs/jsonldcontext.jsonld",
        "https://schema.org/",
        "https://uri.etsi.org/ngsi-ld/v1.8/ngsi-ld-core-context.jsonld",
        "https://smartdatamodels.org/context.jsonld",
        "https://raw.githubusercontent.com/smart-data-models/data-models/master/context.jsonld",
        "https://fiware.github.io/data-models/context.jsonld",
        "https://www.w3.org/ns/odrl.jsonld",
        "https://www.w3.org/2018/credentials/v1",
        "https://ref.gs1.org/voc/data/gs1Voc.jsonld",
    ],
)
def test_well_known_contexts_are_built_in(url):
    assert allow_list().allowed(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://w3id.org/security/v2",
        "https://purl.org/x/c.jsonld",
        "https://schema.org.evil.example/c.jsonld",
        "https://www.w3.org/2018/credentials/v2",
        "https://raw.githubusercontent.com/someone-else/c.jsonld",
        # The owner's path also serves its forks' commits and pull requests.
        "https://raw.githubusercontent.com/smart-data-models/data-models/refs/pull/89/head/context.jsonld",
        "https://raw.githubusercontent.com/smart-data-models/data-models/0123456789abcdef0123456789abcdef01234567/context.jsonld",
        "https://raw.githubusercontent.com/smart-data-models/dataModel.Device/master/context.jsonld",
    ],
)
def test_redirect_services_and_look_alikes_are_not_built_in(url):
    assert not allow_list().allowed(url)


def test_built_in_contexts_are_listed_with_what_they_are():
    listed = app_with_contexts(allow_list()).get("/api/ngsi/contexts").json()["contexts"]
    labels = {c["url"]: c["label"] for c in listed if c["source"] == "built_in"}
    assert labels["https://schema.org/"] == "schema.org"
    assert labels["https://industryfusion.github.io/contexts/"] == "IndustryFusion"
    assert all(labels.values())


@pytest.mark.parametrize("roles", [(), ("Factory-Reader",), ("Factory-Writer",), ("factory-admin",)])
def test_only_a_factory_admin_may_change_the_list(roles):
    rows = Rows()
    rows.urls["https://example.org/kept.jsonld"] = "bob"
    client = app_with_contexts(allow_list(rows), roles=roles)
    listed = client.get("/api/ngsi/contexts").json()
    assert listed["mayChange"] is False and listed["changeRole"] == "Factory-Admin on client scorpio"
    assert any(c["url"] == "https://example.org/kept.jsonld" for c in listed["contexts"])
    for answer in (
        client.post("/api/ngsi/contexts", json={"url": "https://example.org/c.jsonld"}),
        client.delete("/api/ngsi/contexts", params={"url": "https://example.org/kept.jsonld"}),
        client.get("/api/ngsi/contexts/risks", params={"url": "http://keycloak/x"}),
    ):
        assert answer.status_code == 403
        assert answer.json()["error"]["kind"] == "unauthorized"
        assert "Factory-Admin on client scorpio" in answer.json()["error"]["message"]
    assert rows.urls == {"https://example.org/kept.jsonld": "bob"}


def test_a_factory_admin_may_change_the_list():
    client = app_with_contexts(allow_list(Rows()))
    listed = client.get("/api/ngsi/contexts").json()
    assert listed["mayChange"] is True
    # Adding and removing answer with the list as it is asked for.
    url = "https://example.org/c.jsonld"
    for answer in (
        client.post("/api/ngsi/contexts", json={"url": url}),
        client.delete("/api/ngsi/contexts", params={"url": url}),
    ):
        assert answer.json()["mayChange"] is True and answer.json()["changeRole"] == "Factory-Admin on client scorpio"
