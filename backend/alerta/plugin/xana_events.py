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
"""An Alerta plugin that sends each alert it receives to XANA's `POST /events/alert`.

Alerta has no outbound webhook of its own. Set `XANA_EVENTS_URL` and `EVENT_WEBHOOK_SECRET`; without them it does
nothing. It never fails an alert: Alerta goes on whatever happens to XANA.
"""

import logging
import os

import requests
from alerta.plugins import PluginBase

log = logging.getLogger("alerta.plugins.xana_events")

TIMEOUT_S = 3


class SendToXana(PluginBase):
    def pre_receive(self, alert, **kwargs):
        return alert

    def post_receive(self, alert, **kwargs):
        url = self.get_config("XANA_EVENTS_URL", default=os.environ.get("XANA_EVENTS_URL"), **kwargs)
        secret = self.get_config("EVENT_WEBHOOK_SECRET", default=os.environ.get("EVENT_WEBHOOK_SECRET"), **kwargs)
        if not url or not secret:
            return alert
        try:
            response = requests.post(
                url,
                json=alert.get_body(history=False),
                headers={"Authorization": f"Bearer {secret}"},
                timeout=TIMEOUT_S,
            )
            if response.status_code >= 400:
                log.warning("XANA answered HTTP %d for alert %s.", response.status_code, alert.id)
        except Exception as error:  # noqa: BLE001 - never fail an alert
            log.warning("XANA could not be told about alert %s (%s).", alert.id, type(error).__name__)
        return alert

    def status_change(self, alert, status, text, **kwargs):
        return None
