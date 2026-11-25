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

/** IDs per request when many entities are read at once: few enough that one request stays short. */
export const MAX_IDS = 100
/** IDs per request for many entities' latest states: each is read from the time series, so fewer. */
export const MAX_STATUS_IDS = 20
/** Searching every entity for references is slower than other reads. */
export const REFERRERS_TIMEOUT_MS = 60_000
/** Such searches at once, as many as the backend runs: the others wait here, where their timeout doesn't run yet. */
export const REFERRER_SEARCHES = 2
/**
 * Reads again on their own at once: below what a browser sends at once to one host, so that none of them, and no
 * other request of the page, waits in its queue long enough to time out.
 */
export const SINGLE_READS = 4
/**
 * Refusals that hold for every ID of a request alike: reading each again on its own would only repeat them. Not
 * `invalid`: the backend refuses a whole request also for a single malformed ID in it.
 */
const WHOLE_REQUEST = new Set(['unauthorized'])

// The reads again on their own, of every reader and every task: SINGLE_READS at once, the rest waiting here
// rather than in the browser, where their timeout would already run.
function poolOf(size) {
  const pool = { running: 0, queue: [] }
  function drain() {
    while (pool.running < size && pool.queue.length) {
      const { task, done } = pool.queue.shift()
      pool.running += 1
      task().finally(() => {
        pool.running -= 1
        done()
        drain()
      })
    }
  }
  return (task) => new Promise((done) => {
    pool.queue.push({ task, done })
    drain()
  })
}
const pooled = poolOf(SINGLE_READS)
const searches = poolOf(REFERRER_SEARCHES)

/**
 * Reads asked for in the same task go out together: one ID by its own request, as always; several in one
 * request to the backend's `…-by-id` endpoint, `size` IDs at a time, each caller getting its own answer. A tree
 * of entities expanding at once thus reads a level in one request instead of one per entity. A batch never fails
 * more callers than single reads would: an ID its answer leaves out (not found, or refused by the broker), and
 * every ID of a request that fails, does not answer in time or answers no object, is read again on its own,
 * SINGLE_READS at once, so each caller gets the answer or the error of its single read. A refusal that holds for
 * the whole request (not signed in) reaches every caller as it is, and once one of these single reads gets no
 * answer, the ones still waiting fail with it.
 */
function batched(readOne, readMany, size) {
  let pending = null
  async function flush() {
    const waiting = pending
    pending = null
    const ids = [...waiting.keys()]
    const settle = (id, ok, value) => waiting.get(id).forEach((caller) => (ok ? caller.resolve(value) : caller.reject(value)))
    const read = async (id) => {
      try {
        settle(id, true, await readOne(id))
      } catch (error) {
        settle(id, false, error)
      }
    }
    if (ids.length === 1) {
      await read(ids[0])
      return
    }
    // Once a read again on its own gets no answer, the backend isn't answering in time: the ones of this task
    // still waiting fail with it instead of each waiting out its own timeout.
    let unanswered = null
    const single = (id) => pooled(async () => {
      if (unanswered) {
        settle(id, false, unanswered)
        return
      }
      try {
        settle(id, true, await readOne(id))
      } catch (error) {
        // only no answer at all: a failure answered for one entity says nothing about the others
        if (error?.details?.noAnswer) unanswered = error
        settle(id, false, error)
      }
    })
    const chunks = []
    for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size))
    // The chunks go out together, each answering its own callers.
    await Promise.all(chunks.map(async (chunk) => {
      let found
      try {
        found = await readMany(chunk)
      } catch (error) {
        if (WHOLE_REQUEST.has(error?.kind)) chunk.forEach((id) => settle(id, false, error))
        else await Promise.all(chunk.map(single))
        return
      }
      // An answer that is no object of answers by ID is no answer.
      if (found === null || typeof found !== 'object' || Array.isArray(found)) {
        await Promise.all(chunk.map(single))
        return
      }
      await Promise.all(chunk.map((id) => (Object.hasOwn(found, id) ? settle(id, true, found[id]) : single(id))))
    }))
  }
  return (id) => new Promise((resolve, reject) => {
    if (!pending) {
      pending = new Map()
      setTimeout(flush, 0)
    }
    if (!pending.has(id)) pending.set(id, [])
    pending.get(id).push({ resolve, reject })
  })
}

