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

import { DataError } from '../../errors'
import { applyControls, currentControls } from './controls'
import { historicValue, historyStart, seriesOf, sensorValueAt } from './history'
import { compileQuery } from './ngsiQuery'

/**
 * Mock implementation of the `entities` area: an in-browser stand-in for an
 * NGSI-LD context broker with its time-series history and notifications.
 */

/** Base interval of simulated live updates, divided by the playback speed. */
export const LIVE_UPDATE_MS = 5000
/** Sensors updated per interval when a subscription names no entities. */
const UPDATES_PER_TICK = 3

/** Value hints per entity type and attribute (the "data model" of the mock). */
const VALUE_HINTS = {
  Machine: {
    status: ['running', 'idle', 'setup', 'maintenance', 'fault'],
    operatingMode: ['automatic', 'manual', 'setup', 'maintenance'],
    machineType: ['LaserCutter', 'PressBrake', 'Deburring', 'Coating', 'Chiller', 'Extractor'],
  },
  ProductionLine: { shifts: ['early', 'late', 'night'] },
}

const RANGE_HINTS = { Sensor: { value: { minimum: -40, maximum: 1000, maximumExclusive: true } } }

/** Sample documents `fetchImportDocument` serves; the mock makes no network requests. */
export const SAMPLE_DOCUMENTS = {
  'https://samples.example.org/ngsi-ld/line-d.json': [
    { id: 'urn:ngsi-ld:ProductionLine:line-d', type: 'ProductionLine', name: { type: 'Property', value: 'Line D · Welding' }, partOf: { type: 'Relationship', object: 'urn:ngsi-ld:Factory:plant-north' } },
    { id: 'urn:ngsi-ld:Machine:welding-cell-01', type: 'Machine', name: { type: 'Property', value: 'Welding cell 01' }, status: { type: 'Property', value: 'setup' }, partOf: { type: 'Relationship', object: 'urn:ngsi-ld:ProductionLine:line-d' } },
    { id: 'urn:ngsi-ld:Sensor:welding-cell-01-current', type: 'Sensor', name: { type: 'Property', value: 'Welding cell 01 current' }, value: { type: 'Property', value: 182.5, unitCode: 'A' }, measures: { type: 'Relationship', object: 'urn:ngsi-ld:Machine:welding-cell-01' } },
  ],
  'https://samples.example.org/ngsi-ld/machine-names.json': [
    { id: 'urn:ngsi-ld:Machine:laser-cutter-01', type: 'Machine', name: { type: 'Property', value: 'Laser cutter 01 (hall 2)' } },
    { id: 'urn:ngsi-ld:Machine:laser-cutter-02', type: 'Machine', name: { type: 'Property', value: 'Laser cutter 02 (hall 2)' } },
  ],
  'https://samples.example.org/ngsi-ld/incomplete.json': [
    { id: 'urn:ngsi-ld:Machine:saw-01', name: { type: 'Property', value: 'Band saw 01' } },
  ],
}

const ATTRIBUTE_TYPES = ['Property', 'Relationship', 'GeoProperty', 'JsonProperty', 'LanguageProperty', 'ListProperty', 'VocabularyProperty']
const RESERVED = ['id', 'type', '@context', 'scope', 'createdAt', 'modifiedAt']
const NAME = /^[A-Za-z_][\w-]*$/

const err = (kind, message) => new DataError('entities', kind, message)
const isAttribute = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.type === 'string'
const attributeNames = (e) => Object.keys(e).filter((k) => !RESERVED.includes(k))

function parseMoment(at) {
  const t = Date.parse(at)
  if (Number.isNaN(t)) throw err('invalid', 'Choose a valid date and time.')
  if (t > Date.now()) throw err('invalid', 'The moment must be in the past.')
  return t
}

