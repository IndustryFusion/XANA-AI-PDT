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
"""Files attached to clarifications and rejections.

Phase 1 checks each file and keeps only its name, type and size; the content is dropped.
"""

from __future__ import annotations

import base64
import binascii
import re
from urllib.parse import unquote_to_bytes

from pydantic import BaseModel

from app.errors import invalid

MAX_FILES = 5
MAX_BYTES = 10 * 1024 * 1024
TEXT_TYPES = ("application/pdf", "text/plain")

_DATA_URL = re.compile(r"data:(?P<type>[^;,]*)(?P<params>(;[^;,]*)*),(?P<data>.*)", re.DOTALL)


class Attachment(BaseModel):
    name: str
    type: str
    size: int
    data_url: str


def check_files(files: list[Attachment]) -> list[dict[str, object]]:
    """The name, type and size of each file; refuses the whole list as `invalid` if one file is not allowed."""
    if len(files) > MAX_FILES:
        raise invalid(f"At most {MAX_FILES} files can be attached.")
    kept = []
    for file in files:
        name = file.name.strip() or "A file"
        match = _DATA_URL.fullmatch(file.data_url)
        if not match:
            raise invalid(f"{name} could not be read.")
        media = (match["type"] or "text/plain").lower()
        if media != file.type.lower():
            raise invalid(f"{name} is not of the type it claims ({file.type}).")
        if not (media.startswith("image/") or media in TEXT_TYPES):
            raise invalid(f"{name}: only images, PDF and plain text can be attached.")
        if file.size > MAX_BYTES:
            raise invalid(f"{name} is larger than 10 MB.")
        try:
            if ";base64" in match["params"].lower():
                content = base64.b64decode(match["data"], validate=True)
            else:
                content = unquote_to_bytes(match["data"])
        except (binascii.Error, ValueError):
            raise invalid(f"{name} could not be read.") from None
        if len(content) > MAX_BYTES:
            raise invalid(f"{name} is larger than 10 MB.")
        kept.append({"name": name, "type": media, "size": len(content)})
    return kept
