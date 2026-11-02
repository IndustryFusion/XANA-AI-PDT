import { MACHINES, SENSORS } from './catalog'

/**
 * Deterministic signal history of the mock: sensor values (every 5 minutes)
 * and machine states (every 2 hours), computed on demand from the entity ID
 * and the time instead of being stored. The same function yields the seeded
 * current values, the history, time-shifted values and live updates, so they
 * agree with each other.
 */
export const HISTORY_STEP_MS = 5 * 60_000
export const STATUS_STEP_MS = 2 * 60 * 60_000
export const HISTORY_DAYS = 7
const DAY = 24 * 60 * 60_000
const MACHINE_STATES = ['running', 'running', 'running', 'idle', 'running', 'setup', 'running', 'maintenance']

/** 32-bit FNV-1a hash of a string. */
export function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Deterministic number in [0, 1) for a key and a slot. */
function noise(key, slot) {
  let t = (key ^ Math.imul(slot, 0x9e3779b1)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const round1 = (v) => Math.round(v * 10) / 10

/** Range and unit of a sensor entity, or null if the ID is not a catalog sensor. */
export function sensorSpec(entityId) {
  const match = /^urn:ngsi-ld:Sensor:(.+)$/.exec(entityId)
  if (!match) return null
  for (const m of MACHINES) {
    if (!match[1].startsWith(`${m.id}-`)) continue
    const sid = match[1].slice(m.id.length + 1)
    const sensor = SENSORS[m.kind].find(([id]) => id === sid)
    if (sensor) return { lo: sensor[2], hi: sensor[3], unit: sensor[1] }
  }
  return null
}

/** Value of a sensor at time `t`; `fine` adds per-second variation for live updates. */
export function sensorValueAt(entityId, t, { fine = false } = {}) {
  const spec = sensorSpec(entityId)
  if (!spec) return null
  const key = hash(entityId)
  const slot = Math.floor(t / HISTORY_STEP_MS)
  const span = spec.hi - spec.lo
  const phase = (key % 1000) / 1000 * 2 * Math.PI
  const daily = Math.sin((2 * Math.PI * slot * HISTORY_STEP_MS) / DAY + phase)
  let value = (spec.lo + spec.hi) / 2 + (span / 4) * daily + (noise(key, slot) - 0.5) * span * 0.15
  if (fine) value += (noise(key, Math.floor(t / 1000)) - 0.5) * span * 0.05
  return round1(value)
}

/** State of a machine at time `t`. */
export function machineStatusAt(entityId, t) {
  return MACHINE_STATES[Math.floor(noise(hash(entityId), Math.floor(t / STATUS_STEP_MS)) * MACHINE_STATES.length)]
}

/** Start of the recorded history for a store created at `createdAt` (ISO). */
export const historyStart = (createdAt) => Date.parse(createdAt) - HISTORY_DAYS * DAY

/**
 * Recorded values of an attribute between `from` and `to` (ms), oldest
 * first, or null if the attribute has no recorded history.
 */
export function seriesOf(entity, name, from, to) {
  let step
  let valueAt
  if (entity.type === 'Sensor' && name === 'value' && sensorSpec(entity.id)) {
    step = HISTORY_STEP_MS
    valueAt = (t) => sensorValueAt(entity.id, t)
  } else if (entity.type === 'Machine' && name === 'status') {
    step = STATUS_STEP_MS
    valueAt = (t) => machineStatusAt(entity.id, t)
  } else {
    return null
  }
  const points = []
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    points.push({ at: new Date(t).toISOString(), value: valueAt(t) })
  }
  return points
}

/** Value of an attribute at time `t` from its history, or undefined if it has none. */
export function historicValue(entity, name, t) {
  if (entity.type === 'Sensor' && name === 'value' && sensorSpec(entity.id)) {
    return { value: sensorValueAt(entity.id, t), observedAt: new Date(Math.floor(t / HISTORY_STEP_MS) * HISTORY_STEP_MS).toISOString() }
  }
  if (entity.type === 'Machine' && name === 'status') {
    return { value: machineStatusAt(entity.id, t), observedAt: new Date(Math.floor(t / STATUS_STEP_MS) * STATUS_STEP_MS).toISOString() }
  }
  return undefined
}
