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
"""Refused requests as `{"error": {"kind", "message"}}` with a matching HTTP status."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.errors import Refused, invalid


def refused_response(refused: Refused) -> JSONResponse:
    return JSONResponse({"error": refused.as_dict()}, status_code=refused.http_status)


async def _refused(request: Request, exc: Refused) -> JSONResponse:
    return refused_response(exc)


async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
    problems = []
    for error in exc.errors():
        where = ".".join(str(part) for part in error["loc"] if part != "body")
        problems.append(f"{where}: {error['msg']}" if where else error["msg"])
    return refused_response(invalid("; ".join(problems) or "The request is not valid."))


def install(app: FastAPI) -> None:
    app.add_exception_handler(Refused, _refused)
    app.add_exception_handler(RequestValidationError, _validation)
