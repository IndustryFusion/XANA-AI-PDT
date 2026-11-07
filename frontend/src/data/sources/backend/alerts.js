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

/** The alerts area served by the backend (`/api/alerta`). An alert's `attributes` are data, so keys aren't mapped. */
import { request, seg } from './http'

const AREA = 'alerts'
const raw = { raw: true }
const statuses = (status) => (Array.isArray(status) ? status.join(',') : status)

export const alerts = {
  listAlerts: ({ status, severity, environment, service, text, sort, page, pageSize } = {}) =>
    request(AREA, 'GET', '/api/alerta/alerts', {
      ...raw,
      params: { status: statuses(status), severity, environment, service, text, sort, page, page_size: pageSize },
    }),
  countAlerts: ({ status } = {}) => request(AREA, 'GET', '/api/alerta/alerts/count', { ...raw, params: { status: statuses(status) } }),
  getAlert: (id) => request(AREA, 'GET', `/api/alerta/alert/${seg(id)}`, raw),
  applyAlertAction: (id, { action, text } = {}) =>
    request(AREA, 'PUT', `/api/alerta/alert/${seg(id)}/action`, { ...raw, body: { action, text } }),
  listEnvironments: () => request(AREA, 'GET', '/api/alerta/environments', raw),
  listServices: () => request(AREA, 'GET', '/api/alerta/services', raw),
  getAlertSettings: () => request(AREA, 'GET', '/api/alerta/config'),
}
