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
import pathlib
import re

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.errors import Refused
from app.health import HealthService
from app.ifric import DOWN_FOR_S, MAX_RESOLVED, NAMES_WITHIN_S, NoBuilder, RegistryClient
from app.main import AgentDeps, create_app
from app.memory.migrate import Migrator
from app.runs.machines import MachineResolver
from sample_data import ifric_stub
from tests.conftest import CLOSED_HTTP, make_settings
from tests.dataspace_support import BUILDER, FACTORY, SECRET, Dataspace, gateway_settings
from xana_agent.testing import FakeContextSource, FakeHistorySource, StepScript, sample_entities, sample_history

REGISTRY = "http://registry.test:4007"
MACHINE = "urn:ngsi-ld:Machine:press-01"
FACTORY_ID = "urn:ifric:ifx-eur-loc-fac-1"


class Registry:
    """Answers as the registry does. `answers` holds path → (status, body) or an exception."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.tokens: list[str] = []
        self.answers: dict[str, object] = {}
        self.in_flight = 0
        self.most_in_flight = 0

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self.in_flight)
        await asyncio.sleep(0.001)
        self.in_flight -= 1
        raw = request.url.raw_path.decode()
        self.paths.append(raw)
        self.tokens.append(request.headers.get("authorization", ""))
        answer = self.answers.get(raw, (404, {"message": "Not found"}))
        if isinstance(answer, Exception):
            raise answer
        status, body = answer
        return httpx.Response(status, json=body) if body is not None else httpx.Response(status, text="<html>")


def company_path(identifier: str) -> str:
    return f"/company/get-company-details/{identifier.replace(':', '%3A')}"


def asset_path(identifier: str = MACHINE) -> str:
    return f"/company/assets/{identifier.replace(':', '%3A')}/manufacturer"


def factory_path(suffix: str = "") -> str:
    return f"/company/factories/{FACTORY_ID.replace(':', '%3A')}{suffix}"


def client_of(registry=None, token="the-token", url=REGISTRY):  # noqa: S107
    registry = registry or Registry()
    settings = make_settings(ifric_url=url) if url else make_settings()
    return registry, RegistryClient(settings, lambda: token, transport=registry.transport())


# ── Names ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body",
    [
        [{"company_ifric_id": BUILDER, "company_name": "Builder GmbH"}],
        {"company_ifric_id": BUILDER, "company_name": "Builder GmbH"},
        {"company": {"company_name": "Builder GmbH"}},
    ],
)
async def test_a_name_from_every_form_of_answer(body):
    registry, client = client_of()
    registry.answers[company_path(BUILDER)] = (200, body)
    assert await client.names([BUILDER]) == {BUILDER: "Builder GmbH"}
    assert registry.tokens == ["Bearer the-token"]


@pytest.mark.parametrize("body", [[], {"company": None, "message": "x"}, [{"company_ifric_id": "x"}], {}])
async def test_unknown_company_is_left_out(body):
    registry, client = client_of()
    registry.answers[company_path(BUILDER)] = (200, body)
    assert await client.names([BUILDER]) == {}


@pytest.mark.parametrize(
    "failure",
    [
        (403, {"message": "no"}),
        (401, {"message": "no"}),
        (500, {"message": "boom"}),
        (200, None),
        httpx.ReadTimeout("t"),
    ],
)
async def test_a_failed_name_is_empty_and_the_others_stay(failure):
    registry, client = client_of()
    registry.answers[company_path("urn:a")] = failure
    registry.answers[company_path("urn:b")] = (200, [{"company_name": "B"}])
    assert await client.names(["urn:a", "urn:b"]) == {"urn:a": "", "urn:b": "B"}


async def test_names_without_a_token_or_a_registry():
    registry, client = client_of(token=None)
    assert await client.names(["urn:a"]) == {"urn:a": ""}
    assert registry.paths == []
    registry, client = client_of(url=None)
    assert await client.names(["urn:a"]) == {"urn:a": ""}
    assert registry.paths == []


async def test_identifiers_are_one_encoded_segment():
    registry, client = client_of()
    await client.names(["urn:ifric:a/b c"])
    # Unknown in the details, so the directory and the factory's owner are asked too, with the same segment.
    assert registry.paths == [
        "/company/get-company-details/urn%3Aifric%3Aa%2Fb%20c",
        "/company/get-all-companies",
        "/company/factories/urn%3Aifric%3Aa%2Fb%20c/owner",
    ]
    registry, client = client_of()
    with pytest.raises(NoBuilder):
        await client.builder("../../admin")
    assert registry.paths == ["/company/assets/..%2F..%2Fadmin/manufacturer"]


async def test_names_are_asked_once_each_and_a_few_at_a_time():
    registry, client = client_of()
    ids = [f"urn:{n}" for n in range(40)] * 2
    await client.names(ids)
    details = [p for p in registry.paths if "get-company-details" in p]
    assert len(details) == len(set(details)) == 40
    assert registry.paths.count("/company/get-all-companies") == 1  # read once, though 40 asked at once
    assert len([p for p in registry.paths if p.endswith("/owner")]) == 40
    assert 1 < registry.most_in_flight <= 8


async def test_too_many_names_are_refused():
    registry, client = client_of()
    with pytest.raises(Refused) as caught:
        await client.names([f"urn:{n}" for n in range(MAX_RESOLVED + 1)])
    assert caught.value.kind == "invalid" and registry.paths == []


# ── Builders ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body",
    [
        {"company_ifric_id": BUILDER, "company_name": "Builder GmbH"},
        [{"company_ifric_id": BUILDER, "company_name": "Builder GmbH"}],
        {"company": {"company_ifric_id": BUILDER, "company_name": "Builder GmbH"}},
    ],
)
async def test_builder_from_every_form(body):
    registry, client = client_of()
    registry.answers[asset_path()] = (200, body)
    builder = await client.builder(MACHINE)
    assert (builder.company_id, builder.name) == (BUILDER, "Builder GmbH")


async def test_builder_without_a_name_uses_its_id():
    registry, client = client_of()
    registry.answers[asset_path()] = (200, {"company_ifric_id": BUILDER})
    assert (await client.builder(MACHINE)).name == BUILDER


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        ((200, {"company": None, "message": "No company data"}), "does not know the machine"),
        ((404, {"message": "x"}), "does not know the machine"),
        ((200, {"company_name": "No ID"}), "named no company"),
        ((403, {"message": "not a party"}), "not a party"),
        ((401, {"message": "x"}), "refused the dataspace token"),
        ((503, {"message": "x"}), "failed"),
        (httpx.ConnectError("x"), "can't be reached"),
        (httpx.ReadTimeout("x"), "did not answer in time"),
    ],
)
async def test_each_reason_for_no_builder(answer, reason):
    registry, client = client_of()
    registry.answers[asset_path()] = answer
    with pytest.raises(NoBuilder, match=reason) as caught:
        await client.builder(MACHINE)
    assert "registry.test" not in str(caught.value)


async def test_no_builder_without_a_token():
    registry, client = client_of(token=None)
    with pytest.raises(NoBuilder, match="Not connected"):
        await client.builder(MACHINE)
    assert registry.paths == []


async def test_builders_leave_out_machines_without_one():
    registry, client = client_of()
    registry.answers[asset_path("urn:m:1")] = (200, {"company_ifric_id": BUILDER, "company_name": "B"})
    registry.answers[asset_path("urn:m:2")] = (200, {"company": None})
    registry.answers[asset_path("urn:m:3")] = (403, {"message": "x"})
    assert await client.builders(["urn:m:1", "urn:m:2", "urn:m:3"]) == {"urn:m:1": "B"}


# ── Factories ───────────────────────────────────────────────────────────────


async def test_factory_with_owner_and_location():
    registry, client = client_of()
    registry.answers[factory_path()] = (
        200,
        {"factory_id": FACTORY_ID, "location_name": "Plant", "city": "Berlin", "country": "Germany"},
    )
    registry.answers[factory_path("/owner")] = (200, {"company_name": "Owner AG", "email": "hidden@example.org"})
    assert await client.factory(FACTORY_ID) == {
        "id": FACTORY_ID,
        "name": "Plant",
        "owner": "Owner AG",
        "location": {"city": "Berlin", "country": "Germany"},
    }


@pytest.mark.parametrize(
    "owner", [(403, {"message": "x"}), (200, {"owner": None}), (500, {"message": "x"}), httpx.ConnectError("x")]
)
async def test_factory_without_a_readable_owner(owner):
    registry, client = client_of()
    registry.answers[factory_path()] = (200, {"factory_id": FACTORY_ID, "location_name": "Plant"})
    registry.answers[factory_path("/owner")] = owner
    answer = await client.factory(FACTORY_ID)
    assert answer["owner"] is None and answer["location"] is None and answer["name"] == "Plant"


async def test_unknown_factory_and_no_factory_id():
    registry, client = client_of()
    registry.answers[factory_path()] = (200, {"factory": None, "message": "x"})
    with pytest.raises(Refused) as caught:
        await client.factory(FACTORY_ID)
    assert caught.value.kind == "not_found"
    with pytest.raises(Refused) as caught:
        await client.factory(None)
    assert caught.value.kind == "not_found"


@pytest.mark.parametrize("answer", [(403, {"message": "x"}), (502, {"message": "x"}), httpx.ConnectError("x")])
async def test_factory_unavailable(answer):
    registry, client = client_of()
    registry.answers[factory_path()] = answer
    with pytest.raises(Refused) as caught:
        await client.factory(FACTORY_ID)
    assert caught.value.kind == "unavailable" and "registry.test" not in caught.value.message


# ── Health ──────────────────────────────────────────────────────────────────


async def ifric_check(registry, token="tok", participant=FACTORY, url=REGISTRY):  # noqa: S107
    client = RegistryClient(make_settings(ifric_url=url), lambda: token, transport=registry.transport())

    class Connection:
        participant_id = participant

    class Gateway:
        connection = Connection()

    settings = make_settings()
    service = HealthService(
        settings, Migrator(settings.postgres_memory_url.get_secret_value()), gateway=Gateway(), registry=client
    )
    checks = (await service.report(fresh=True))["checks"]
    return next(c for c in checks if c["id"] == "ifric")


async def test_health_ok():
    registry = Registry()
    registry.answers[company_path(FACTORY)] = (200, [{"company_name": "Me"}])
    check = await ifric_check(registry)
    assert check["status"] == "ok" and check["label"] == "IFRIC registry"


@pytest.mark.parametrize("status", [401, 403])
async def test_health_treats_refusals_as_failures(status):
    registry = Registry()
    registry.answers[company_path(FACTORY)] = (status, {"message": "x"})
    check = await ifric_check(registry)
    assert check["status"] == "error" and "refused the dataspace token" in check["detail"]


async def test_health_when_down_or_failing():
    registry = Registry()
    registry.answers[company_path(FACTORY)] = httpx.ConnectError("x")
    assert (await ifric_check(registry))["status"] == "error"
    registry.answers[company_path(FACTORY)] = (500, {"message": "x"})
    assert (await ifric_check(registry))["status"] == "error"


async def test_health_without_a_token():
    check = await ifric_check(Registry(), participant=None)
    assert check["status"] == "degraded" and "Not connected" in check["detail"]


async def test_health_not_configured_does_not_count():
    settings = make_settings()
    service = HealthService(settings, Migrator(settings.postgres_memory_url.get_secret_value()))
    report = await service.report(fresh=True)
    check = next(c for c in report["checks"] if c["id"] == "ifric")
    assert check["status"] == "ok" and "No IFRIC" in check["detail"] and report["overall"] == "error"


# ── Through the application ─────────────────────────────────────────────────


class Both(Dataspace):
    def __init__(self) -> None:
        super().__init__()
        self.registry = Registry()

    async def handle(self, request):
        if request.url.host == "registry.test":
            return await self.registry.handle(request)
        return await super().handle(request)


def app_with(space, **settings):
    script = StepScript("clarified")
    agent = AgentDeps(
        llm=script.model(),
        context=FakeContextSource(sample_entities()),
        history=FakeHistorySource(sample_history()),
        machines=MachineResolver(CLOSED_HTTP),
    )
    values = gateway_settings(llm_provider="scripted", ifric_url=REGISTRY, factory_id=FACTORY_ID, **settings)
    return create_app(values, agent=agent, gateway_transport=space.transport())


def test_routes_and_peer_names():
    space = Both()
    registry = space.registry
    registry.answers[company_path(BUILDER)] = (200, [{"company_name": "Builder GmbH"}])
    registry.answers[asset_path()] = (200, {"company_ifric_id": BUILDER, "company_name": "Builder GmbH"})
    registry.answers[factory_path()] = (200, {"factory_id": FACTORY_ID, "location_name": "Plant"})
    with TestClient(app_with(space, gateway_client_secret=SECRET)) as client:
        assert client.get("/api/ifric/config").json() == {"configured": True, "factory_id": FACTORY_ID}
        assert client.get("/api/ifric/status").json()["state"] == "degraded"
        # Not connected yet: a name is empty, and the peer list isn't available at all.
        assert client.post("/api/ifric/resolve", json={"ids": [BUILDER]}).json() == {BUILDER: ""}
        assert client.get("/api/ifric/factory").status_code == 503
        assert client.post("/api/gateway/connect", json={}).json()["state"] == "connected"
        registry.answers[company_path(FACTORY)] = (403, {"message": "x"})
        assert client.get("/api/ifric/status").json()["state"] == "error"
        registry.answers[company_path(FACTORY)] = (200, [{"company_name": "Me"}])
        assert client.get("/api/ifric/status").json()["state"] == "ok"
        assert client.post("/api/ifric/resolve", json={"ids": [BUILDER]}).json() == {BUILDER: "Builder GmbH"}
        builders = client.post("/api/ifric/resolve-builders", json={"machine_ids": [MACHINE, "urn:x"]}).json()
        assert builders == {MACHINE: "Builder GmbH"}
        registry.answers[f"/company/assets/{MACHINE.replace(':', '%3A')}"] = (200, {"asset_name": "Press 1"})
        machines = client.post("/api/ifric/resolve-machines", json={"machine_ids": [MACHINE, "urn:x"]}).json()
        assert machines == {MACHINE: "Press 1"}
        assert client.get("/api/ifric/factory").json()["name"] == "Plant"
        peers = client.get("/api/gateway/peers").json()
        assert peers[0]["name"] == "Builder GmbH" and peers[0]["id"] == BUILDER
        assert client.get(f"/api/gateway/peers/{BUILDER}/capabilities").json()["name"] == "Builder GmbH"
        # The registry going away leaves the peer with its ID.
        registry.answers[company_path(BUILDER)] = httpx.ConnectError("x")
        assert client.get("/api/gateway/peers").json()[0]["name"] == BUILDER
        too_many = client.post("/api/ifric/resolve", json={"ids": [f"u{n}" for n in range(MAX_RESOLVED + 1)]})
        assert too_many.status_code == 422


def test_not_configured_routes():
    space = Both()
    settings = gateway_settings(llm_provider="scripted")
    agent = AgentDeps(
        llm=StepScript("clarified").model(),
        context=FakeContextSource(sample_entities()),
        history=FakeHistorySource(sample_history()),
        machines=MachineResolver(CLOSED_HTTP),
    )
    with TestClient(create_app(settings, agent=agent, gateway_transport=space.transport())) as client:
        assert client.get("/api/ifric/config").json()["configured"] is False
        assert client.get("/api/ifric/status").json()["state"] == "not_configured"
        assert client.get("/api/ifric/factory").status_code == 404  # no factory ID either
        assert space.registry.paths == []


# ── The stub of the local environment ───────────────────────────────────────


def test_the_stub_answers_like_the_registry():
    assert ifric_stub.answer_for("/company/get-company-details/urn%3Anobody") == []
    assert ifric_stub.answer_for(f"/company/get-company-details/{ifric_stub.BUILDER}")[0]["company_name"]
    assert ifric_stub.answer_for("/company/assets/urn%3Angsi-ld%3AMachine%3Ax/manufacturer")["company_ifric_id"]
    assert ifric_stub.answer_for("/company/assets/urn%3Aother/manufacturer")["company"] is None
    assert ifric_stub.answer_for("/company/factories/urn%3Anone") == {
        "factory": None,
        "message": "No factory data found",
    }
    assert ifric_stub.answer_for(f"/company/factories/{ifric_stub.FACTORY}/owner")["company_name"]
    assert ifric_stub.answer_for("/anything") is None


# ── What must not exist ─────────────────────────────────────────────────────

ROOT = pathlib.Path(__file__).resolve().parents[2]
RETIRED = re.compile("IFRIC_" + "REFRESH_TOKEN|company/" + r"products")
SKIPPED = {"node_modules", ".venv", "dist", "archive", ".git", "__pycache__", "test-results", "playwright-report"}


def current_files():
    for path in ROOT.rglob("*"):
        if path.is_file() and not SKIPPED & set(path.relative_to(ROOT).parts):
            yield path


def test_retired_names_appear_nowhere():
    found = [str(p) for p in current_files() if RETIRED.search(p.read_text(errors="ignore"))]
    assert found == []


def test_nothing_in_the_agent_reaches_the_registry():
    sources = (ROOT / "backend" / "agent" / "xana_agent").rglob("*")
    hits = [str(p) for p in sources if p.is_file() and p.suffix in (".py", ".md") and "ifric" in p.read_text().lower()]
    assert hits == []


def test_ifric_url_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("IFRIC_URL", "registry:4007")
    assert load_settings(_env_file=None).ifric_url == "http://registry:4007"


# ── More names: directory, factory owner, asset names ───────────────────────

PEER = "urn:ifric:ifx-eur-com-peer"
DIRECTORY = "/company/get-all-companies"


def directory(*companies):
    return (200, [{"company_ifric_id": i, "company_name": n, "company_image": None} for i, n in companies])


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


async def test_a_peer_refused_in_the_details_is_named_by_the_directory():
    registry, client = client_of()
    registry.answers[company_path(PEER)] = (403, {"message": "Forbidden"})
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"), (BUILDER, "Builder GmbH"))
    assert await client.names([PEER]) == {PEER: "Peer Werke"}


async def test_a_company_the_details_dont_know_is_named_by_the_directory():
    registry, client = client_of()
    registry.answers[company_path(PEER)] = (200, {"company": None})
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"))
    assert await client.names([PEER]) == {PEER: "Peer Werke"}


async def test_a_factory_is_named_by_its_owner():
    registry, client = client_of()
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"))
    registry.answers[factory_path("/owner")] = (200, {"owner": {"company_name": "Factory Owner AG"}})
    assert await client.names([FACTORY_ID]) == {FACTORY_ID: "Factory Owner AG"}


async def test_the_directory_is_read_once_in_300_seconds_and_again_with_another_token():
    token = {"value": "one"}
    registry = Registry()
    clock = Clock()
    client = RegistryClient(
        make_settings(ifric_url=REGISTRY), lambda: token["value"], transport=registry.transport(), clock=clock
    )
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"))
    await asyncio.gather(*(client.names([PEER]) for _ in range(5)))
    clock.now += 299
    await client.names([PEER])
    assert registry.paths.count(DIRECTORY) == 1
    clock.now += 2
    await client.names([PEER])
    assert registry.paths.count(DIRECTORY) == 2
    token["value"] = "two"
    await client.names([PEER])
    assert registry.paths.count(DIRECTORY) == 3


async def test_a_directory_that_fails_leaves_the_name_out_and_the_answer_goes_on():
    registry, client = client_of()
    registry.answers[company_path(BUILDER)] = (200, {"company_name": "Builder GmbH"})
    registry.answers[DIRECTORY] = httpx.ConnectError("refused")
    assert await client.names([PEER, BUILDER]) == {BUILDER: "Builder GmbH"}


@pytest.mark.parametrize("field", ["asset_name", "product_name", "name"])
async def test_machines_are_named_by_their_asset(field):
    registry, client = client_of()
    registry.answers[f"/company/assets/{MACHINE.replace(':', '%3A')}"] = (200, {field: "Laser cutter L3"})
    assert await client.machine_names([MACHINE, MACHINE]) == {MACHINE: "Laser cutter L3"}
    assert registry.paths == [f"/company/assets/{MACHINE.replace(':', '%3A')}"]


async def test_a_machine_without_an_asset_name_is_left_out():
    registry, client = client_of()
    other = "urn:ngsi-ld:Machine:other"
    # An asset record that holds IDs only, as the registry service's does.
    registry.answers[f"/company/assets/{MACHINE.replace(':', '%3A')}"] = (
        200,
        {"asset_ifric_id": MACHINE, "is_twin": True},
    )
    registry.answers[f"/company/assets/{other.replace(':', '%3A')}"] = (403, {"message": "Forbidden"})
    assert await client.machine_names([MACHINE, other, "urn:ngsi-ld:Machine:unknown"]) == {}


async def test_machine_names_without_a_registry_or_a_token():
    assert await RegistryClient(make_settings(), lambda: "t").machine_names([MACHINE]) == {}
    registry = Registry()
    client = RegistryClient(make_settings(ifric_url=REGISTRY), lambda: None, transport=registry.transport())
    assert await client.machine_names([MACHINE]) == {} and registry.paths == []


async def test_too_many_machines_are_refused():
    _, client = client_of()
    with pytest.raises(Refused):
        await client.machine_names([f"urn:m:{n}" for n in range(MAX_RESOLVED + 1)])


# ── A slow or failing registry ──────────────────────────────────────────────


class Hanging(Registry):
    """A registry that takes `seconds` to answer anything, as a hung one does."""

    def __init__(self, seconds: float) -> None:
        super().__init__()
        self.seconds = seconds

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.raw_path.decode())
        await asyncio.sleep(self.seconds)
        return httpx.Response(200, json={"company": None})


def hanging_client(seconds=30.0, clock=None):
    registry = Hanging(seconds)
    kwargs = {"clock": clock} if clock else {}
    client = RegistryClient(make_settings(ifric_url=REGISTRY), lambda: "t", transport=registry.transport(), **kwargs)
    return registry, client


async def test_a_hanging_registry_gives_names_within_one_time_however_many_ids():
    registry, client = hanging_client()
    ids = [f"urn:ifric:peer-{n}" for n in range(6)]
    started = asyncio.get_running_loop().time()
    names = await asyncio.wait_for(client.names(ids), 6)
    took = asyncio.get_running_loop().time() - started
    assert names == {i: "" for i in ids}
    assert took < NAMES_WITHIN_S + 0.5, took
    asked = len(registry.paths)
    # It isn't asked again for a while: the next lookup answers at once, with no request.
    started = asyncio.get_running_loop().time()
    assert await client.names(ids) == {i: "" for i in ids}
    assert asyncio.get_running_loop().time() - started < 0.2 and len(registry.paths) == asked


async def test_a_registry_that_cant_be_reached_isnt_asked_for_owners_or_the_directory():
    registry, client = client_of()
    for n in range(6):
        registry.answers[company_path(f"urn:ifric:peer-{n}")] = httpx.ConnectError("refused")
    names = await client.names([f"urn:ifric:peer-{n}" for n in range(6)])
    assert set(names.values()) == {""}
    assert not [p for p in registry.paths if p.endswith("/owner") or p == "/company/get-all-companies"]


async def test_the_registry_is_asked_again_after_a_while():
    clock = Clock()
    registry, client = hanging_client(seconds=30.0, clock=clock)
    await client.names(["urn:ifric:a"])
    asked = len(registry.paths)
    clock.now += DOWN_FOR_S + 1
    registry.seconds = 0
    await client.names(["urn:ifric:a"])
    assert len(registry.paths) > asked


async def test_machine_names_within_one_time():
    _, client = hanging_client()
    started = asyncio.get_running_loop().time()
    assert await asyncio.wait_for(client.machine_names([f"urn:m:{n}" for n in range(20)]), 6) == {}
    assert asyncio.get_running_loop().time() - started < NAMES_WITHIN_S + 0.5


async def test_peers_and_access_levels_answer_in_time_with_the_registry_hanging():
    space = Dataspace()
    peers = [f"urn:example:builder-{n}" for n in range(6)]
    space.compatible_ids = peers
    from app.dataspace.gateway import GatewayClient
    from tests.test_gateway import connection

    conn = connection(space)
    await conn.connect(SECRET)
    _, registry = hanging_client()
    gateway = GatewayClient(conn, transport=space.transport(), names=registry.names)
    for read in (gateway.peers, gateway.access_levels):
        started = asyncio.get_running_loop().time()
        await asyncio.wait_for(read(), 8)
        assert asyncio.get_running_loop().time() - started < NAMES_WITHIN_S + 1
    await conn.close()


class Slow(Registry):
    """A healthy registry that takes `seconds` per answer, or longer for some paths."""

    def __init__(self, seconds: float, slower: dict[str, float] | None = None) -> None:
        super().__init__()
        self.seconds = seconds
        self.slower = slower or {}

    async def handle(self, request: httpx.Request) -> httpx.Response:
        raw = request.url.raw_path.decode()
        self.paths.append(raw)
        await asyncio.sleep(self.slower.get(raw, self.seconds))
        answer = self.answers.get(raw, (200, {"company": None}))
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(answer[0], json=answer[1])


def slow_client(registry):
    return RegistryClient(make_settings(ifric_url=REGISTRY), lambda: "t", transport=registry.transport())


async def test_the_kept_directory_names_companies_while_the_registry_is_down():
    registry, client = client_of()
    registry.answers[company_path(PEER)] = (403, {"message": "Forbidden"})
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"))
    assert await client.names([PEER]) == {PEER: "Peer Werke"}
    for path in (company_path(PEER), DIRECTORY):
        registry.answers[path] = httpx.ConnectError("refused")  # the registry goes away
    assert await client.names([PEER]) == {PEER: "Peer Werke"}  # from the directory kept for 300 s
    assert await client.names([PEER, BUILDER]) == {PEER: "Peer Werke", BUILDER: ""}


async def test_a_long_list_on_a_slow_healthy_registry_does_not_pause_it():
    registry = Slow(0.4)
    registry.answers[company_path(BUILDER)] = (200, {"company_name": "Builder GmbH"})
    client = slow_client(registry)
    ids = [f"urn:ifric:many-{n}" for n in range(80)]
    started = asyncio.get_running_loop().time()
    await client.names(ids)  # more than the time allows: the rest is left out of this answer only
    assert asyncio.get_running_loop().time() - started < NAMES_WITHIN_S + 0.5
    asked = len(registry.paths)
    assert await client.names([BUILDER]) == {BUILDER: "Builder GmbH"}  # still asked
    assert len(registry.paths) > asked


async def test_one_server_error_does_not_pause_the_other_ids():
    registry, client = client_of()
    broken = "urn:ifric:broken"
    registry.answers[company_path(broken)] = (500, {"message": "boom"})
    others = [f"urn:ifric:fine-{n}" for n in range(11)]
    for n, other in enumerate(others):
        registry.answers[company_path(other)] = (200, {"company_name": f"Fine {n}"})
    names = await client.names([broken, *others])
    assert names == {broken: ""} | {other: f"Fine {n}" for n, other in enumerate(others)}
    assert await client.names([others[0]]) == {others[0]: "Fine 0"}


async def test_repeated_server_errors_pause_the_registry():
    registry, client = client_of()
    ids = [f"urn:ifric:down-{n}" for n in range(3)]
    for i in ids:
        registry.answers[company_path(i)] = (503, {"message": "down"})
    registry.answers[DIRECTORY] = (503, {"message": "down"})
    await client.names(ids)
    asked = len(registry.paths)
    assert await client.names(["urn:ifric:other"]) == {"urn:ifric:other": ""}
    assert len(registry.paths) == asked


async def test_a_slow_directory_is_read_once_in_the_background_and_kept_for_next_time():
    registry = Slow(0.01, slower={DIRECTORY: 4.0})
    registry.answers[company_path(PEER)] = (403, {"message": "Forbidden"})
    registry.answers[DIRECTORY] = directory((PEER, "Peer Werke"))
    client = slow_client(registry)
    first, second = await asyncio.gather(client.names([PEER]), client.names([PEER]))
    assert first == second == {PEER: ""}  # the time was up before the directory came
    await asyncio.sleep(1.5)  # the read goes on and is kept
    assert await client.names([PEER]) == {PEER: "Peer Werke"}
    assert registry.paths.count(DIRECTORY) == 1
