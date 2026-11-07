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
"""The Alerts area's access to Alerta: `ALERTA_URL` with `ALERTA_API_KEY`, in the interface's terms.

Answers use the interface's keys, as Alerta's own are camelCase and an alert's `attributes` are data.
Search text never goes to Alerta: its `q` is a query language, in which the text before a colon is
taken for a column, so an entity ID gives a server error.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.errors import Refused, bad_gateway, conflict, invalid, not_found
from app.ngsi.failures import unreachable

SERVICE = "Alerta"
TIMEOUT_S = 10
DEFAULT_STATUSES = ("open", "ack")
ACTIONS = ("ack", "unack", "shelve", "unshelve", "close", "open")
MAX_SEARCHED = 1000
MAX_PAGE_SIZE = 1000
_ALERT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-]*")
PAGE_OUT_OF_RANGE = 416
SEARCHED_FIELDS = ("id", "resource", "event", "text", "value")
SORTS = {"severity": ("severity", "lastReceiveTime"), "time": ("createTime",)}
SUMMARY_FIELDS = (
    "id",
    "resource",
    "event",
    "text",
    "severity",
    "status",
    "environment",
    "service",
    "group",
    "value",
    "origin",
    "type",
    "createTime",
    "lastReceiveTime",
    "duplicateCount",
    "attributes",
)


def _summary(alert: dict[str, Any]) -> dict[str, Any]:
    return {field: alert.get(field) for field in SUMMARY_FIELDS}


def _history(alert: dict[str, Any]) -> list[dict[str, Any]]:
    """Alerta's types, as `new`, `note` or `status`. An entry without a status keeps the one before it."""
    entries = []
    current = alert.get("status")
    known = [item.get("status") for item in alert.get("history", []) if item.get("status")]
    current = known[0] if known else current
    for item in alert.get("history", []):
        current = item.get("status") or current
        kind = item.get("type")
        entries.append(
            {
                "at": item.get("updateTime"),
                "type": kind if kind in ("new", "note") else "status",
                "status": current,
                "severity": item.get("severity"),
                "text": item.get("text") or "",
                "user": item.get("user"),
            }
        )
    return entries


def _detail(alert: dict[str, Any]) -> dict[str, Any]:
    return {**_summary(alert), "history": _history(alert)}


def _contains(alert: dict[str, Any], text: str) -> bool:
    needle = text.casefold()
    values = [str(alert.get(field) or "") for field in SEARCHED_FIELDS]
    values.extend(str(item) for item in alert.get("service") or [])
    return any(needle in value.casefold() for value in values)


def _filters(
    status: list[str] | None, severity: str | None, environment: str | None, service: str | None
) -> list[tuple[str, str | int]]:
    params: list[tuple[str, str | int]] = [("status", item) for item in (status or DEFAULT_STATUSES)]
    if severity:
        params.append(("severity", severity))
    if environment:
        params.append(("environment", environment))
    if service:
        params.append(("service", service))
    return params


class AlertaClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._url = settings.alerta_url.rstrip("/")
        key = settings.alerta_api_key
        self._headers = {"Accept": "application/json"}
        if key:
            self._headers["Authorization"] = f"Key {key.get_secret_value()}"
        self.refresh_interval_s = settings.alerts_refresh_interval_s
        self._transport = transport

    async def _call(self, method: str, path: str, *, params: Any = None, body: Any = None) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.request(
                    method, f"{self._url}{path}", params=params, json=body, headers=self._headers
                )
        except httpx.HTTPError as error:
            raise unreachable(SERVICE, error) from None
        status = response.status_code
        if status in (401, 403):
            # The key is the backend's, so this isn't the operator's sign-in failing.
            raise bad_gateway(f"{SERVICE} refused the configured API key (HTTP {status}).")
        if status >= 400:
            raise _refusal(response)
        try:
            answer = response.json()
        except ValueError:
            raise bad_gateway(
                f"{SERVICE} sent an answer that isn't JSON; check that ALERTA_URL ends in /api."
            ) from None
        if not isinstance(answer, dict):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer.")
        return answer

    async def list_alerts(
        self,
        *,
        status: list[str] | None = None,
        severity: str | None = None,
        environment: str | None = None,
        service: str | None = None,
        text: str | None = None,
        sort: str = "severity",
        page: int = 1,
        page_size: int = 50,
    ) -> dict[str, Any]:
        if sort not in SORTS:
            raise invalid("Sort by severity or time.")
        if page < 1 or not 1 <= page_size <= MAX_PAGE_SIZE:
            raise invalid(f"The page starts from 1, and a page holds 1 to {MAX_PAGE_SIZE} alerts.")
        order = [("sort-by", field) for field in SORTS[sort]]
        if text and text.strip():
            return await self._searched(status, severity, environment, service, text.strip(), order, page, page_size)
        paging = [("page", page), ("page-size", page_size)]
        filters = _filters(status, severity, environment, service)
        try:
            answer = await self._call("GET", "/alerts", params=[*filters, *order, *paging])
        except Refused as refused:
            if refused.http_status != PAGE_OUT_OF_RANGE:
                raise
            # Past the last page there is nothing to show, and that is no failure.
            answer = await self._call("GET", "/alerts/count", params=filters)
            answer = {"alerts": [], "total": answer.get("total", 0)}
        counts = await self._call("GET", "/alerts/count", params=_filters(status, None, environment, service))
        return {
            "alerts": [_summary(alert) for alert in answer.get("alerts", [])],
            "total": answer.get("total", 0),
            "bySeverity": counts.get("severityCounts", {}),
            "page": page,
            "pageSize": page_size,
        }

    async def _searched(
        self,
        status: list[str] | None,
        severity: str | None,
        environment: str | None,
        service: str | None,
        text: str,
        order: list[tuple[str, str]],
        page: int,
        page_size: int,
    ) -> dict[str, Any]:
        params = [*_filters(status, None, environment, service), *order, ("page", 1), ("page-size", MAX_SEARCHED)]
        answer = await self._call("GET", "/alerts", params=params)
        found = [alert for alert in answer.get("alerts", []) if _contains(alert, text)]
        by_severity = Counter(str(alert.get("severity")) for alert in found)
        if severity:
            found = [alert for alert in found if alert.get("severity") == severity]
        start = (page - 1) * page_size
        return {
            "alerts": [_summary(alert) for alert in found[start : start + page_size]],
            "total": len(found),
            "bySeverity": dict(by_severity),
            "page": page,
            "pageSize": page_size,
            "searchLimited": answer.get("total", 0) > MAX_SEARCHED,
            "searched": min(answer.get("total", 0), MAX_SEARCHED),
        }

    async def count(self, status: list[str] | None = None) -> dict[str, Any]:
        answer = await self._call("GET", "/alerts/count", params=_filters(status, None, None, None))
        return {"total": answer.get("total", 0), "bySeverity": answer.get("severityCounts", {})}

    async def alert(self, alert_id: str) -> dict[str, Any]:
        answer = await self._call("GET", f"/alert/{_segment(alert_id)}")
        if not isinstance(answer.get("alert"), dict):
            raise bad_gateway(f"{SERVICE} sent an unexpected answer; check that ALERTA_URL ends in /api.")
        return _detail(answer["alert"])

    async def apply_action(self, alert_id: str, action: str, text: str | None = None) -> dict[str, Any]:
        # Alerta takes any other word with a 200, and only records it as a note.
        if action not in ACTIONS:
            raise invalid(f"{action} is not an action. Use one of: {', '.join(ACTIONS)}.")
        body = {"action": action, "text": text or ""}
        await self._call("PUT", f"/alert/{_segment(alert_id)}/action", body=body)
        return await self.alert(alert_id)

    async def environments(self) -> list[str]:
        answer = await self._call("GET", "/environments")
        return sorted({item.get("environment") for item in answer.get("environments", []) if item.get("environment")})

    async def services(self) -> list[str]:
        answer = await self._call("GET", "/services")
        return sorted({item.get("service") for item in answer.get("services", []) if item.get("service")})


def _segment(alert_id: str) -> str:
    """An ID as a path segment. `..` and the like are no ID, and would address another route."""
    if not _ALERT_ID.fullmatch(alert_id):
        raise not_found("There is no such alert.")
    return quote(alert_id, safe="")


def _refusal(response: httpx.Response) -> Refused:
    status = response.status_code
    if status == PAGE_OUT_OF_RANGE:
        return Refused("invalid", "There is no such page.", status=PAGE_OUT_OF_RANGE)
    try:
        reason = response.json().get("message")
    except (ValueError, AttributeError):
        reason = None
    reason = reason if isinstance(reason, str) and reason else f"{SERVICE} answered HTTP {status}."
    if status == 404:
        return not_found("There is no such alert.")
    if status == 409:
        return conflict(reason[:300])
    if status in (400, 422):
        return invalid(reason[:300])
    return bad_gateway(f"{SERVICE} failed (HTTP {status}).")
