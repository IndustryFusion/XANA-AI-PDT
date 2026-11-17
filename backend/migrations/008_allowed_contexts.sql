--
-- Copyright (c) 2026 IndustryFusion Foundation
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--   http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.
--

-- JSON-LD contexts an operator allowed for import, beside the built-in and deployment ones. The broker
-- fetches a context from inside the platform, so only allowed ones are let through.
CREATE TABLE IF NOT EXISTS allowed_contexts (
    url        TEXT PRIMARY KEY,
    added_by   TEXT,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
