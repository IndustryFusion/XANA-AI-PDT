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
import logging

from app.redact import RedactingFilter, Redactor, mask_url, url_password


def test_mask_url():
    assert mask_url("postgresql://xana:pw123@db:5432/memory") == "postgresql://xana:***@db:5432/memory"
    assert mask_url("postgresql://xana@db/memory") == "postgresql://xana@db/memory"
    assert mask_url("http://host:9090") == "http://host:9090"


def test_url_password_decoded():
    assert url_password("postgresql://u:p%40ss@h/db") == "p@ss"
    assert url_password("postgresql://u@h/db") is None


def test_redactor_replaces_secrets():
    redact = Redactor(["topsecret", None, "abc"])
    assert redact("key topsecret and abc") == "key *** and abc"


def test_filter_redacts_message_args_and_exceptions():
    record_holder = []

    class Capture(logging.Handler):
        def emit(self, record):
            record_holder.append(self.format(record))

    logger = logging.getLogger("redact-test")
    handler = Capture()
    handler.addFilter(RedactingFilter(Redactor(["topsecret"])))
    logger.addHandler(handler)
    try:
        logger.warning("connect %s failed", "postgresql://u:topsecret@h/db")
        try:
            raise RuntimeError("bad topsecret")
        except RuntimeError:
            logger.exception("boom")
    finally:
        logger.removeHandler(handler)
    assert all("topsecret" not in line for line in record_holder)
    assert "***" in record_holder[0]
