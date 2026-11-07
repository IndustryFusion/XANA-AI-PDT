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

// The data-interface shape tests, run against the backend source with answers
// recorded from a real backend (scripts/record-backend-fixtures.mjs).
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { bindArea } from '../../src/data'
import { SHAPES } from '../../src/data/interface'
import { checkShape } from '../../src/data/shape'
import * as backend from '../../src/data/sources/backend'

const DIR = resolve(__dirname, 'backend-fixtures')
const fixtures = Object.fromEntries(
  readdirSync(DIR).map((file) => [file.replace(/\.json$/, ''), JSON.parse(readFileSync(resolve(DIR, file), 'utf8'))]),
)

/** Arguments per operation; identifiers come from the recorded requests. */
const ARGS = {
  'runs.listActiveRuns': () => [],
  'runs.startRun': () => [{ machineId: 'laser-cutter-01', issue: 'Cut edges show burrs since this morning' }],
  'runs.getRun': (f) => [f.body.run_id],
  'runs.clarify': () => ['r', { text: 'The nozzle was changed at 8:00.' }],
  'runs.confirmResolution': () => ['r', { confirmed: true }],
  'runs.escalationPreflight': () => ['r'],
  'runs.stopRun': () => ['r'],
  'runs.archiveRun': () => ['r'],
  'incidents.listIncidents': () => [{}],
  'incidents.getIncident': (f) => [f.body.id],
  'incidents.reopenIncident': () => ['1'],
  'system.getHealth': () => [{ fresh: true }],
  'session.getAuthConfig': () => [],
  'session.getSession': () => [],
  'session.signIn': () => [{ username: 'operator', password: 'operator' }],
  'session.signOut': () => [],
  'alerts.listAlerts': () => [{}],
  'alerts.countAlerts': () => [{}],
  'alerts.getAlert': (f) => [f.body.id],
  'alerts.applyAlertAction': (f) => [f.body.id, { action: 'close', text: 'Done.' }],
  'alerts.listEnvironments': () => [],
  'alerts.listServices': () => [],
  'alerts.getAlertSettings': () => [],
  'entities.getLiveUpdateHealth': () => [],
  'entities.getValueHints': () => [{ entityType: 'Machine', attribute: 'status' }],
  'entities.getStats': () => [],
  'entities.listTypes': () => [],
  'entities.listAttributes': () => [],
  'entities.queryEntities': () => [{ type: 'Machine', limit: 5 }],
  'entities.getEntity': (f) => [f.body.id],
  'entities.updateAttributes': () => ['urn:m', { a: { value: 1 } }],
  'entities.appendAttributes': () => ['urn:m', { a: { type: 'Property', value: 1 } }],
  'entities.deleteAttribute': () => ['urn:m', 'a'],
  'entities.deleteEntity': () => ['urn:m'],
  'entities.importEntities': () => [[]],
  'entities.fetchImportDocument': () => ['https://example.org/a.json'],
  'entities.deleteByTypes': () => [['T']],
  'entities.getAttributeHistory': () => ['urn:m', 'value'],
  'entities.getAttributeStatus': () => ['urn:m'],
  'entities.listTypesAt': () => ['2026-01-01T00:00:00Z'],
  'entities.queryEntitiesAt': () => ['2026-01-01T00:00:00Z', { type: 'Machine' }],
}

/** Answers every request with the recorded response; records the request method. */
function replay(fixture) {
  const methods = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    methods.push(init.method)
    const body = fixture.status === 204 ? null : JSON.stringify(fixture.body)
    return new Response(body, { status: fixture.status })
  }))
  return methods
}

afterEach(() => vi.unstubAllGlobals())

describe('backend source matches the documented shapes (recorded backend)', () => {
  test('every operation the backend serves has a recording, except the streams and reopenRun', () => {
    const served = Object.entries(backend.SERVED).flatMap(([area, ops]) => ops.map((op) => `${area}.${op}`))
    const expected = served.filter((op) => !['runs.subscribeRun', 'runs.reopenRun', 'entities.subscribeEntities'].includes(op)).sort()
    expect(Object.keys(ARGS).sort()).toEqual(expected)
    for (const op of expected) expect(fixtures[op], op).toBeDefined()
  })

  test.each(Object.keys(ARGS))('%s', async (key) => {
    const [area, op] = key.split('.')
    const fixture = fixtures[key]
    const methods = replay(fixture)
    const result = await bindArea(area, backend[area])[op](...ARGS[key](fixture))
    expect(methods).toEqual([fixture.method])
    expect(checkShape(result, SHAPES[area][op])).toEqual([])
  })

  test('runs.reopenRun: the recorded refusal is a conflict with the backend message', async () => {
    const fixture = fixtures['runs.reopenRun.refused']
    replay(fixture)
    await expect(bindArea('runs', backend.runs).reopenRun('r')).rejects.toMatchObject({
      kind: 'conflict',
      message: fixture.body.error.message,
    })
  })

  test('a recorded run carries steps of every analysis node and the state data the run view reads', async () => {
    const fixture = fixtures['incidents.getIncident']
    replay(fixture)
    const incident = await bindArea('incidents', backend.incidents).getIncident(fixture.body.id)
    expect(new Set(incident.trace.map((s) => s.node))).toEqual(
      new Set(['observe', 'hypothesize', 'validate', 'decide', 'clarification', 'resolution', 'act']),
    )
    expect(incident.decision).toMatchObject({ rootCause: expect.any(String), recommendedAction: expect.any(String), confidence: expect.any(Number) })
  })
})
