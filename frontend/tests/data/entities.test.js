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

import { areas } from '../../src/data'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { LIVE_UPDATE_MS, SAMPLE_DOCUMENTS } from '../../src/data/sources/mock/entitiesArea'
import { parseQuery } from '../../src/data/sources/mock/ngsiQuery'
import { resetMock } from '../helpers'

const { entities } = areas
const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'
const HOUR = 3600_000
const ago = (ms) => new Date(Date.now() - ms).toISOString()

beforeEach(() => resetMock())

describe('query', () => {
  test('types and attributes of the seed', async () => {
    expect(await entities.listTypes()).toEqual(['Component', 'Factory', 'Machine', 'ProductionLine', 'Sensor'])
    expect(await entities.listAttributes()).toEqual(expect.arrayContaining(['name', 'status', 'value', 'partOf', 'location', 'configuration']))
  })

  test('by type, ID, ID pattern and limit', async () => {
    expect((await entities.queryEntities({ type: 'Machine' })).map((e) => e.type)).toEqual(Array(8).fill('Machine'))
    expect((await entities.queryEntities({ id: MACHINE })).map((e) => e.id)).toEqual([MACHINE])
    expect((await entities.queryEntities({ idPattern: 'laser-cutter-0[12]$' })).map((e) => e.id)).toEqual([
      'urn:ngsi-ld:Machine:laser-cutter-01', 'urn:ngsi-ld:Machine:laser-cutter-02',
    ])
    expect(await entities.queryEntities({ type: 'Sensor', limit: 3 })).toHaveLength(3)
  })

  test.each([
    ['status=="running"|status=="idle"', (e) => ['running', 'idle'].includes(e.status.value)],
    ['machineType=="PressBrake";partOf=="urn:ngsi-ld:ProductionLine:line-b"', (e) => e.machineType.value === 'PressBrake'],
    ['operatingMode=="setup"', (e) => e.id.endsWith('coating-01')],
    ['configuration[firmware]=="5.4.2"', (e) => e.machineType.value === 'LaserCutter'],
    ['name~="^Laser"', (e) => e.name.value.startsWith('Laser')],
  ])('q %s on machines', async (q, expected) => {
    const all = await entities.queryEntities({ type: 'Machine' })
    const result = await entities.queryEntities({ type: 'Machine', q })
    expect(result.length).toBeGreaterThan(0)
    expect(result.map((e) => e.id)).toEqual(all.filter(expected).map((e) => e.id))
  })

  test('numeric, sub-attribute, list, language and existence conditions', async () => {
    const sensors = await entities.queryEntities({ type: 'Sensor', q: 'value>100' })
    expect(sensors.length).toBeGreaterThan(0)
    expect(sensors.every((e) => e.value.value > 100)).toBe(true)
    expect((await entities.queryEntities({ q: 'value.accuracy>=1;value<300' })).every((e) => e.value.accuracy.value >= 1)).toBe(true)
    expect((await entities.queryEntities({ q: 'shifts=="night"' })).map((e) => e.id)).toEqual(['urn:ngsi-ld:ProductionLine:line-a'])
    expect((await entities.queryEntities({ q: 'description~="Blech"' })).map((e) => e.type)).toEqual(['Factory'])
    expect((await entities.queryEntities({ q: 'location' })).map((e) => e.type)).toEqual(['Factory'])
    expect((await entities.queryEntities({ type: 'Sensor', q: '!installedOn' }))).toEqual([])
  })

  test('nothing matches', async () => {
    expect(await entities.queryEntities({ type: 'Machine', q: 'status=="exploded"' })).toEqual([])
  })

  test.each([
    [{ q: 'status==' }, /not valid/],
    [{ q: '(status=="x"' }, /missing "\)"/],
    [{ idPattern: '[' }, /not a valid regular expression/],
    [{ q: 'name~="("' }, /not a valid pattern/],
    [{ type: 'Machine', limit: 0 }, /limit/],
  ])('invalid query %j', async (query, message) => {
    await expect(entities.queryEntities(query)).rejects.toMatchObject({ kind: 'invalid', message: expect.stringMatching(message) })
  })

  test('parser keeps precedence: and binds tighter than or', () => {
    expect(parseQuery('a==1|b==2;c==3')).toMatchObject({ op: 'or', terms: [{ op: '==' }, { op: 'and' }] })
  })

  test('unknown entity is not found', async () => {
    await expect(entities.getEntity('urn:ngsi-ld:Machine:nope')).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('edit', () => {
  test('updates a value and its observation time', async () => {
    await entities.updateAttributes(MACHINE, { status: { value: 'maintenance' } })
    const machine = await entities.getEntity(MACHINE)
    expect(machine.status.value).toBe('maintenance')
    expect(Date.now() - Date.parse(machine.status.observedAt)).toBeLessThan(5000)
  })

  test('keeps an observation time the fragment names', async () => {
    const observedAt = '2026-01-02T03:04:05.000Z'
    await entities.updateAttributes(MACHINE, { status: { value: 'idle', observedAt } })
    expect((await entities.getEntity(MACHINE)).status).toMatchObject({ value: 'idle', observedAt })
  })

  test('rejects a text for a numeric value and unknown attributes', async () => {
    await expect(entities.updateAttributes(SENSOR, { value: { value: 'high' } })).rejects.toMatchObject({ kind: 'invalid', message: 'value must be a number.' })
    await expect(entities.updateAttributes(SENSOR, { nope: { value: 1 } })).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('appends attributes, refusing existing names and invalid input', async () => {
    await entities.appendAttributes(MACHINE, { location: { type: 'Property', value: 'Hall 2' }, servicedBy: { type: 'Relationship', object: 'urn:ngsi-ld:Machine:chiller-01' } })
    expect((await entities.getEntity(MACHINE)).location.value).toBe('Hall 2')
    await expect(entities.appendAttributes(MACHINE, { status: { type: 'Property', value: 'x' } })).rejects.toMatchObject({ kind: 'conflict' })
    await expect(entities.appendAttributes(MACHINE, { 'bad name': { type: 'Property', value: 'x' } })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(entities.appendAttributes(MACHINE, { owner: { type: 'Relationship', object: 'not an id' } })).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('deletes a sub-attribute only, then the attribute, then the entity', async () => {
    await entities.deleteAttribute(SENSOR, 'value', { subAttribute: 'accuracy' })
    let sensor = await entities.getEntity(SENSOR)
    expect(sensor.value.accuracy).toBeUndefined()
    expect(sensor.value.calibratedAt).toBeDefined()
    await entities.deleteAttribute(SENSOR, 'installedOn')
    sensor = await entities.getEntity(SENSOR)
    expect(sensor.installedOn).toBeUndefined()
    await entities.deleteEntity(SENSOR)
    await expect(entities.getEntity(SENSOR)).rejects.toMatchObject({ kind: 'not_found' })
    await expect(entities.deleteAttribute(MACHINE, 'value', { subAttribute: 'x' })).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('value hints from the data model', async () => {
    expect(await entities.getValueHints({ entityType: 'Machine', attribute: 'status' })).toContain('maintenance')
    expect(await entities.getValueHints({ entityType: 'Sensor', attribute: 'value' })).toEqual([])
  })
})

describe('import and bulk delete', () => {
  test('creates, updates and reports failures per entity', async () => {
    const results = await entities.importEntities([
      ...SAMPLE_DOCUMENTS['https://samples.example.org/ngsi-ld/line-d.json'],
      { id: MACHINE, type: 'Machine', name: { type: 'Property', value: 'Press brake 01 (new)' } },
      { id: 'urn:ngsi-ld:Machine:no-type' },
      { id: MACHINE, type: 'Sensor' },
    ])
    expect(results.map((r) => r.result)).toEqual(['created', 'created', 'created', 'updated', 'failed', 'failed'])
    expect(results[4].reason).toBe('The entity has no type.')
    expect((await entities.getEntity(MACHINE)).name.value).toBe('Press brake 01 (new)')
    await expect(entities.importEntities({})).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('fetches only sample documents and makes no network requests', async () => {
    const { document } = await entities.fetchImportDocument('https://samples.example.org/ngsi-ld/line-d.json')
    expect(document).toHaveLength(3)
    await expect(entities.fetchImportDocument('https://elsewhere.example.org/x.json')).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(entities.fetchImportDocument('not a url')).rejects.toMatchObject({ kind: 'invalid' })
  })

  test('deletes all entities of the selected types with counts per type', async () => {
    expect(await entities.deleteByTypes(['Sensor', 'Component'])).toEqual([{ type: 'Sensor', count: 13 }, { type: 'Component', count: 18 }])
    expect(await entities.listTypes()).toEqual(['Factory', 'Machine', 'ProductionLine'])
  })
})

describe('history', () => {
  test('5-minute sensor values within the range, oldest first', async () => {
    const points = await entities.getAttributeHistory(SENSOR, 'value', { from: ago(HOUR), to: ago(0) })
    expect(points.length).toBeGreaterThanOrEqual(11)
    expect(points.length).toBeLessThanOrEqual(13)
    expect(points.every((p) => typeof p.value === 'number')).toBe(true)
    expect([...points].sort((a, b) => a.at.localeCompare(b.at))).toEqual(points)
  })

  test('machine states, nothing before the recorded period, and nothing for unrecorded attributes', async () => {
    const states = await entities.getAttributeHistory(MACHINE, 'status', { from: ago(24 * HOUR) })
    expect(states.length).toBe(12)
    expect(typeof states[0].value).toBe('string')
    expect(await entities.getAttributeHistory(SENSOR, 'value', { from: ago(30 * 24 * HOUR), to: ago(20 * 24 * HOUR) })).toEqual([])
    expect(await entities.getAttributeHistory(MACHINE, 'name', {})).toEqual([])
  })

  test('is deterministic', async () => {
    const range = { from: ago(6 * HOUR), to: ago(HOUR) }
    expect(await entities.getAttributeHistory(SENSOR, 'value', range)).toEqual(await entities.getAttributeHistory(SENSOR, 'value', range))
  })
})

describe('time-shift', () => {
  test('hides entities created later, shows deleted ones and takes values from history', async () => {
    const threeDaysAgo = ago(72 * HOUR)
    expect(await entities.listTypesAt(threeDaysAgo)).toContain('Camera')
    const sensors = await entities.queryEntitiesAt(threeDaysAgo, { type: 'Sensor' })
    const ids = sensors.map((e) => e.id)
    expect(ids).toContain('urn:ngsi-ld:Sensor:press-brake-01-noise')
    expect(ids).not.toContain('urn:ngsi-ld:Sensor:laser-cutter-02-power')
    const [flow] = await entities.queryEntitiesAt(threeDaysAgo, { id: SENSOR })
    const [point] = await entities.getAttributeHistory(SENSOR, 'value', { from: flow.value.observedAt, to: flow.value.observedAt })
    expect(flow.value.value).toBe(point.value)
  })

  test('entities deleted in this session are still there before their deletion', async () => {
    const before = ago(60_000)
    await entities.deleteEntity(MACHINE)
    expect((await entities.queryEntitiesAt(before, { id: MACHINE }))).toHaveLength(1)
    expect((await entities.queryEntities({ id: MACHINE }))).toHaveLength(0)
  })

  test('rejects moments in the future', async () => {
    await expect(entities.listTypesAt(new Date(Date.now() + HOUR).toISOString())).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('live updates', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('emits sensor value updates, scaled by the playback speed, until unsubscribed', async () => {
    writeControls({ speed: 10 })
    const events = []
    const unsubscribe = entities.subscribeEntities({ ids: [SENSOR] }, (e) => events.push(e))
    await vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 * 5 + 10)
    expect(events.length).toBeGreaterThan(2)
    expect(events[0]).toMatchObject({ type: 'update', entityId: SENSOR, attributes: { value: { type: 'Property', unitCode: 'l/min' } } })
    expect(store.get().entities.find((e) => e.id === SENSOR).value.value).toBe(events.at(-1).attributes.value.value)
    unsubscribe()
    const count = events.length
    await vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS * 3)
    expect(events.length).toBe(count)
  })

  test('reports an error event and unavailable health when live updates fail', async () => {
    writeControls({ speed: 10 })
    const events = []
    entities.subscribeEntities({}, (e) => events.push(e))
    await vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 + 10)
    expect(events.some((e) => e.type === 'update')).toBe(true)
    writeControls({ liveUpdates: 'unavailable' })
    await vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS / 10 + 10)
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'unavailable' } })
    expect(await entities.getLiveUpdateHealth()).toMatchObject({ status: 'unavailable' })
    writeControls({ liveUpdates: 'available', failure: { entities: 'unavailable' } })
    const later = []
    entities.subscribeEntities({}, (e) => later.push(e))
    await vi.advanceTimersByTimeAsync(10)
    expect(later[0]).toMatchObject({ type: 'error' })
  })
})

describe('attribute status and the search limit', () => {
  test('a deleted attribute is reported with when it went', async () => {
    await entities.deleteAttribute(SENSOR, 'value')
    const states = await entities.getAttributeStatus(SENSOR)
    expect(states.value.deleted).toBe(true)
    expect(Date.parse(states.value.observedAt)).not.toBeNaN()
    expect(await entities.getAttributeStatus('urn:ngsi-ld:Machine:nope')).toEqual({})
  })

  test('a capped search and a capped history say so', async () => {
    writeControls({ searchCap: 2 })
    const found = await entities.queryEntities({ type: 'Sensor', q: 'value>-1000', limit: 1000 })
    expect(found.limited).toMatchObject({ scanned: 2 })
    expect(found.limited.total).toBeGreaterThan(2)
    const points = await entities.getAttributeHistory(SENSOR, 'value', { from: new Date(Date.now() - 3600_000 * 24).toISOString() })
    expect(points).toHaveLength(2)
    expect(points.limited).toEqual({ newest: 2 })
    writeControls({ searchCap: null })
  })
})
