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

-- Inbox messages already stored, so that none is handled twice, whenever it was acknowledged.
CREATE TABLE IF NOT EXISTS processed_inbox (
    message_id   TEXT PRIMARY KEY,
    run_id       TEXT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Files received from the machine builder, as the bundle the dataspace delivered.
CREATE TABLE IF NOT EXISTS conversation_files (
    message_id TEXT PRIMARY KEY,
    run_id     TEXT NOT NULL,
    content    BYTEA NOT NULL
);

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS conversation_state TEXT;
