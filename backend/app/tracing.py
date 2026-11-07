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
"""Optional tracing of model calls. Tracing never stands in the way of a run."""

from __future__ import annotations

import inspect
import logging
from typing import Any

from app.config import Settings

log = logging.getLogger(__name__)


def tracing_callbacks(settings: Settings) -> list[Any]:
    """The Langfuse callback when tracing is configured and its package is installed, else nothing."""
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return []
    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler
    except ImportError:
        log.warning("LANGFUSE_* keys are set, but Langfuse is not installed: running without tracing.")
        return []
    try:
        address = settings.langfuse_address
        # Newer clients name the address `base_url`, older ones only `host`.
        named = "base_url" if "base_url" in inspect.signature(Langfuse.__init__).parameters else "host"
        Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key.get_secret_value(),
            **({named: address} if address else {}),
        )
        return [CallbackHandler(public_key=settings.langfuse_public_key)]
    except Exception as error:  # noqa: BLE001 - tracing must never stop a diagnosis
        log.warning("Tracing could not be set up (%s): running without it.", type(error).__name__)
        return []
