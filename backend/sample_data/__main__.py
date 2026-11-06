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
"""Loads the sample data: `python -m sample_data`, or with `ontology` for Fuseki's, or `alerts` for Alerta's."""

import logging
import sys

from app.config import ConfigError, load_settings
from app.main import configure_logging
from sample_data.loader import load, load_alerts, load_ontology


def main() -> int:
    try:
        settings = load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2
    configure_logging(settings, settings.redactor())
    try:
        if sys.argv[1:] == ["ontology"]:
            load_ontology(settings)
        elif sys.argv[1:] == ["alerts"]:
            load_alerts(settings)
        else:
            load(settings)
    except Exception as error:  # noqa: BLE001 - reported, then a non-zero exit
        logging.getLogger("sample_data").error("Loading sample data failed: %s", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
