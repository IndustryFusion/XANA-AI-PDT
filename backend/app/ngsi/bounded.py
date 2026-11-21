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
"""Reading many items with a bound on how many reads run at once."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable

from app.errors import Refused


async def gather_bounded[T](gate: asyncio.Semaphore, items: Iterable[T], read: Callable[[T], Awaitable[None]]) -> None:
    """Runs `read` for every item, at most as many at once as `gate` lets through. A read that refuses fails the
    whole and stops the reads still running; the first refusal is raised as it is."""

    async def one(item: T) -> None:
        async with gate:
            await read(item)

    try:
        async with asyncio.TaskGroup() as group:
            for item in items:
                group.create_task(one(item))
    except* Refused as failed:
        raise failed.exceptions[0] from None