function validateAttribute(name, attr, existing) {
  if (!NAME.test(name) || RESERVED.includes(name)) throw err('invalid', `"${name}" is not a valid attribute name.`)
  if (!isAttribute(attr) && !existing) throw err('invalid', `Attribute ${name} needs a type and a value.`)
  if (attr.type !== undefined && !ATTRIBUTE_TYPES.includes(attr.type)) throw err('invalid', `${attr.type} is not an NGSI-LD attribute type.`)
  const type = attr.type ?? existing?.type
  if (type === 'Relationship' && 'object' in attr && !/^[a-z][\w+.-]*:\S+$/i.test(String(attr.object ?? ''))) {
    throw err('invalid', `The target of ${name} must be an entity ID (URI).`)
  }
  if (!existing && type === 'Property' && (attr.value === undefined || attr.value === '')) throw err('invalid', `Enter a value for ${name}.`)
  if (!existing && type === 'Relationship' && !attr.object) throw err('invalid', `Enter the target entity of ${name}.`)
  if (existing && 'value' in attr && typeof existing.value === 'number' && typeof attr.value !== 'number') {
    throw err('invalid', `${name} must be a number.`)
  }
  if (existing && 'value' in attr && (attr.value === '' || attr.value === null)) throw err('invalid', `${name} cannot be empty.`)
}

