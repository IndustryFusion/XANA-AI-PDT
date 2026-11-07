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
"""Service settings, read-only: addresses are set at deployment, and none is taken from a browser."""

from fastapi import APIRouter, Request

from app.config import Settings
from app.redact import mask_url

router = APIRouter(prefix="/api", tags=["config"])


def service_settings(s: Settings) -> list[dict[str, object]]:
    addresses = [
        ("context_broker", "Context broker", s.ngsi_url),
        ("timeseries_store", "Time-series store", s.timescale_db_url.get_secret_value()),
        ("memory_database", "Memory database", s.postgres_memory_url.get_secret_value()),
        ("message_broker", "Message broker", s.mqtt_broker_url),
        ("history_service", "History service", s.pgrest_url),
        ("alert_manager", "Alert manager", s.alerta_url),
        ("ontology", "Ontology", s.fuseki_url),
        ("identity_provider", "Identity provider", s.keycloak_url),
        ("gateway", "Dataspace gateway", s.gateway_url),
        ("ifric_registry", "IFRIC registry", s.ifric_url),
        ("machine_events_callback", "Machine events callback", s.callback_base_url),
    ]
    return [
        {
            "key": key,
            "label": label,
            "value": mask_url(address),
            "deployment_value": mask_url(address),
            "changed": False,
            "editable": False,
        }
        for key, label, address in addresses
        if address
    ]


@router.get("/config")
async def config(request: Request) -> list[dict[str, object]]:
    return service_settings(request.app.state.settings)
