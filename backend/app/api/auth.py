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
"""Sign-in through the identity provider. Responses never hold a token."""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str
    password: str


@router.get("/config")
async def config(request: Request) -> dict:
    return request.app.state.session.config()


@router.get("/status")
async def status(request: Request) -> dict:
    return request.app.state.session.status()


@router.post("/connect")
async def connect(body: Credentials, request: Request) -> dict:
    return await request.app.state.session.connect(body.username, body.password)


@router.post("/logout", status_code=204)
async def logout(request: Request) -> Response:
    await request.app.state.session.logout()
    return Response(status_code=204)
