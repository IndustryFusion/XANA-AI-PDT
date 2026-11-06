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

// Records backend answers for the data-interface shape tests of the backend
// source (tests/data/backend-fixtures/). Run it against a backend with the
// scripted language model and the sample data, for example the local environment:
//
//   LLM_PROVIDER=scripted KEYCLOAK_URL=http://keycloak:8080 docker compose -f backend/compose.yaml --profile auth up --build
//   node scripts/record-backend-fixtures.mjs            # BACKEND_URL, default http://localhost:8000
//
// It starts runs on the sample machine laser-cutter-01 and archives them, so
// they appear in that backend's incident history.
import { mkdirSync, writeFileSync } from 'node:fs'

const BACKEND = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '')
const OUT = new URL('../tests/data/backend-fixtures/', import.meta.url).pathname
const MACHINE = 'laser-cutter-01'

async function call(method, path, body) {
  const response = await fetch(`${BACKEND}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { method, path, status: response.status, body: text ? JSON.parse(text) : null }
}

function record(op, answer) {
  if (answer.status >= 400 && !op.endsWith('.refused')) throw new Error(`${op}: HTTP ${answer.status} ${JSON.stringify(answer.body)}`)
  writeFileSync(`${OUT}${op}.json`, `${JSON.stringify(answer, null, 2)}\n`)
  console.log(`${op}: HTTP ${answer.status}`)
  return answer.body
}

async function until(runId, status) {
  for (let i = 0; i < 600; i++) {
    const run = await call('GET', `/api/agent/status/${runId}`)
    if (run.body.status === status) return run
    if (run.body.status !== 'running') throw new Error(`run ${runId} is ${run.body.status}, expected ${status}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`run ${runId} did not reach ${status}`)
}

mkdirSync(OUT, { recursive: true })
record('system.getHealth', await call('GET', '/api/diagnostics?fresh=true'))

const { run_id: runId } = record('runs.startRun', await call('POST', '/api/agent/run', { machine_id: MACHINE, issue: 'Cut edges show burrs since this morning' }))
record('runs.getRun', await until(runId, 'awaiting_input'))
record('runs.listActiveRuns', await call('GET', '/api/agent/runs'))
record('runs.escalationPreflight', await call('GET', `/api/agent/escalate-preflight/${runId}`))
const note = { name: 'nozzle.txt', type: 'text/plain', size: 22, data_url: 'data:text/plain,Nozzle%20changed%20at%208' }
record('runs.clarify', await call('POST', `/api/agent/clarify/${runId}`, { text: 'The nozzle was changed at 8:00.', files: [note] }))
await until(runId, 'awaiting_confirmation')
await call('POST', `/api/agent/confirm-resolution/${runId}`, { confirmed: false, text: 'The lens was cleaned yesterday.', files: [] })
await until(runId, 'awaiting_confirmation')
record('runs.confirmResolution', await call('POST', `/api/agent/confirm-resolution/${runId}`, { confirmed: true, text: '', files: [] }))
await until(runId, 'completed')
record('runs.reopenRun.refused', await call('POST', `/api/agent/reopen/${runId}`))
record('runs.archiveRun', await call('POST', `/api/agent/archive/${runId}`))

const { run_id: stopped } = (await call('POST', '/api/agent/run', { machine_id: MACHINE, issue: 'Gas pressure warning' })).body
await until(stopped, 'awaiting_input')
record('runs.stopRun', await call('POST', `/api/agent/stop/${stopped}`, { reason: 'Recorded for the fixtures.' }))
await call('POST', `/api/agent/archive/${stopped}`)

const history = record('incidents.listIncidents', await call('GET', '/api/incidents'))
const completed = history.find((i) => i.outcome === 'completed')
record('incidents.getIncident', await call('GET', `/api/incidents/${completed.id}`))
const { run_id: reopened } = record('incidents.reopenIncident', await call('POST', `/api/incidents/${completed.id}/reopen`))
await until(reopened, 'awaiting_input')
await call('POST', `/api/agent/stop/${reopened}`, { reason: 'Recorded for the fixtures.' })
await call('POST', `/api/agent/archive/${reopened}`)
// The session, against the local environment's test user.
const USER = { username: process.env.RECORD_USERNAME || 'operator', password: process.env.RECORD_PASSWORD || 'operator' }
record('session.getAuthConfig', await call('GET', '/api/auth/config'))
record('session.signIn', await call('POST', '/api/auth/connect', USER))
record('session.getSession', await call('GET', '/api/auth/status'))
record('session.signOut', await call('POST', '/api/auth/logout'))
// The explorer. History and time-shift need the local environment's `history` profile, and a
// public document for the import from a URL: set RECORD_IMPORT_URL, or that one is skipped.
const SENSOR = 'urn:ngsi-ld:Sensor:laser-cutter-01-temperature'
const entity = (id) => `/api/ngsi/entities/${encodeURIComponent(id)}`
const tag = Date.now().toString(36)
const RECORDED = `urn:ngsi-ld:Recording:${tag}`
record('entities.getStats', await call('GET', '/api/ngsi/stats'))
record('entities.listTypes', await call('GET', '/api/ngsi/types'))
record('entities.listAttributes', await call('GET', '/api/ngsi/attributes'))
record('entities.queryEntities', await call('GET', '/api/ngsi/entities?type=Machine&limit=5'))
record('entities.getEntity', await call('GET', entity(`urn:ngsi-ld:Machine:${MACHINE}`)))
record('entities.importEntities', await call('POST', '/api/ngsi/import', [{ id: RECORDED, type: 'Recording', a: { type: 'Property', value: 1 } }]))
record('entities.updateAttributes', await call('PATCH', `${entity(RECORDED)}/attrs`, { a: { value: 2 } }))
record('entities.appendAttributes', await call('POST', `${entity(RECORDED)}/attrs`, { b: { type: 'Property', value: 1 } }))
record('entities.deleteAttribute', await call('DELETE', `${entity(RECORDED)}/attrs?name=b`))
record('entities.deleteEntity', await call('DELETE', entity(RECORDED)))
await call('POST', '/api/ngsi/import', [{ id: RECORDED, type: `Recording${tag}` }])
record('entities.deleteByTypes', await call('POST', '/api/ngsi/delete-by-types', { types: [`Recording${tag}`] }))
const at = new Date(Date.now() - 3600_000).toISOString()
record('entities.getAttributeHistory', await call('GET', `/api/ngsi/history?entity_id=${encodeURIComponent(SENSOR)}&attribute=value&from=${encodeURIComponent(at)}`))
record('entities.getAttributeStatus', await call('GET', `/api/ngsi/attr-status?entity_id=${encodeURIComponent(SENSOR)}`))
record('entities.listTypesAt', await call('GET', `/api/ngsi/timeshift/types?at=${encodeURIComponent(at)}`))
record('entities.queryEntitiesAt', await call('GET', `/api/ngsi/timeshift/entities?type=Machine&limit=2&at=${encodeURIComponent(at)}`))
if (process.env.RECORD_IMPORT_URL) record('entities.fetchImportDocument', await call('POST', '/api/ngsi/import/fetch', { url: process.env.RECORD_IMPORT_URL }))
console.log(`Fixtures written to ${OUT}`)
