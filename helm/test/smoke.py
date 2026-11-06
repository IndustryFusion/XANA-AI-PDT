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
"""Checks an install through its public address: a run, its live stream, a large upload and a screen.

    python helm/test/smoke.py http://127.0.0.1 --host xana.localhost run
    python helm/test/smoke.py http://127.0.0.1 --host xana.localhost after-restart

Needs httpx and websockets. `run` leaves the run's ID in `.smoke-run`, for `after-restart`.
"""

import argparse
import asyncio
import json
import pathlib
import sys
import time
from urllib.parse import urlsplit

import httpx
from websockets.asyncio.client import connect

MACHINE = "laser-cutter-01"
STATE = pathlib.Path(".smoke-run")


def fail(message: str) -> None:
    sys.exit(f"FAILED: {message}")


def wait_for_machine(client: httpx.Client) -> str:
    """Retries until the sample data has been loaded, then starts a run."""
    deadline = time.monotonic() + 300
    while True:
        response = client.post("/api/agent/run", json={"machine_id": MACHINE, "issue": "Cut edges show burrs"})
        if response.status_code == 202:
            return response.json()["run_id"]
        if time.monotonic() > deadline:
            fail(f"could not start a run: {response.status_code} {response.text}")
        time.sleep(5)


async def stream_until_waiting(url: str, host: str | None, run_id: str) -> list[str]:
    # With --host, the address names that host, and the connection still goes to `url`.
    target = urlsplit(url)
    uri = f"ws://{host or target.netloc}/ws/run/{run_id}"
    steps: list[str] = []
    async with connect(uri, host=target.hostname, port=target.port or 80) as socket:
        async with asyncio.timeout(120):
            async for raw in socket:
                event = json.loads(raw)
                if event["type"] == "snapshot":
                    steps += [s["node"] for s in event["run"]["steps"]]
                    if event["run"]["status"] != "running":
                        return steps
                elif event["type"] == "step":
                    steps.append(event["node"])
                elif event["type"] == "status" and event["status"] != "running":
                    return steps
    return steps


def run(client: httpx.Client, url: str, host: str | None) -> None:
    screen = client.get("/incidents")
    if screen.status_code != 200 or "<div id=" not in screen.text:
        fail(f"a screen's address does not serve the UI: {screen.status_code}")
    print("screen address: ok")

    run_id = wait_for_machine(client)
    steps = asyncio.run(stream_until_waiting(url, host, run_id))
    if "observe" not in steps:
        fail(f"the stream delivered no observe step: {steps}")
    print(f"run {run_id} over the stream: {steps}")
    STATE.write_text(run_id)

    # Above nginx's default limit of 1 MB. The backend answers, so the proxy did not refuse it.
    big = client.post(f"/api/agent/clarify/{run_id}", content=b"x" * (2 * 1024 * 1024))
    if big.status_code == 413:
        fail("the proxy refused a 2 MB body")
    print(f"2 MB body reached the backend: {big.status_code}")


def after_restart(client: httpx.Client) -> None:
    run_id = STATE.read_text().strip()
    deadline = time.monotonic() + 120
    while True:
        try:
            response = client.get(f"/api/agent/status/{run_id}")
            if response.status_code == 200:
                print(f"run kept after the restart: {response.json()['status']}")
                return
        except httpx.HTTPError:
            pass
        if time.monotonic() > deadline:
            fail(f"run {run_id} is gone after the restart")
        time.sleep(3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("check", choices=["run", "after-restart"])
    parser.add_argument("--host")
    args = parser.parse_args()
    headers = {"Host": args.host} if args.host else {}
    with httpx.Client(base_url=args.url, headers=headers, timeout=60) as client:
        if args.check == "run":
            run(client, args.url, args.host)
        else:
            after_restart(client)


if __name__ == "__main__":
    main()
