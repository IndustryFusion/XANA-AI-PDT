/**
 * Data facade: the only module screens import for data. It exposes every area
 * of the UI data interface (see interface.js), backed by the data source that
 * VITE_DATA_SOURCE selects (default: mock).
 */
import { OPERATIONS } from './interface'
import { DataError, toDataError } from './errors'
import * as mockSource from './sources/mock'

export { DataError } from './errors'
export { OPERATIONS, RUN_STATES } from './interface'

export const DATA_SOURCE_SETTING = 'VITE_DATA_SOURCE'
const SOURCES = { mock: mockSource }
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
export const dataspace = bindArea('dataspace', source.dataspace)
export const knowledgeBase = bindArea('knowledgeBase', source.knowledgeBase)
export const system = bindArea('system', source.system)

export const areas = { session, runs, incidents, entities, alerts, dataspace, knowledgeBase, system }

/** Development-only controls of the source (null in production builds). */
export const DevControls = import.meta.env.DEV ? (source.DevControls ?? null) : null
