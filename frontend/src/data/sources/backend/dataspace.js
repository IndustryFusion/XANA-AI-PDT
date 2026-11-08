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
 * The dataspace area served by the backend (`/api/gateway`): connection, peers, capabilities,
 * capability requests and policies, with names from the IFRIC registry (`/api/ifric`). Answers keyed
 * by identifier aren't key-mapped: an identifier stays as it is.
 */
import { DataError } from '../../errors'
import { request, seg } from './http'

const AREA = 'dataspace'
const POLICY_ACTION = { grant: 'approve', deny: 'deny', reset: 'reset' }

export const dataspace = {
  getConnection: () => request(AREA, 'GET', '/api/gateway/status'),
  getConnectionConfig: () => request(AREA, 'GET', '/api/gateway/config'),
  getAccessLevels: () => request(AREA, 'GET', '/api/gateway/access-levels'),
  connect: ({ secret } = {}) => request(AREA, 'POST', '/api/gateway/connect', { body: { secret: secret ?? null } }),
  disconnect: async () => {
    await request(AREA, 'POST', '/api/gateway/disconnect')
  },
  listPeers: () => request(AREA, 'GET', '/api/gateway/peers'),
  getPeerCapabilities: (peerId) => request(AREA, 'GET', `/api/gateway/peers/${seg(peerId)}/capabilities`),
  listCapabilityRequests: () => request(AREA, 'GET', '/api/gateway/capabilities/requests'),
  decideCapabilityRequest: (id, { approved, note } = {}) =>
    request(AREA, 'PATCH', `/api/gateway/capabilities/requests/${seg(id)}`, {
      body: { action: approved ? 'approve' : 'deny', note: note ?? null },
    }),
  setCapabilityPolicy: async ({ peerId, capability, action } = {}) => {
    if (!POLICY_ACTION[action]) throw new DataError(AREA, 'invalid', `Unknown policy action ${action}; use grant, deny or reset.`)
    await request(AREA, 'POST', '/api/gateway/capabilities/policy', {
      body: { consumer_id: peerId, capability, action: POLICY_ACTION[action] },
    })
  },
  resolveNames: (ids = []) => request(AREA, 'POST', '/api/ifric/resolve', { raw: true, body: { ids } }),
  resolveBuilders: (machineIds = []) =>
    request(AREA, 'POST', '/api/ifric/resolve-builders', { raw: true, body: { machine_ids: machineIds } }),
  resolveMachines: (machineIds = []) =>
    request(AREA, 'POST', '/api/ifric/resolve-machines', { raw: true, body: { machine_ids: machineIds } }),
}
