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

-- Every run that is not archived, with its steps and state. Written on every
-- step and status change; restored at startup.
CREATE TABLE IF NOT EXISTS runs (
    run_id          TEXT PRIMARY KEY,
    incident_number INT,
    machine_id      TEXT NOT NULL,
    issue           TEXT NOT NULL,
    status          TEXT NOT NULL,      -- running | awaiting_input | awaiting_confirmation | completed | failed | stopped
    data            JSONB NOT NULL DEFAULT '{}',
    steps           JSONB NOT NULL DEFAULT '[]',
    round           INT NOT NULL DEFAULT 1,
    clarifications  JSONB NOT NULL DEFAULT '[]',
    rejected        JSONB NOT NULL DEFAULT '[]',
    started_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);
