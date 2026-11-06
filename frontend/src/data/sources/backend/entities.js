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
 * The entities area served by the backend (`/api/ngsi`). Attribute names are data, so answers
 * that hold them skip the key mapping. Value hints come in a later change.
 */
import { DataError } from '../../errors'
import { request, seg } from './http'
import { socketUrl } from './runs'

const AREA = 'entities'
const raw = { raw: true }

/** The stream of changes: it ends with one `error` event, and the screen resubscribes when health says `ok`. */
function subscribeEntities({ type, ids } = {}, onEvent) {
  const params = new URLSearchParams()
  if (ids?.length) params.set('ids', ids.join(','))
  else if (type) params.set('type', type)
  const query = params.toString()
  const socket = new WebSocket(socketUrl(`/api/ngsi/ws${query ? `?${query}` : ''}`))
  let ended = false
  const end = (message) => {
    if (ended) return
    ended = true
    onEvent({ type: 'error', error: new DataError(AREA, 'unavailable', message) })
  }
  socket.onmessage = (event) => {
    if (ended) return
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    if (message.type === 'update') onEvent({ type: 'update', entityId: message.entity_id, attributes: message.attributes })
  }
  socket.onerror = () => end('Live updates cannot be reached.')
  socket.onclose = () => end('The live updates connection was lost.')
  return () => {
    ended = true
    socket.close()
  }
}

const queryParams = ({ type, id, idPattern, q, limit } = {}) => ({ type, id, id_pattern: idPattern, q, limit })

export const entities = {
  getStats: () => request(AREA, 'GET', '/api/ngsi/stats'),
  listTypes: () => request(AREA, 'GET', '/api/ngsi/types', raw),
  listAttributes: () => request(AREA, 'GET', '/api/ngsi/attributes', raw),
  queryEntities: (query) => request(AREA, 'GET', '/api/ngsi/entities', { ...raw, params: queryParams(query) }),
  getEntity: (id) => request(AREA, 'GET', `/api/ngsi/entities/${seg(id)}`, raw),
  updateAttributes: (id, attrs) => request(AREA, 'PATCH', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs }),
  appendAttributes: (id, attrs) => request(AREA, 'POST', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs }),
  deleteAttribute: (id, name, { subAttribute } = {}) =>
    request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}/attrs`, { params: { name, sub_attribute: subAttribute } }),
  deleteEntity: (id) => request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}`),
  importEntities: (list) => request(AREA, 'POST', '/api/ngsi/import', { ...raw, body: list }),
  fetchImportDocument: (url) => request(AREA, 'POST', '/api/ngsi/import/fetch', { ...raw, body: { url } }),
  deleteByTypes: (types) => request(AREA, 'POST', '/api/ngsi/delete-by-types', { ...raw, body: { types: [].concat(types) } }),
  getAttributeHistory: (id, name, { from, to } = {}) =>
    request(AREA, 'GET', '/api/ngsi/history', { ...raw, params: { entity_id: id, attribute: name, from, to } }),
  getAttributeStatus: (id) => request(AREA, 'GET', '/api/ngsi/attr-status', { ...raw, params: { entity_id: id } }),
  listTypesAt: (at) => request(AREA, 'GET', '/api/ngsi/timeshift/types', { ...raw, params: { at } }),
  queryEntitiesAt: (at, query) =>
    request(AREA, 'GET', '/api/ngsi/timeshift/entities', { ...raw, params: { at, ...queryParams(query) } }),
  subscribeEntities,
  getLiveUpdateHealth: () => request(AREA, 'GET', '/api/ngsi/subscription-health'),
}
