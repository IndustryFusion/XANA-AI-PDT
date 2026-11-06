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

-- Attribute history and entity lifecycle in the layout the IFF Digital Twin
-- platform writes: one row per observed attribute value, and one per entity
-- change. `deleted` may be null there. Created only for the local environment;
-- a factory installation already has these tables.
CREATE TABLE IF NOT EXISTS {table} (
    "id"             TEXT NOT NULL,
    "parentId"       TEXT,
    "observedAt"     TIMESTAMPTZ NOT NULL,
    "modifiedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "entityId"       TEXT NOT NULL,
    "attributeId"    TEXT NOT NULL,
    "attributeType"  TEXT NOT NULL DEFAULT 'https://uri.etsi.org/ngsi-ld/Property',
    "datasetId"      TEXT NOT NULL DEFAULT '@none',
    "nodeType"       TEXT NOT NULL DEFAULT '@value',
    "value"          TEXT,
    "valueType"      TEXT,
    "unitCode"       TEXT,
    "lang"           TEXT,
    "deleted"        BOOLEAN
);

-- A database from before these columns existed.
ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "modifiedAt" TIMESTAMPTZ DEFAULT now();
ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "unitCode" TEXT;
ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "lang" TEXT;
ALTER TABLE {table} ALTER COLUMN "deleted" DROP NOT NULL;
ALTER TABLE {table} ALTER COLUMN "deleted" DROP DEFAULT;
UPDATE {table} SET "datasetId" = '@none' WHERE "datasetId" IS NULL;
UPDATE {table} SET "id" = "entityId" || '\' || "attributeId" || '\' || "datasetId" WHERE "id" IS NULL;

CREATE INDEX IF NOT EXISTS {index} ON {table} ("entityId", "observedAt" DESC);
CREATE INDEX IF NOT EXISTS {id_index} ON {table} ("entityId", "id", "observedAt" DESC);

CREATE TABLE IF NOT EXISTS {entity_table} (
    "id"          TEXT NOT NULL,
    "observedAt"  TIMESTAMPTZ NOT NULL,
    "modifiedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "type"        TEXT NOT NULL,
    "deleted"     BOOLEAN,
    PRIMARY KEY ("id", "observedAt")
);

CREATE TABLE IF NOT EXISTS xana_sample_data (
    name       TEXT PRIMARY KEY,
    loaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read-only role PostgREST switches to, named as on the platform.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dbreader') THEN
        CREATE ROLE dbreader NOLOGIN;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO dbreader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbreader;
