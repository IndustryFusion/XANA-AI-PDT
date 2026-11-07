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
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.health import HealthService, overall
from app.main import create_app
from app.memory.migrate import Migrator
from tests.conftest import make_settings


def stub(status="ok", detail="fine", delay=0.0, error=None):
    async def probe():
        if delay:
            await asyncio.sleep(delay)
        if error:
            raise error
        return status, detail

    return probe


def service(probes, clock=None, **settings):
    s = make_settings(**settings)
    kwargs = {"clock": clock} if clock else {}
    return HealthService(s, Migrator(s.postgres_memory_url.get_secret_value()), probes=probes, **kwargs)


def test_overall_rule():
    assert overall(["ok", "ok"]) == "ok"
    assert overall(["error", "error"]) == "error"
    assert overall(["ok", "error"]) == "degraded"
    assert overall(["ok", "degraded"]) == "degraded"


async def test_all_reachable():
    report = await service({c: stub() for c in ("memory", "timeseries", "broker", "llm")}).report()
    assert report["overall"] == "ok"
    assert [c["id"] for c in report["checks"]] == ["memory", "timeseries", "broker", "llm"]
    assert all(c["status"] == "ok" and isinstance(c["latency_ms"], int) for c in report["checks"])


async def test_one_down():
    probes = {c: stub() for c in ("memory", "timeseries", "llm")}
    probes["broker"] = stub(error=httpx.ConnectError("connection refused"))
    report = await service(probes).report()
    broker = next(c for c in report["checks"] if c["id"] == "broker")
    assert broker["status"] == "error"
    assert "Not reachable" in broker["detail"]
    assert report["overall"] == "degraded"
    assert sum(c["status"] == "ok" for c in report["checks"]) == 3


async def test_slow_dependency_times_out():
    probes = {"memory": stub(), "broker": stub(delay=5)}
    loop = asyncio.get_running_loop()
    start = loop.time()
    report = await service(probes, health_timeout_s=0.3).report()
    assert loop.time() - start < 1.0
    broker = next(c for c in report["checks"] if c["id"] == "broker")
    assert broker["status"] == "error"
    assert "No answer within 0.3 s" in broker["detail"]


async def test_cached_and_fresh():
    calls = []
    now = [100.0]

    async def counting():
        calls.append(1)
        return "ok", "fine"

    svc = service({"memory": counting}, clock=lambda: now[0], health_cache_s=10)
    first = await svc.report()
    now[0] += 5
    second = await svc.report()
    assert second is first
    assert len(calls) == 1
    third = await svc.report(fresh=True)
    assert len(calls) == 2
    assert third["checked_at"] >= first["checked_at"]
    now[0] += 11
    await svc.report()
    assert len(calls) == 3


async def test_nothing_reachable_real_probes():
    s = make_settings()
    report = await HealthService(s, Migrator(s.postgres_memory_url.get_secret_value())).report()
    assert report["overall"] == "error"
    assert {c["status"] for c in report["checks"] if c["id"] not in ("gateway", "connector", "ifric", "machine_events")} == {"error"}


async def test_password_masked_in_detail_and_log(caplog):
    s = make_settings(health_timeout_s=1)
    svc = HealthService(
        s,
        Migrator(s.postgres_memory_url.get_secret_value()),
        probes={"memory": stub(error=OSError("cannot reach postgresql://xana:s3cret-pw@127.0.0.1:1"))},
    )
    with caplog.at_level(logging.WARNING):
        report = await svc.report()
    assert "s3cret-pw" not in str(report)
    assert "s3cret-pw" not in caplog.text
    assert "***" in report["checks"][0]["detail"]


def ollama_tags(models):
    def handler(request):
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": m} for m in models]})

    return httpx.MockTransport(handler)


@pytest.mark.parametrize(
    ("models", "status"),
    [(["llama3.1:latest"], "ok"), (["llama3.1"], "ok"), (["mistral:latest"], "degraded")],
)
async def test_ollama_model_presence(models, status):
    s = make_settings()
    svc = HealthService(s, Migrator(""), transport=ollama_tags(models))
    assert (await svc._llm())[0] == status


async def test_scripted_llm_check_says_scripted():
    s = make_settings(llm_provider="scripted")
    status, detail = await HealthService(s, Migrator(""))._llm()
    assert status == "ok"
    assert "Scripted" in detail


async def test_cloud_key_rejected():
    s = make_settings(llm_provider="anthropic", anthropic_api_key="sk-ant-xyz1")
    transport = httpx.MockTransport(lambda request: httpx.Response(401))
    status, detail = await HealthService(s, Migrator(""), transport=transport)._llm()
    assert status == "error"
    assert "rejected the API key" in detail
    assert "sk-ant-xyz1" not in detail


