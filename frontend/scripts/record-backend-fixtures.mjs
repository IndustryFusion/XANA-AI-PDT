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
//   LLM_PROVIDER=scripted docker compose -f backend/compose.yaml up --build
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
console.log(`Fixtures written to ${OUT}`)
