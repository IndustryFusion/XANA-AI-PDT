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

-- Databases of the local environment, created on the server's first start.
-- memory: incident memory (the backend applies its migrations itself)
-- tsdb:   attribute history (time-series store)
-- ngb:    the context broker's own storage
CREATE DATABASE tsdb;
CREATE DATABASE ngb;
\connect tsdb
CREATE EXTENSION IF NOT EXISTS timescaledb;
