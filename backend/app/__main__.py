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
"""Starts the backend: `python -m app`."""

import sys

import uvicorn

from app.config import ConfigError, load_settings
from app.main import configure_logging

GRACEFUL_SHUTDOWN_S = 10


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2
    configure_logging(settings, settings.redactor())
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.backend_reload,
        log_config=None,
        # A client that stopped reading must not hold up a shutdown, which deletes the subscription.
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_S,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
