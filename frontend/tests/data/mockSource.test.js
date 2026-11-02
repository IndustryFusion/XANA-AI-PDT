import { buildSeed } from '../../src/data/sources/mock/seed'
import { createStore, STORE_KEY } from '../../src/data/sources/mock/store'
import { applyControls, writeControls } from '../../src/data/sources/mock/controls'
import { resolveSource } from '../../src/data'

const NOW = Date.parse('2026-11-02T12:00:00Z')

describe('seed', () => {
  test('is deterministic', () => {
    expect(buildSeed({ now: NOW })).toEqual(buildSeed({ now: NOW }))
  })

  test('references resolve across areas', () => {
    const seed = buildSeed({ now: NOW })
    const ids = new Set(seed.entities.map((e) => e.id))
    for (const run of seed.runs) expect(ids).toContain(run.machineId)
    for (const alert of seed.alerts) expect(ids).toContain(alert.resource)
    for (const e of seed.entities) {
      for (const value of Object.values(e)) {
        if (value?.type === 'Relationship') expect(ids).toContain(value.object)
      }
    }
    expect(ids).toContain(seed.factory.id)
    for (const e of seed.entities) {
      for (const value of Object.values(e)) {
        if (value?.value?.['@id']) expect(ids).toContain(value.value['@id'])
      }
    }
  })

  test('contains every NGSI-LD attribute kind, sub-attributes and metadata', () => {
    const seed = buildSeed({ now: NOW })
    const attrs = seed.entities.flatMap((e) => Object.values(e).filter((v) => v && typeof v === 'object' && v.type))
    const kinds = new Set(attrs.map((a) => a.type))
    expect([...kinds].sort()).toEqual(['GeoProperty', 'JsonProperty', 'LanguageProperty', 'ListProperty', 'Property', 'Relationship', 'VocabularyProperty'])
    expect(attrs.some((a) => a.value?.['@id'])).toBe(true)
    const sensorValue = seed.entities.find((e) => e.type === 'Sensor').value
    expect(sensorValue).toMatchObject({ unitCode: expect.any(String), observedAt: expect.any(String), datasetId: expect.any(String), accuracy: { type: 'Property' } })
  })

  test('records created and deleted entities, and alert histories', () => {
    const seed = buildSeed({ now: NOW })
    expect(Object.keys(seed.entityLog.created)).toHaveLength(1)
    expect(seed.entityLog.deleted.map((d) => d.entity.type)).toEqual(['Sensor', 'Camera'])
    for (const alert of seed.alerts) {
      expect(alert.history[0]).toMatchObject({ type: 'new', status: 'open' })
      expect(alert.history.at(-1).status).toBe(alert.status)
    }
  })
})

describe('store', () => {
  test('keeps operator changes across a reload of the same tab', () => {
    const storage = window.sessionStorage
    const first = createStore({ storage, now: NOW })
    first.update((s) => { s.runs[0].issue = 'changed'; return s })

    const reloaded = createStore({ storage, now: NOW + 60_000 })
    expect(reloaded.get().runs[0].issue).toBe('changed')
    expect(reloaded.get().createdAt).toBe(first.get().createdAt)
  })

  test('a new tab (empty storage) starts from the seed', () => {
    sessionStorage.removeItem(STORE_KEY)
    const store = createStore({ storage: sessionStorage, now: NOW })
    expect(store.get()).toEqual(buildSeed({ now: NOW }))
  })
})

describe('dev controls', () => {
  test('added delay is applied', async () => {
    vi.useFakeTimers()
    writeControls({ latencyMs: { alerts: 1500 } })
    let done = false
    const p = applyControls('alerts').then(() => { done = true })
    await vi.advanceTimersByTimeAsync(1400)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    await p
    expect(done).toBe(true)
    vi.useRealTimers()
  })

  test('failure mode rejects only that area', async () => {
    writeControls({ failure: { alerts: 'unavailable' } })
    await expect(applyControls('alerts')).rejects.toMatchObject({ area: 'alerts', kind: 'unavailable' })
    await expect(applyControls('entities')).resolves.toBeUndefined()
  })
})

describe('source selection', () => {
  test('defaults to the mock source', () => {
    expect(resolveSource(undefined)).toMatchObject({ name: 'mock' })
    expect(resolveSource('')).toMatchObject({ name: 'mock' })
  })

  test('an unknown source yields a configuration error naming the setting', () => {
    expect(resolveSource('backend')).toEqual({
      name: 'backend',
      error: { setting: 'VITE_DATA_SOURCE', value: 'backend', accepted: ['mock'] },
    })
  })
})