async def test_broker_probe():
    s = make_settings(ngsi_tenant="plant")

    def handler(request):
        assert request.url.path == "/ngsi-ld/v1/types"
        assert request.headers["NGSILD-Tenant"] == "plant"
        return httpx.Response(200, json=[])

    status, _ = await HealthService(s, Migrator(""), transport=httpx.MockTransport(handler))._broker()
    assert status == "ok"


def test_app_starts_without_dependencies():
    with TestClient(create_app(make_settings())) as client:
        response = client.get("/api/diagnostics", params={"fresh": "true"})
    assert response.status_code == 200
    body = response.json()
    assert body["overall"] == "error"
    assert {c["id"] for c in body["checks"]} == {
        "memory",
        "timeseries",
        "broker",
        "llm",
        "gateway",
        "connector",
        "machine_events",
        "ifric",
    }


def openai_models(status=200, models=("m1",)):
    def handle(request):
        return httpx.Response(status, json={"object": "list", "data": [{"id": m} for m in models]})

    return httpx.MockTransport(handle)


async def test_openai_compatible_server_without_key():
    s = make_settings(
        llm_provider="openai", openai_base_url="http://ovms/v3", llm_model="m1", llm_provider_name="OpenVINO"
    )
    status, detail = await HealthService(s, Migrator(""), transport=openai_models())._llm()
    assert status == "ok"
    assert "OpenVINO" in detail


async def test_openai_compatible_server_without_the_model():
    s = make_settings(llm_provider="openai", openai_base_url="http://ovms/v3", llm_model="other")
    status, detail = await HealthService(s, Migrator(""), transport=openai_models())._llm()
    assert status == "degraded"
    assert "does not list model other" in detail


async def test_model_list_follows_the_language_model_check():
    probes = {c: stub() for c in ("memory", "timeseries", "broker", "llm")}
    report = await service(probes, llm_model="m1", llm_provider_name="OpenVINO").report()
    assert report["models"] == [{"name": "m1", "role": "agent", "provider": "OpenVINO", "available": True}]
    probes["llm"] = stub(status="degraded", detail="not downloaded")
    report = await service(probes, llm_model="m1").report()
    assert report["models"][0]["available"] is False


async def test_scripted_model_is_listed_as_scripted():
    report = await service({"llm": stub()}, llm_provider="scripted").report()
    assert report["models"][0]["name"] == "scripted"


async def test_model_problem():
    assert await service({"llm": stub()}).model_problem() is None
    problem = await service({"llm": stub(error=httpx.ConnectError("refused"))}).model_problem()
    assert problem.startswith("The language model is not available: Not reachable")
    assert await service({"memory": stub()}).model_problem() is None


async def test_model_problem_within_the_timeout():
    problem = await service({"llm": stub(delay=5)}, health_timeout_s=0.05).model_problem()
    assert "No answer within" in problem


def test_liveness_answers_without_dependencies():
    with TestClient(create_app(make_settings(llm_provider="scripted"))) as client:
        assert client.get("/healthz").json() == {"status": "ok"}


@pytest.mark.parametrize("status", [404, 405, 501])
async def test_a_server_without_a_model_list_does_not_block_work(status):
    s = make_settings(llm_provider="openai", llm_model="m1", openai_base_url="http://ovms/v3")
    svc = HealthService(s, Migrator(""), transport=openai_models(status=status))
    state, detail = await svc._llm()
    assert state == "degraded"
    assert "does not list its models" in detail
    assert await svc.model_problem() is None
    assert (await svc.report(fresh=True))["models"][0]["available"] is True


async def test_a_slow_model_list_does_not_block_work():
    def slow(request):
        raise httpx.ReadTimeout("slow", request=request)

    s = make_settings(llm_provider="openai", llm_model="m1", openai_base_url="http://ovms/v3")
    svc = HealthService(s, Migrator(""), transport=httpx.MockTransport(slow))
    assert await svc.model_problem() is None


async def test_a_server_that_cannot_be_reached_still_blocks_work():
    def down(request):
        raise httpx.ConnectError("refused", request=request)

    s = make_settings(llm_provider="openai", llm_model="m1", openai_base_url="http://ovms/v3")
    svc = HealthService(s, Migrator(""), transport=httpx.MockTransport(down))
    assert "not available" in await svc.model_problem()


@pytest.mark.parametrize(("status", "blocks"), [(500, True), (401, True), (403, True), (200, False)])
async def test_other_model_list_answers(status, blocks):
    s = make_settings(llm_provider="openai", llm_model="m1", openai_base_url="http://ovms/v3")
    svc = HealthService(s, Migrator(""), transport=openai_models(status=status))
    assert (await svc.model_problem() is not None) is blocks


async def test_a_listed_server_without_the_model_still_blocks_work():
    s = make_settings(llm_provider="openai", llm_model="absent", openai_base_url="http://ovms/v3")
    svc = HealthService(s, Migrator(""), transport=openai_models())
    assert "does not list model absent" in await svc.model_problem()