const readEntity = batched(
  (id) => request(AREA, 'GET', `/api/ngsi/entities/${seg(id)}`, raw),
  (ids) => request(AREA, 'POST', '/api/ngsi/entities-by-id', { ...raw, body: { ids } }),
  MAX_IDS,
)
const readStatus = batched(
  (id) => request(AREA, 'GET', '/api/ngsi/attr-status', { ...raw, params: { entity_id: id } }),
  (ids) => request(AREA, 'POST', '/api/ngsi/attr-status-by-id', { ...raw, body: { ids } }),
  MAX_STATUS_IDS,
)

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
/** The attribute, the path below it and the instance's dataset, for an edit at a path; `force` for a value the checks refuse. */
function editParams(attrs, { path, sub = false, datasetId, force, exact } = {}) {
  const params = {
    ...(path?.length || sub ? { name: Object.keys(attrs)[0], path } : {}),
    ...((path?.length || sub) && datasetId ? { dataset_id: datasetId } : {}),
    ...(force ? { force: true } : {}),
    ...(exact ? { exact: true } : {}),
  }
  return Object.keys(params).length ? params : undefined
}

const queryParams = ({ type, id, idPattern, q, limit } = {}) => ({ type, id, id_pattern: idPattern, q, limit })
const pagedParams = ({ offset, attrs, hasAttr, ...query } = {}) => ({ ...queryParams(query), offset, attrs, has_attr: hasAttr })

export const entities = {
  getStats: () => request(AREA, 'GET', '/api/ngsi/stats'),
  listTypes: () => request(AREA, 'GET', '/api/ngsi/types', raw),
  listAttributes: () => request(AREA, 'GET', '/api/ngsi/attributes', raw),
  queryEntities: (query) => request(AREA, 'GET', '/api/ngsi/entities', { ...raw, params: pagedParams(query) }),
  getEntity: (id) => readEntity(id),
  // The backend reads every entity for this, as the broker has no reverse lookup.
  listReferrers: (id) => new Promise((resolve, reject) => {
    searches(() => request(AREA, 'GET', '/api/ngsi/referenced-by', { ...raw, params: { entity_id: id }, timeoutMs: REFERRERS_TIMEOUT_MS })
      .then(resolve, reject))
  }),
  // With `path`, `attrs` holds one attribute whose fragment applies at that path of sub-attributes below it, in the
  // instance of `datasetId`. A fragment without a path names its instance by its own `datasetId`. `force` writes a
  // value the checks refuse, when the operator insists. `exact` writes the value in the form given, as the datatype
  // the operator chose, instead of keeping the stored datatype.
  updateAttributes: (id, attrs, { path, datasetId, force, exact } = {}) =>
    request(AREA, 'PATCH', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs, params: editParams(attrs, { path, datasetId, force, exact }) }),
  // With `sub`, `attrs` holds one attribute and the sub-attributes to add to it (at `path` below it, if given).
  appendAttributes: (id, attrs, { path, sub = false, datasetId } = {}) =>
    request(AREA, 'POST', `/api/ngsi/entities/${seg(id)}/attrs`, { ...raw, body: attrs, params: editParams(attrs, { path, sub, datasetId }) }),
  deleteAttribute: (id, name, { subAttribute, path, datasetId } = {}) =>
    request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}/attrs`, {
      params: { name, ...(path?.length ? { path } : { sub_attribute: subAttribute }), ...(datasetId ? { dataset_id: datasetId } : {}) },
    }),
  deleteEntity: (id) => request(AREA, 'DELETE', `/api/ngsi/entities/${seg(id)}`),
  importEntities: (list) => request(AREA, 'POST', '/api/ngsi/import', { ...raw, body: list }),
  fetchImportDocument: (url) => request(AREA, 'POST', '/api/ngsi/import/fetch', { ...raw, body: { url } }),
  deleteByTypes: (types) => request(AREA, 'POST', '/api/ngsi/delete-by-types', { ...raw, body: { types: [].concat(types) } }),
  getAttributeHistory: (id, name, { from, to, path } = {}) =>
    request(AREA, 'GET', '/api/ngsi/history', { ...raw, params: { entity_id: id, attribute: name, from, to, path } }),
  getAttributeStatus: (id) => readStatus(id),
  listTypesAt: (at) => request(AREA, 'GET', '/api/ngsi/timeshift/types', { ...raw, params: { at } }),
  queryEntitiesAt: (at, query) =>
    request(AREA, 'GET', '/api/ngsi/timeshift/entities', { ...raw, params: { at, ...queryParams(query) } }),
  subscribeEntities,
  getLiveUpdateHealth: () => request(AREA, 'GET', '/api/ngsi/subscription-health'),
  getPrefixes: () => request(AREA, 'GET', '/api/ngsi/prefixes', raw),
  getValueHints: ({ entityType, attribute } = {}) =>
    request(AREA, 'GET', '/api/shacl/hints', { params: { entity_type: entityType, attribute } }),
  getUnits: () => request(AREA, 'GET', '/api/shacl/units'),
}
