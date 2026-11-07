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
"""Allowed values and ranges for editing in the Data Explorer. They only help, so this always answers."""

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/shacl", tags=["explorer"])


@router.get("/hints")
async def hints(request: Request, entity_type: str, attribute: str) -> dict:
    return await request.app.state.ontology.hints(entity_type, attribute)
