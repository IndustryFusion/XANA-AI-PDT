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

-- Attribute history in the layout the IFF Digital Twin platform writes:
-- one row per observed attribute value. Created only for the local
-- environment; a factory installation already has this table.
CREATE TABLE IF NOT EXISTS {table} (
    "observedAt"     TIMESTAMPTZ NOT NULL,
    "entityId"       TEXT NOT NULL,
    "attributeId"    TEXT NOT NULL,
    "attributeType"  TEXT NOT NULL DEFAULT 'https://uri.etsi.org/ngsi-ld/Property',
    "nodeType"       TEXT NOT NULL DEFAULT '@value',
    "value"          TEXT,
    "valueType"      TEXT,
    "datasetId"      TEXT,
    "deleted"        BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS {index} ON {table} ("entityId", "observedAt" DESC);

CREATE TABLE IF NOT EXISTS xana_sample_data (
    name       TEXT PRIMARY KEY,
    loaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
