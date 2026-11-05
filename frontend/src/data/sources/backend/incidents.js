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

/** Incident history served by the backend (`/api/incidents`). */
import { request, seg } from './http'

const AREA = 'incidents'

export const incidents = {
  listIncidents: ({ machineId, status, from, to } = {}) =>
    request(AREA, 'GET', '/api/incidents', {
      params: { machine_id: machineId, status: Array.isArray(status) ? status.join(',') : status, from, to },
    }),
  getIncident: (id) => request(AREA, 'GET', `/api/incidents/${seg(id)}`),
  reopenIncident: (id) => request(AREA, 'POST', `/api/incidents/${seg(id)}/reopen`),
}
