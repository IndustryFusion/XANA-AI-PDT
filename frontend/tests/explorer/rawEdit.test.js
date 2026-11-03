import { areas } from '../../src/data'
import { store } from '../../src/data/sources/mock'
import { applyChanges, parseEntityText, planChanges } from '../../src/features/explorer/rawEdit'
import { resetMock } from '../helpers'

const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'
const entity = {
  id: 'urn:ngsi-ld:Thing:a',
  type: 'Thing',
  name: { type: 'Property', value: 'A' },
  level: { type: 'Property', value: 3, unitCode: 'MTR', observedAt: '2026-01-01T00:00:00Z', accuracy: { type: 'Property', value: 0.1 } },
  partOf: { type: 'Relationship', object: 'urn:ngsi-ld:Thing:b' },
}

describe('parse edited text', () => {
  test('accepts an entity with the same ID and type', () => {
    expect(parseEntityText(JSON.stringify(entity), entity)).toEqual({ entity })
  })

  test.each([
    ['invalid JSON', '{ "id": ', /^The JSON is not valid: /],
    ['a list', '[]', 'The JSON must be a single entity (an object).'],
    ['another ID', JSON.stringify({ ...entity, id: 'urn:ngsi-ld:Thing:x' }), 'The entity ID cannot be changed; it must stay urn:ngsi-ld:Thing:a.'],
    ['another type', JSON.stringify({ ...entity, type: 'Other' }), 'The entity type cannot be changed; it must stay Thing.'],
    ['a bare value', JSON.stringify({ ...entity, name: 'A' }), 'The attribute name must be an object with a type and a value.'],
  ])('rejects %s', (_name, text, error) => {
    expect(parseEntityText(text, entity).error).toEqual(typeof error === 'string' ? error : expect.stringMatching(error))
  })
})

describe('plan changes', () => {
  test('nothing changed', () => {
    expect(planChanges(entity, structuredClone(entity))).toEqual([])
  })

  test('removed, changed and added attributes', () => {
    const next = structuredClone(entity)
    delete next.partOf
    next.name.value = 'B'
    next.colour = { type: 'Property', value: 'red' }
    expect(planChanges(entity, next)).toEqual([
      { op: 'delete', name: 'partOf' },
      { op: 'update', name: 'name', fragment: { value: 'B' } },
      { op: 'append', attrs: { colour: { type: 'Property', value: 'red' } } },
    ])
  })

  test('a changed value keeps the written observation time; a removed sub-attribute is deleted alone', () => {
    const next = structuredClone(entity)
    next.level.value = 4
    delete next.level.accuracy
    expect(planChanges(entity, next)).toEqual([
      { op: 'deleteSub', name: 'level', sub: 'accuracy' },
      { op: 'update', name: 'level', fragment: { value: 4, observedAt: '2026-01-01T00:00:00Z' } },
    ])
  })

  test('an attribute that lost a member or changed its type is replaced', () => {
    const next = structuredClone(entity)
    delete next.level.unitCode
    next.partOf = { type: 'Property', value: 'b' }
    expect(planChanges(entity, next)).toEqual([
      { op: 'delete', name: 'level' },
      { op: 'append', attrs: { level: next.level } },
      { op: 'delete', name: 'partOf' },
      { op: 'append', attrs: { partOf: next.partOf } },
    ])
  })
})

describe('apply changes to the mock', () => {
  beforeEach(() => resetMock())

  test('the entity ends up exactly as written', async () => {
    const before = await areas.entities.getEntity(SENSOR)
    const next = structuredClone(before)
    next.value.value = 12.5
    delete next.value.calibratedAt
    next.value.accuracy.value = 0.2
    delete next.installedOn
    next.measures = { type: 'Relationship', object: 'urn:ngsi-ld:Machine:press-brake-01', since: { type: 'Property', value: '2026-01-01' } }
    next.note = { type: 'Property', value: 'Checked' }
    await applyChanges(areas.entities, SENSOR, planChanges(before, next))
    expect(store.get().entities.find((e) => e.id === SENSOR)).toEqual(next)
  })
})
