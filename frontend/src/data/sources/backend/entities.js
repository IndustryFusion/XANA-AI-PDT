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
 * that hold them skip the key mapping.
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

/** `name` and `path` for an edit at a path of sub-attributes; none without one. */
const pathParams = (attrs, path) => (path?.length ? { name: Object.keys(attrs)[0], path } : undefined)

const queryParams = ({ type, id, idPattern, q, limit } = {}) => ({ type, id, id_pattern: idPattern, q, limit })
const pagedParams = ({ offset, attrs, hasAttr, ...query } = {}) => ({ ...queryParams(query), offset, attrs, has_attr: hasAttr })

export const entities = {
  getStats: () => request(AREA, 'GET', '/api/ngsi/stats'),
  listTypes: () => request(AREA, 'GET', '/api/ngsi/types', raw),
  listAttributes: () => request(AREA, 'GET', '/api/ngsi/attributes', raw),
  queryEntities: (query) => request(AREA, 'GET', '/api/ngsi/entities', { ...raw, params: pagedParams(query) }),
  getEntity: (id) => request(AREA, 'GET', `/api/ngsi/entities/${seg(id)}`, raw),
  // With `path`, `attrs` holds one attribute whose fragment applies at that path of sub-attributes below it.
  updateAttributes: (id, attrs, { path } = {}) =>
    request(AREA, 'PATCH', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs, params: pathParams(attrs, path) }),
  appendAttributes: (id, attrs, { path } = {}) =>
    request(AREA, 'POST', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs, params: pathParams(attrs, path) }),
  deleteAttribute: (id, name, { subAttribute, path } = {}) =>
    request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}/attrs`, { params: { name, ...(path?.length ? { path } : { sub_attribute: subAttribute }) } }),
  deleteEntity: (id) => request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}`),
  importEntities: (list) => request(AREA, 'POST', '/api/ngsi/import', { ...raw, body: list }),
  fetchImportDocument: (url) => request(AREA, 'POST', '/api/ngsi/import/fetch', { ...raw, body: { url } }),
  deleteByTypes: (types) => request(AREA, 'POST', '/api/ngsi/delete-by-types', { ...raw, body: { types: [].concat(types) } }),
  getAttributeHistory: (id, name, { from, to, path } = {}) =>
    request(AREA, 'GET', '/api/ngsi/history', { ...raw, params: { entity_id: id, attribute: name, from, to, path } }),
  getAttributeStatus: (id) => request(AREA, 'GET', '/api/ngsi/attr-status', { ...raw, params: { entity_id: id } }),
  listTypesAt: (at) => request(AREA, 'GET', '/api/ngsi/timeshift/types', { ...raw, params: { at } }),
  queryEntitiesAt: (at, query) =>
    request(AREA, 'GET', '/api/ngsi/timeshift/entities', { ...raw, params: { at, ...queryParams(query) } }),
  subscribeEntities,
  getLiveUpdateHealth: () => request(AREA, 'GET', '/api/ngsi/subscription-health'),
  getPrefixes: () => request(AREA, 'GET', '/api/ngsi/prefixes', raw),
  getValueHints: ({ entityType, attribute } = {}) =>
    request(AREA, 'GET', '/api/shacl/hints', { params: { entity_type: entityType, attribute } }),
}
