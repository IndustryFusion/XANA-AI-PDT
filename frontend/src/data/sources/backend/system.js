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

/** System health (`/api/diagnostics`) and service settings (`/api/config`), which are read-only here. */
import { DataError } from '../../errors'
import { request } from './http'

export const system = {
  getHealth: ({ fresh = false } = {}) =>
    request('system', 'GET', '/api/diagnostics', { params: fresh ? { fresh: 'true' } : {} }),
  getServiceSettings: () => request('system', 'GET', '/api/config'),
  saveServiceSettings: async () => {
    throw new DataError('system', 'conflict', 'Service addresses are set at deployment, and can\'t be changed here.')
  },
}