export function createEntitiesArea(store) {
  const withControls = (fn) => async (...args) => {
    await applyControls('entities')
    return fn(...args)
  }
  const speed = () => Number(currentControls().speed) || 1
  const live = () => currentControls().liveUpdates !== 'unavailable' && (currentControls().failure.entities ?? 'none') === 'none'

  const find = (id) => store.get().entities.find((e) => e.id === id)
  const requireEntity = (id) => find(id) ?? (() => { throw err('not_found', `There is no entity ${id}.`) })()
  const now = () => new Date().toISOString()

  function query(list, params) {
    const { test, limit } = compileQuery(params)
    return structuredClone(list.filter(test).slice(0, limit))
  }

  /** Entities as they were at time `t` (see data-interface.md for the approximation). */
  function entitiesAt(t) {
    const { entities, entityLog, createdAt } = store.get()
    const created = (id) => Date.parse(entityLog.created[id] ?? createdAt) - (entityLog.created[id] ? 0 : 90 * 864e5)
    const deleted = entityLog.deleted.filter((d) => Date.parse(d.at) > t).map((d) => d.entity)
    const start = historyStart(createdAt)
    return [...entities, ...deleted].filter((e) => created(e.id) <= t).map((e) => {
      const copy = structuredClone(e)
      for (const name of attributeNames(copy)) {
        const past = t >= start ? historicValue(copy, name, t) : undefined
        if (past && isAttribute(copy[name])) Object.assign(copy[name], past)
      }
      return copy
    })
  }

  function recordDeletion(state, entity) {
    state.entityLog.deleted.push({ at: now(), entity })
    delete state.entityLog.created[entity.id]
  }

  /* ── Live updates ─────────────────────────────────────────────────────── */

  const subscribers = new Set()
  let timer = null
  let cursor = 0

  function stop() {
    clearTimeout(timer)
    timer = null
  }

  function schedule() {
    if (timer || subscribers.size === 0) return
    timer = setTimeout(() => { timer = null; tick() }, LIVE_UPDATE_MS / Math.max(speed(), 0.01))
  }

  function fail(sub) {
    subscribers.delete(sub)
    sub.onEvent({ type: 'error', error: err('unavailable', 'Live updates are not available.') })
  }

  function tick() {
    if (!live()) {
      ;[...subscribers].forEach(fail)
      return
    }
    const sensors = store.get().entities.filter((e) => e.type === 'Sensor' && isAttribute(e.value) && typeof e.value.value === 'number')
    const wanted = new Set()
    let roundRobin = false
    for (const { params } of subscribers) {
      if (params.ids?.length) params.ids.forEach((id) => wanted.add(id))
      else if (!params.type || params.type === 'Sensor') roundRobin = true
    }
    if (roundRobin && sensors.length) {
      for (let i = 0; i < UPDATES_PER_TICK; i++) wanted.add(sensors[(cursor + i) % sensors.length].id)
      cursor = (cursor + UPDATES_PER_TICK) % sensors.length
    }
    const t = Date.now()
    const updates = []
    store.update((state) => {
      for (const e of state.entities) {
        if (!wanted.has(e.id) || e.type !== 'Sensor' || typeof e.value?.value !== 'number') continue
        let next = sensorValueAt(e.id, t, { fine: true })
        if (next == null) continue
        // A live update always carries a changed value.
        if (next === e.value.value) next = Math.round((next + 0.1) * 10) / 10
        e.value.value = next
        e.value.observedAt = new Date(t).toISOString()
        updates.push({ entityId: e.id, entityType: e.type, attributes: { value: structuredClone(e.value) } })
      }
      return state
    })
    for (const sub of subscribers) {
      const { ids, type } = sub.params
      for (const u of updates) {
        if (ids?.length ? ids.includes(u.entityId) : !type || type === u.entityType) {
          sub.onEvent({ type: 'update', entityId: u.entityId, attributes: u.attributes })
        }
      }
    }
    schedule()
  }

  store.onReset?.(() => { stop(); subscribers.clear() })

  return {
    listTypes: withControls(() => [...new Set(store.get().entities.map((e) => e.type))].sort()),
    listAttributes: withControls(() => [...new Set(store.get().entities.flatMap(attributeNames))].sort()),
    queryEntities: withControls((params = {}) => query(store.get().entities, params)),
    getEntity: withControls((id) => structuredClone(requireEntity(id))),

    updateAttributes: withControls((id, attrs = {}) => {
      const entity = requireEntity(id)
      for (const [name, fragment] of Object.entries(attrs)) {
        if (!entity[name]) throw err('not_found', `${id} has no attribute ${name}.`)
        if (!fragment || typeof fragment !== 'object') throw err('invalid', `Attribute ${name} needs a value.`)
        validateAttribute(name, fragment, entity[name])
        for (const [sub, value] of Object.entries(fragment)) {
          if (isAttribute(value)) validateAttribute(sub, value, entity[name][sub])
        }
      }
      store.update((state) => {
        const e = state.entities.find((x) => x.id === id)
        for (const [name, fragment] of Object.entries(attrs)) {
          Object.assign(e[name], structuredClone(fragment))
          // A new value is observed now, unless the fragment names its own observation time.
          if (e[name].observedAt && ('value' in fragment || 'vocab' in fragment) && !('observedAt' in fragment)) e[name].observedAt = now()
        }
        return state
      })
    }),

    appendAttributes: withControls((id, attrs = {}) => {
      const entity = requireEntity(id)
      for (const [name, attr] of Object.entries(attrs)) {
        if (entity[name]) throw err('conflict', `${id} already has an attribute ${name}.`)
        validateAttribute(name, attr, null)
      }
      store.update((state) => {
        Object.assign(state.entities.find((x) => x.id === id), structuredClone(attrs))
        return state
      })
    }),

    deleteAttribute: withControls((id, name, { subAttribute } = {}) => {
      const entity = requireEntity(id)
      if (!entity[name] || RESERVED.includes(name)) throw err('not_found', `${id} has no attribute ${name}.`)
      if (subAttribute && !isAttribute(entity[name][subAttribute])) throw err('not_found', `${name} has no sub-attribute ${subAttribute}.`)
      store.update((state) => {
        const e = state.entities.find((x) => x.id === id)
        if (subAttribute) delete e[name][subAttribute]
        else delete e[name]
        return state
      })
    }),

    deleteEntity: withControls((id) => {
      requireEntity(id)
      store.update((state) => {
        recordDeletion(state, state.entities.find((e) => e.id === id))
        state.entities = state.entities.filter((e) => e.id !== id)
        return state
      })
    }),

    importEntities: withControls((entities) => {
      if (!Array.isArray(entities)) throw err('invalid', 'Import expects a list of NGSI-LD entities.')
      const results = []
      store.update((state) => {
        entities.forEach((raw, i) => {
          const id = typeof raw?.id === 'string' ? raw.id : null
          const fail = (reason) => results.push({ id, result: 'failed', reason })
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(`Entry ${i + 1} is not an entity.`)
          if (!id || !/^[a-z][\w+.-]*:\S+$/i.test(id)) return fail('The entity has no valid ID (URI).')
          if (typeof raw.type !== 'string' || !raw.type) return fail('The entity has no type.')
          const attrs = Object.fromEntries(Object.entries(raw).filter(([k]) => !RESERVED.includes(k)))
          try {
            for (const [name, attr] of Object.entries(attrs)) validateAttribute(name, attr, null)
          } catch (e) {
            return fail(e.message)
          }
          const existing = state.entities.find((e) => e.id === id)
          if (existing && existing.type !== raw.type) return fail(`An entity with this ID exists with the type ${existing.type}.`)
          if (existing) {
            Object.assign(existing, structuredClone(attrs))
            results.push({ id, result: 'updated', reason: null })
          } else {
            state.entities.push({ id, type: raw.type, ...structuredClone(attrs) })
            state.entityLog.created[id] = now()
            results.push({ id, result: 'created', reason: null })
          }
          return undefined
        })
        return state
      })
      return results
    }),

    fetchImportDocument: withControls((url) => {
      let parsed
      try { parsed = new URL(String(url ?? '').trim()) } catch { throw err('invalid', 'Enter a complete URL, for example https://…') }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw err('invalid', 'Only http and https URLs can be imported.')
      const document = SAMPLE_DOCUMENTS[parsed.href]
      if (!document) throw err('unavailable', `${parsed.href} could not be fetched: the mock data source only serves its sample documents.`)
      return { url: parsed.href, document: structuredClone(document) }
    }),

    deleteByTypes: withControls((types = []) => {
      const wanted = [].concat(types)
      const counts = Object.fromEntries(wanted.map((t) => [t, 0]))
      store.update((state) => {
        state.entities = state.entities.filter((e) => {
          if (!wanted.includes(e.type)) return true
          counts[e.type]++
          recordDeletion(state, e)
          return false
        })
        return state
      })
      return wanted.map((type) => ({ type, count: counts[type] }))
    }),

    getAttributeHistory: withControls((id, name, { from, to } = {}) => {
      const entity = requireEntity(id)
      if (!entity[name]) throw err('not_found', `${id} has no attribute ${name}.`)
      const start = Math.max(historyStart(store.get().createdAt), Date.parse(store.get().entityLog.created[id] ?? 0) || 0)
      const lo = Math.max(from ? Date.parse(from) : start, start)
      const hi = Math.min(to ? Date.parse(to) : Date.now(), Date.now())
      if (Number.isNaN(lo) || Number.isNaN(hi)) throw err('invalid', 'The time range is not valid.')
      return seriesOf(entity, name, lo, hi) ?? []
    }),

    getAttributeStatus: withControls((id) => {
      const entity = find(id)
      if (!entity) return {}
      return Object.fromEntries(attributeNames(entity).map((name) => [name, { deleted: false, observedAt: entity[name]?.observedAt ?? null }]))
    }),

    listTypesAt: withControls((at) => [...new Set(entitiesAt(parseMoment(at)).map((e) => e.type))].sort()),
    queryEntitiesAt: withControls((at, params = {}) => query(entitiesAt(parseMoment(at)), params)),

    subscribeEntities(params = {}, onEvent) {
      const sub = { params: params ?? {}, onEvent }
      let closed = false
      applyControls('entities').then(() => {
        if (closed) return
        if (!live()) { fail(sub); return }
        subscribers.add(sub)
        schedule()
      }, (error) => { if (!closed) onEvent({ type: 'error', error }) })
      return () => {
        closed = true
        subscribers.delete(sub)
        if (subscribers.size === 0) stop()
      }
    },

    getLiveUpdateHealth: withControls(() => (live()
      ? { status: 'ok', detail: null }
      : { status: 'unavailable', detail: 'The context broker does not deliver notifications (simulated).' })),

    getValueHints: withControls(({ entityType, attribute } = {}) => {
      const values = [...(VALUE_HINTS[entityType]?.[attribute] ?? [])]
      const range = RANGE_HINTS[entityType]?.[attribute]
      return {
        hintType: values.length ? 'enum' : range ? 'range' : 'none',
        values,
        minimum: range?.minimum ?? null,
        maximum: range?.maximum ?? null,
        minimumExclusive: false,
        maximumExclusive: range?.maximumExclusive ?? false,
        datatype: null,
        detail: null,
      }
    }),
  }
}
