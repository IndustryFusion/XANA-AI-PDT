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
 * Data facade: the only module screens import for data. It exposes every area
 * of the UI data interface (see interface.js), backed by the data source that
 * VITE_DATA_SOURCE selects: `mock` (default) or `backend` (the backend's
 * operations, with every other operation delegated to the mock).
 */
import { OPERATIONS } from './interface'
import { DataError, toDataError } from './errors'
import * as backendSource from './sources/backend'
import * as mockSource from './sources/mock'

export { DataError } from './errors'
export {
  OPERATIONS, RUN_STATES, DELIVERY_STATES, INCIDENT_OUTCOMES, ALERT_STATUSES, ALERT_ACTIONS, LIVE_UPDATE_STATES, IMPORT_RESULTS,
  SHARING_TIERS, POLICY_STATES, REQUEST_STATES, PIPELINES, INGEST_STATES,
} from './interface'

export const DATA_SOURCE_SETTING = 'VITE_DATA_SOURCE'
const SOURCES = { mock: mockSource, backend: backendSource }
export const AVAILABLE_SOURCES = Object.keys(SOURCES)

/** Resolves a source name to `{ name, source }` or `{ name, error }`. */
export function resolveSource(name) {
  const key = (name ?? '').trim() || 'mock'
  if (SOURCES[key]) return { name: key, source: SOURCES[key] }
  return {
    name: key,
    error: { setting: DATA_SOURCE_SETTING, value: key, accepted: AVAILABLE_SOURCES },
  }
}

/** Builds the facade for one area: every interface operation, always defined. */
export function bindArea(area, impl = {}) {
  const bound = {}
  for (const op of OPERATIONS[area]) {
    const fn = impl[op]
    if (op.startsWith('subscribe')) {
      bound[op] = (params, onEvent) => {
        if (!fn) {
          queueMicrotask(() => onEvent({ type: 'error', error: notImplemented(area, op) }))
          return () => {}
        }
        return fn(params, onEvent)
      }
    } else {
      bound[op] = async (...args) => {
        if (!fn) throw notImplemented(area, op)
        try {
          return await fn(...args)
        } catch (err) {
          throw toDataError(area, err)
        }
      }
    }
  }
  return bound
}

/**
 * Events the facade raises after operations that change what other views
 * show, so they can reload at once instead of at their next poll.
 *   CONNECTION_CHANGED: after a successful dataspace connect or disconnect.
 */
export const CONNECTION_CHANGED = 'connectionChanged'
const eventListeners = new Map()

/** Calls `listener` whenever `event` is raised; returns the unsubscribe function. */
export function onDataEvent(event, listener) {
  if (!eventListeners.has(event)) eventListeners.set(event, new Set())
  eventListeners.get(event).add(listener)
  return () => eventListeners.get(event).delete(listener)
}

function emitDataEvent(event) {
  eventListeners.get(event)?.forEach((listener) => listener())
}

/** Raises `event` after each successful call of the given operations of a bound area. */
function emitAfter(bound, ops, event) {
  const wrapped = { ...bound }
  for (const op of ops) {
    wrapped[op] = async (...args) => {
      const result = await bound[op](...args)
      emitDataEvent(event)
      return result
    }
  }
  return wrapped
}

function notImplemented(area, op) {
  return new DataError(area, 'unavailable', `${area}.${op} is not available in this version.`)
}

const selected = resolveSource(import.meta.env.VITE_DATA_SOURCE)

/** Set when VITE_DATA_SOURCE names an unknown source; the app shows a configuration error. */
export const configError = selected.error ?? null
export const sourceName = selected.name
const source = selected.source ?? {}

/** Optional hints from the source for the sign-in screen (e.g. demo credentials). */
export const sourceInfo = source.info ?? null

export const session = bindArea('session', source.session)
export const runs = bindArea('runs', source.runs)
export const incidents = bindArea('incidents', source.incidents)
export const entities = bindArea('entities', source.entities)
export const alerts = bindArea('alerts', source.alerts)
export const dataspace = emitAfter(bindArea('dataspace', source.dataspace), ['connect', 'disconnect'], CONNECTION_CHANGED)
export const knowledgeBase = bindArea('knowledgeBase', source.knowledgeBase)
export const system = bindArea('system', source.system)

export const areas = { session, runs, incidents, entities, alerts, dataspace, knowledgeBase, system }

/** Development-only controls of the source (null in production builds). */
export const DevControls = import.meta.env.DEV ? (source.DevControls ?? null) : null
