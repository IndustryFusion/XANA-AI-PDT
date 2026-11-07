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

// Records the dataspace's answers for the shape tests of the backend source
// (tests/data/backend-fixtures/). It needs a backend with GATEWAY_URL on a real dataspace, and
// a capability request pending from a peer, which this decides:
//
//   BACKEND_URL=http://localhost:8000 RECORD_DATASPACE_SECRET=... node scripts/record-dataspace-fixtures.mjs
import { writeFileSync } from 'node:fs'

const BACKEND = (process.env.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '')
const OUT = new URL('../tests/data/backend-fixtures/', import.meta.url).pathname

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
  if (answer.status >= 400) throw new Error(`${op}: HTTP ${answer.status} ${JSON.stringify(answer.body)}`)
  writeFileSync(`${OUT}${op}.json`, `${JSON.stringify(answer, null, 2)}\n`)
  console.log(`${op}: HTTP ${answer.status}`)
  return answer.body
}

const secret = process.env.RECORD_DATASPACE_SECRET
if (!secret) throw new Error('Set RECORD_DATASPACE_SECRET.')
const gateway = '/api/gateway'
const connected = await call('POST', `${gateway}/connect`, { secret })
record('dataspace.connect', connected)
record('dataspace.getConnection', await call('GET', `${gateway}/status`))
const peers = record('dataspace.listPeers', await call('GET', `${gateway}/peers`))
record('dataspace.getPeerCapabilities', await call('GET', `${gateway}/peers/${encodeURIComponent(peers[0].id)}/capabilities`))
const requests = record('dataspace.listCapabilityRequests', await call('GET', `${gateway}/capabilities/requests`))
const pending = requests.find((r) => r.status === 'pending')
record('dataspace.decideCapabilityRequest', await call('PATCH', `${gateway}/capabilities/requests/${encodeURIComponent(pending.id)}`, { action: 'approve', note: 'Recorded' }))
record('dataspace.setCapabilityPolicy', await call('POST', `${gateway}/capabilities/policy`, { consumer_id: peers[0].id, capability: 'twin:history', action: 'reset' }))
// The registry's answers, if the backend has IFRIC_URL with the sample companies of RECORD_MACHINE.
if (process.env.RECORD_MACHINE) {
  record('session.getFactory', await call('GET', '/api/ifric/factory'))
  record('dataspace.resolveNames', await call('POST', '/api/ifric/resolve', { ids: [peers[0].id] }))
  record('dataspace.resolveBuilders', await call('POST', '/api/ifric/resolve-builders', { machine_ids: [process.env.RECORD_MACHINE] }))
}
record('dataspace.disconnect', await call('POST', `${gateway}/disconnect`))
