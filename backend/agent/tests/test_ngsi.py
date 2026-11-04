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
import json

import httpx
import pytest

from xana_agent.sources import NgsiContextSource, SourceUnavailable
from xana_agent.testing import MACHINE_ID, sample_entities


class StubBroker:
    """An NGSI-LD broker answering from a list of entities; records every request."""

    def __init__(self, entities, status=None):
        self.entities = {e["id"]: e for e in entities}
        self.status = status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status:
            return httpx.Response(self.status)
        path = request.url.path
        if path.startswith("/ngsi-ld/v1/entities/"):
            entity = self.entities.get(path.removeprefix("/ngsi-ld/v1/entities/"))
            return httpx.Response(200, json=entity) if entity else httpx.Response(404)
        name, _, target = request.url.params["q"].partition("==")
        target = json.loads(target)
        found = [e for e in self.entities.values() if (e.get(name) or {}).get("object") == target]
        return httpx.Response(200, json=found[: int(request.url.params["limit"])])


def source(broker, **kwargs):
    return NgsiContextSource("http://broker:9090", transport=httpx.MockTransport(broker), **kwargs)


async def test_get_returns_the_entity():
    broker = StubBroker(sample_entities())
    entity = await source(broker).get(MACHINE_ID)
    assert entity["type"] == "Machine"
    assert broker.requests[0].url.path == f"/ngsi-ld/v1/entities/{MACHINE_ID}"


async def test_missing_entity_is_none():
    assert await source(StubBroker([])).get("urn:ngsi-ld:Machine:nope") is None


async def test_unreachable_broker_raises_source_unavailable():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(SourceUnavailable, match="not reachable"):
        await source(refuse).get(MACHINE_ID)


async def test_broker_error_raises_source_unavailable():
    with pytest.raises(SourceUnavailable, match="HTTP 500"):
        await source(StubBroker([], status=500)).get(MACHINE_ID)


async def test_related_follows_relationships_in_both_directions():
    broker = StubBroker(sample_entities())
    ngsi = source(broker)
    related = await ngsi.related(await ngsi.get(MACHINE_ID), limit=19)
    ids = {e["id"] for e in related}
    assert ids == {
        "urn:ngsi-ld:ProductionLine:line-1",  # the machine's partOf
        "urn:ngsi-ld:Component:press-01-pump",  # partOf pointing to the machine
        "urn:ngsi-ld:Component:press-01-cylinder",
        "urn:ngsi-ld:Sensor:press-01-oil-temperature",  # measures pointing to the machine
    }
    assert "urn:ngsi-ld:Machine:press-02" not in ids


async def test_related_is_capped():
    machine = {"id": "urn:m", "type": "Machine"}
    parts = [
        {"id": f"urn:p{i}", "type": "Component", "partOf": {"type": "Relationship", "object": "urn:m"}}
        for i in range(30)
    ]
    related = await source(StubBroker([machine, *parts])).related(machine, limit=19)
    assert len(related) == 19


async def test_tenant_header_is_sent():
    broker = StubBroker(sample_entities())
    await source(broker, tenant="plant-north").get(MACHINE_ID)
    assert broker.requests[0].headers["NGSILD-Tenant"] == "plant-north"


async def test_only_get_requests_are_sent():
    broker = StubBroker(sample_entities())
    ngsi = source(broker)
    await ngsi.related(await ngsi.get(MACHINE_ID), limit=19)
    assert {r.method for r in broker.requests} == {"GET"}
