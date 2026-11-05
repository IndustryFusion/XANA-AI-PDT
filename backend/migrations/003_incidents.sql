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

-- Incident numbers, given when a run first leaves `running`.
CREATE SEQUENCE IF NOT EXISTS incident_number;

-- One row per run that was confirmed or archived. Confirmed rows are the
-- workflow's memory of past diagnoses; archived rows are the history.
CREATE TABLE IF NOT EXISTS incidents (
    id                  SERIAL PRIMARY KEY,
    number              INT UNIQUE,
    run_id              TEXT NOT NULL UNIQUE,
    machine_id          TEXT NOT NULL,
    machine_type        TEXT,
    issue               TEXT NOT NULL,
    outcome             TEXT,           -- completed | failed | stopped; set when archived
    root_cause          TEXT,
    recommended_action  TEXT,
    decision            JSONB,
    resolution          TEXT,
    confirmed           BOOLEAN NOT NULL DEFAULT false,
    confirmed_at        TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL,
    closed_at           TIMESTAMPTZ,
    archived_at         TIMESTAMPTZ,
    reopened_run_id     TEXT
);

CREATE INDEX IF NOT EXISTS incidents_confirmed_machine ON incidents (machine_id, confirmed_at DESC) WHERE confirmed;
CREATE INDEX IF NOT EXISTS incidents_closed ON incidents (closed_at DESC) WHERE archived_at IS NOT NULL;

-- The steps of an incident's run, in order.
CREATE TABLE IF NOT EXISTS agent_traces (
    id          SERIAL PRIMARY KEY,
    incident_id INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    step        INT NOT NULL,
    round       INT NOT NULL,
    action      TEXT NOT NULL,          -- observe | hypothesize | validate | decide | act | clarification | resolution
    input       JSONB,
    output      JSONB,
    timestamp   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_traces_incident ON agent_traces (incident_id, step);
