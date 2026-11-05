//
// Copyright (c) 2026 IndustryFusion Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * Sample machine data for the backend's local environment, taken from the
 * mock's deterministic seed so that machine identifiers chosen in the UI
 * exist in the backend too.
 *
 * Written to backend/sample_data/sample-data.json by export-sample-data.mjs;
 * tests/data/sampleData.test.js fails when the file and the seed disagree.
 */
import { buildSeed } from '../src/data/sources/mock/seed'
import { HISTORY_STEP_MS, STATUS_STEP_MS, machineStatusAt, sensorValueAt } from '../src/data/sources/mock/history'

/** Fixed reference time, so the export does not change from run to run. */
export const REFERENCE_TIME = Date.UTC(2026, 10, 2, 12, 0, 0)
const HISTORY_MS = 24 * 60 * 60_000

function series(entityId, attribute, stepMs, valueAt) {
  const values = []
  for (let t = REFERENCE_TIME - HISTORY_MS + stepMs; t <= REFERENCE_TIME; t += stepMs) values.push(valueAt(t))
  return { entityId, attribute, stepSeconds: stepMs / 1000, values }
}

/**
 * `entities`: NGSI-LD entities (normalized form). `history`: per attribute,
 * values at a fixed step; the last value is "now" when the backend loads it.
 */
export function sampleData() {
  const { entities } = buildSeed({ now: REFERENCE_TIME })
  const history = []
  for (const entity of entities) {
    if (entity.type === 'Sensor') history.push(series(entity.id, 'value', HISTORY_STEP_MS, (t) => sensorValueAt(entity.id, t)))
    if (entity.type === 'Machine') history.push(series(entity.id, 'status', STATUS_STEP_MS, (t) => machineStatusAt(entity.id, t)))
  }
  return { generatedFrom: 'frontend/src/data/sources/mock/seed.js', entities, history }
}

/** Path of the exported file, relative to the frontend folder (commands run from there). */
export const SAMPLE_DATA_PATH = '../backend/sample_data/sample-data.json'

export const serialize = (data) => `${JSON.stringify(data, null, 1)}\n`
