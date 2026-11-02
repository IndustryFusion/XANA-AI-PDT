import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPERATIONS, SHAPES } from '../../src/data/interface'
import { checkShape } from '../../src/data/shape'
import { areas, bindArea, DataError } from '../../src/data'

const docs = readFileSync(resolve(__dirname, '../../docs/data-interface.md'), 'utf8')

describe('interface documentation', () => {
  test.each(Object.entries(OPERATIONS).flatMap(([area, ops]) => ops.map((op) => [area, op])))(
    '%s.%s is documented',
    (area, op) => {
      expect(docs).toContain(`## ${area}`)
      expect(docs).toContain(`\`${op}(`)
    },
  )
})

describe('facade', () => {
  test('exposes every operation of every area', () => {
    for (const [area, ops] of Object.entries(OPERATIONS)) {
      for (const op of ops) expect(typeof areas[area][op]).toBe('function')
    }
  })

  test('operations a source does not implement reject with unavailable', async () => {
    await expect(areas.knowledgeBase.listDocuments()).rejects.toMatchObject({ name: 'DataError', area: 'knowledgeBase', kind: 'unavailable' })
  })

  test('unimplemented subscriptions report an error event', async () => {
    const events = []
    const unsubscribe = areas.runs.subscribeRun('run-x', (e) => events.push(e))
    await Promise.resolve()
    expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'unavailable' } })
    expect(typeof unsubscribe).toBe('function')
  })

  test('foreign errors from a source become DataErrors of that area', async () => {
    const area = bindArea('alerts', { countAlerts: async () => { throw new TypeError('boom') } })
    const err = await area.countAlerts().catch((e) => e)
    expect(err).toBeInstanceOf(DataError)
    expect(err).toMatchObject({ area: 'alerts', kind: 'unavailable', message: 'boom' })
  })
})

describe('mock source matches the documented shapes', () => {
  const args = { session: { signIn: [{ username: 'operator', password: 'operator' }] } }
  const implemented = Object.entries(SHAPES).flatMap(([area, ops]) => Object.keys(ops).map((op) => [area, op]))

  test.each(implemented)('%s.%s', async (area, op) => {
    const result = await areas[area][op](...(args[area]?.[op] ?? []))
    expect(checkShape(result, SHAPES[area][op])).toEqual([])
  })

  test('wrong credentials are rejected as unauthorized', async () => {
    await expect(areas.session.signIn({ username: 'operator', password: 'nope' })).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})

describe('shape checker', () => {
  test('reports mismatches with their path', () => {
    const errors = checkShape({ a: 1, list: [{ s: 2 }], e: 'x' }, { a: 'string', list: [{ s: 'string' }], e: { $enum: ['y'] } })
    expect(errors).toHaveLength(3)
    expect(errors[1]).toContain('$.list[0].s')
  })
})
