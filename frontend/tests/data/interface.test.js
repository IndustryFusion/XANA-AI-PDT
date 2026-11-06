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

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPERATIONS, SHAPES } from '../../src/data/interface'
import { checkShape } from '../../src/data/shape'
import { areas, bindArea, DataError } from '../../src/data'
import { writeControls } from '../../src/data/sources/mock/controls'
import { store } from '../../src/data/sources/mock'
import { MOCK_DATASPACE_SECRET } from '../../src/data/sources/mock/dataspaceArea'
import { addRun, findRun, resetMock } from '../helpers'

const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'
const MARKDOWN = { name: 'Notes.md', type: 'text/markdown', size: 24, dataUrl: 'data:text/markdown,%23%20Notes%0ACheck%20the%20nozzle.' }
/** Starts an ingestion job synchronously through the mock store, for operations that need one. */
function uploadNow() {
  store.update((s) => {
    s.kb.jobs['job-90'] = { jobId: 'job-90', name: 'x.md', pipeline: 'base', status: 'queued', progress: 0, error: null, chunks: null, size: 10, startedAt: Date.now(), fails: false, passages: [] }
    return s
  })
  return 'job-90'
}
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
    await expect(bindArea('alerts', {}).listAlerts()).rejects.toMatchObject({ name: 'DataError', area: 'alerts', kind: 'unavailable' })
  })

  test('unimplemented subscriptions report an error event', async () => {
    const events = []
    const unsubscribe = bindArea('entities', {}).subscribeEntities({}, (e) => events.push(e))
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
  beforeEach(() => {
    resetMock()
    writeControls({ speed: 25 })
  })

  const escalated = (scenario, more = []) => () => addRun({ scenario, actions: [['escalate'], ...more] })
  /** Arguments per operation; functions arrange the mock state first. */
  const args = {
    session: { signIn: () => [{ username: 'operator', password: 'operator' }] },
    runs: {
      startRun: () => [{ machineId: 'press-brake-01', issue: 'Back gauge noise' }],
      getRun: () => ['run-1003'],
      clarify: () => ['run-1002', { text: 'Only on parts longer than 2 m.' }],
      confirmResolution: () => ['run-1004', { confirmed: true }],
      escalationPreflight: () => ['run-1002'],
      escalate: () => ['run-1002'],
      approveDataRequest: () => [escalated('request_beyond_tier')(), { approved: true }],
      replyToRecommendation: () => [escalated('mb_recommendation')(), { action: 'resolved' }],
      sendConversationAct: () => ['run-1003', { act: 'inform', text: 'The machine runs at reduced load.' }],
      askAgent: () => ['run-1003', 'What did the machine builder ask for?'],
      getOutboxStatus: () => ['run-1003'],
      refreshConversationStatus: () => ['run-1003'],
      recordMachineBuilderClose: () => ['run-1003', { outcome: 'resolved', reason: 'Agreed by phone.' }],
      reopenRun: () => [escalated('stop_and_reopen', [['stopRun']])()],
      stopRun: () => ['run-1001'],
      archiveRun: () => [addRun({ scenario: 'failure' })],
    },
    incidents: {
      listIncidents: () => [{}],
      getIncident: () => ['35'],
      reopenIncident: () => ['35'],
    },
    entities: {
      queryEntities: () => [{ type: 'Sensor', limit: 5 }],
      getEntity: () => [SENSOR],
      updateAttributes: () => [SENSOR, { value: { value: 20.5 } }],
      appendAttributes: () => [SENSOR, { location: { type: 'Property', value: 'Hall 2' } }],
      deleteAttribute: () => [SENSOR, 'value', { subAttribute: 'accuracy' }],
      deleteEntity: () => [SENSOR],
      importEntities: () => [[{ id: 'urn:ngsi-ld:Machine:saw-01', type: 'Machine' }]],
      fetchImportDocument: () => ['https://samples.example.org/ngsi-ld/line-d.json'],
      deleteByTypes: () => [['Component']],
      getAttributeHistory: () => [SENSOR, 'value', { from: new Date(Date.now() - 3600_000).toISOString() }],
      listTypesAt: () => [new Date(Date.now() - 86400_000).toISOString()],
      queryEntitiesAt: () => [new Date(Date.now() - 86400_000).toISOString(), { type: 'Machine' }],
      getValueHints: () => [{ entityType: 'Machine', attribute: 'status' }],
    },
    alerts: {
      listAlerts: () => [{}],
      getAlert: () => ['alert-001'],
      applyAlertAction: () => ['alert-001', { action: 'close', text: 'Done.' }],
    },
    dataspace: {
      connect: () => [{ secret: MOCK_DATASPACE_SECRET }],
      getPeerCapabilities: () => ['peer-formwerk'],
      decideCapabilityRequest: () => ['req-005', { approved: true, note: 'For the next service visit.' }],
      setCapabilityPolicy: () => [{ peerId: 'peer-formwerk', capability: 'twin:adjacents', action: 'grant' }],
      resolveNames: () => [['peer-formwerk', 'peer-hydroservice']],
      resolveBuilders: () => [['urn:ngsi-ld:Machine:press-brake-01']],
    },
    knowledgeBase: {
      listDocuments: () => [{ pipeline: 'base' }],
      uploadDocument: () => [{ file: MARKDOWN, pipeline: 'base' }],
      getIngestJob: () => [uploadNow()],
      updateDescription: () => ['Shift handover checklist.md', 'Updated checks.', { pipeline: 'base' }],
      deleteDocument: () => ['Shift handover checklist.md', { pipeline: 'base' }],
      query: () => [{ text: 'protective window burr', pipeline: 'base' }],
    },
    system: {
      saveServiceSettings: () => [{ messageBroker: 'mqtt://broker-2.example.org:1883' }],
    },
  }
  const implemented = Object.entries(SHAPES).filter(([area]) => OPERATIONS[area]).flatMap(([area, ops]) => Object.keys(ops).map((op) => [area, op]))

  test.each(implemented)('%s.%s', async (area, op) => {
    const result = await areas[area][op](...(args[area]?.[op]?.() ?? []))
    expect(checkShape(result, SHAPES[area][op])).toEqual([])
  })

  test('every operation of every area is implemented and shape-checked', () => {
    for (const area of Object.keys(OPERATIONS)) expect(Object.keys(SHAPES[area]).sort()).toEqual(OPERATIONS[area].filter((op) => !op.startsWith('subscribe')).sort())
  })

  test('wrong credentials are rejected as unauthorized', async () => {
    await expect(areas.session.signIn({ username: 'operator', password: 'nope' })).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})

describe('runs: invalid states are conflicts', () => {
  beforeEach(() => resetMock())

  test.each([
    ['clarify on a run waiting for confirmation', () => areas.runs.clarify('run-1004', { text: 'x' })],
    ['confirming a run that waits for input', () => areas.runs.confirmResolution('run-1002', { confirmed: true })],
    ['escalating a run that is still running', () => areas.runs.escalate('run-1001')],
    ['approving without a data request', () => areas.runs.approveDataRequest('run-1003', { approved: true })],
    ['answering a recommendation that was not sent', () => areas.runs.replyToRecommendation('run-1003', { action: 'resolved' })],
    ['granting without a pending request', () => areas.runs.sendConversationAct('run-1003', { act: 'grant' })],
    ['sending acts before escalation', () => areas.runs.sendConversationAct('run-1002', { act: 'inform', text: 'x' })],
    ['recording a close without a conversation', () => areas.runs.recordMachineBuilderClose('run-1002', { outcome: 'resolved', reason: 'x' })],
    ['reopening an open run', () => areas.runs.reopenRun('run-1003')],
    ['archiving an open run', () => areas.runs.archiveRun('run-1002')],
  ])('%s', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ area: 'runs', kind: 'conflict' })
  })

  test('stopping a finished run', async () => {
    const runId = addRun({ scenario: 'failure' })
    await expect(areas.runs.stopRun(runId)).rejects.toMatchObject({ kind: 'conflict' })
  })

  test('reopening a run closed as escalated', async () => {
    const runId = addRun({ scenario: 'direct_contact', actions: [['escalate'], ['sendConversationAct', { act: 'escalate' }], ['sendConversationAct', { act: 'close', outcome: 'escalated' }]] })
    expect(findRun(runId).status).toBe('stopped')
    await expect(areas.runs.reopenRun(runId)).rejects.toMatchObject({ kind: 'conflict' })
  })

  test('reopening an incident that is already open again', async () => {
    await areas.incidents.reopenIncident('35')
    await expect(areas.incidents.reopenIncident('35')).rejects.toMatchObject({ area: 'incidents', kind: 'conflict' })
  })

  test('unknown runs and incidents are not found', async () => {
    await expect(areas.runs.getRun('run-nope')).rejects.toMatchObject({ kind: 'not_found' })
    await expect(areas.incidents.getIncident('999')).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('starting a run validates its input', async () => {
    await expect(areas.runs.startRun({ machineId: '', issue: 'x' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(areas.runs.startRun({ machineId: 'no-such-machine', issue: 'x' })).rejects.toMatchObject({ kind: 'invalid' })
    await expect(areas.runs.startRun({ machineId: 'press-brake-01', issue: ' ' })).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('incidents', () => {
  beforeEach(() => resetMock())

  test('a dozen past incidents across machines and outcomes, newest first', async () => {
    const list = await areas.incidents.listIncidents()
    expect(list).toHaveLength(12)
    expect(new Set(list.map((i) => i.outcome))).toEqual(new Set(['completed', 'failed', 'stopped', 'mb_closed']))
    expect(new Set(list.map((i) => i.machineId)).size).toBeGreaterThan(5)
    expect([...list].sort((a, b) => b.closedAt.localeCompare(a.closedAt))).toEqual(list)
  })

  test('filters by machine, outcome and date range', async () => {
    const chiller = 'urn:ngsi-ld:Machine:chiller-01'
    expect((await areas.incidents.listIncidents({ machineId: chiller })).every((i) => i.machineId === chiller)).toBe(true)
    expect((await areas.incidents.listIncidents({ status: 'failed' })).map((i) => i.outcome)).toEqual(['failed'])
    const all = await areas.incidents.listIncidents()
    const day = all[3].closedAt.slice(0, 10)
    const sameDay = await areas.incidents.listIncidents({ from: day, to: day })
    expect(sameDay.map((i) => i.id)).toContain(all[3].id)
    expect(sameDay.length).toBeLessThan(all.length)
  })

  test('an archived run becomes an incident and leaves the active list', async () => {
    const runId = addRun({ scenario: 'happy_path', machine: 'deburring-01', issue: 'Archive me', actions: [['confirmResolution', { confirmed: true }]] })
    await areas.runs.archiveRun(runId)
    expect((await areas.runs.listActiveRuns()).map((r) => r.runId)).not.toContain(runId)
    const [latest] = await areas.incidents.listIncidents()
    expect(latest).toMatchObject({ issue: 'Archive me', outcome: 'completed', machineId: 'urn:ngsi-ld:Machine:deburring-01' })
    const detail = await areas.incidents.getIncident(latest.id)
    expect(detail.trace.map((s) => s.node)).toContain('decide')
    expect(detail.decision.rootCause).toBeTruthy()
  })

  test('reopening an escalated incident continues its conversation in a new run', async () => {
    const { runId } = await areas.incidents.reopenIncident('35')
    const run = await areas.runs.getRun(runId)
    expect(run.status).toBe('awaiting_machine_builder')
    expect(run.incidentId).toBe(35)
    expect(run.steps.filter((s) => s.node === 'message').length).toBeGreaterThan(2)
  })

  test('reopening an incident without escalation starts a new analysis', async () => {
    const { runId } = await areas.incidents.reopenIncident('30')
    expect((await areas.runs.getRun(runId)).status).toBe('running')
  })
})

describe('shape checker', () => {
  test('reports mismatches with their path', () => {
    const errors = checkShape({ a: 1, list: [{ s: 2 }], e: 'x' }, { a: 'string', list: [{ s: 'string' }], e: { $enum: ['y'] } })
    expect(errors).toHaveLength(3)
    expect(errors[1]).toContain('$.list[0].s')
  })
})
