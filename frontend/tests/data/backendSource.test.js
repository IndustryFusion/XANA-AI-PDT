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

import { afterEach, beforeEach, vi } from 'vitest'
import { bindArea, DataError } from '../../src/data'
import * as backend from '../../src/data/sources/backend'
import { TIMEOUT_MS } from '../../src/data/sources/backend/http'
import { fromBackend, outboundFiles, toBackend } from '../../src/data/sources/backend/map'
import { RECONNECT_DELAYS_MS } from '../../src/data/sources/backend/runs'
import * as mock from '../../src/data/sources/mock'

/** A fake fetch answering from `routes` ("METHOD /path" → response); records each call. */
function fakeFetch(routes = {}) {
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    const { pathname, search } = new URL(url, 'http://ui.test')
    const key = `${init.method} ${pathname}`
    calls.push({ key, search, body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const route = routes[key] ?? { status: 404, body: { error: { kind: 'not_found', message: `No route ${key}` } } }
    if (route.reject) throw route.reject
    const text = route.body === undefined ? '' : typeof route.body === 'string' ? route.body : JSON.stringify(route.body)
    return new Response(route.status === 204 ? null : text, { status: route.status ?? 200 })
  })
  fn.calls = calls
  vi.stubGlobal('fetch', fn)
  return fn
}

const runs = bindArea('runs', backend.runs)
const incidents = bindArea('incidents', backend.incidents)
const system = bindArea('system', backend.system)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('key mapping', () => {
  test('backend answers become camelCase, recursively, without touching values', () => {
    const answer = {
      run_id: 'r1',
      data: { root_cause: 'Wear', rejected: [{ recommended_action: 'Replace', reason: 'see root_cause_x' }] },
      steps: [{ node: 'decide', output: { past_incidents: [{ incident_id: '7' }] } }],
      'urn:ngsi-ld:Machine:press-01': { latency_ms: 4 },
    }
    expect(fromBackend(answer)).toEqual({
      runId: 'r1',
      data: { rootCause: 'Wear', rejected: [{ recommendedAction: 'Replace', reason: 'see root_cause_x' }] },
      steps: [{ node: 'decide', output: { pastIncidents: [{ incidentId: '7' }] } }],
      'urn:ngsi-ld:Machine:press-01': { latencyMs: 4 },
    })
  })

  test('requests become snake_case', () => {
    expect(toBackend({ machineId: 'm', issue: 'Text with machineId inside' })).toEqual({
      machine_id: 'm',
      issue: 'Text with machineId inside',
    })
  })

  test('files keep name, type, size and the data URL', () => {
    const file = { name: 'a.png', type: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAA=', extra: 1 }
    expect(outboundFiles([file])).toEqual([{ name: 'a.png', type: 'image/png', size: 3, data_url: 'data:image/png;base64,AAA=' }])
  })
})

describe('errors', () => {
  test.each([
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid'],
    [503, 'unavailable'],
  ])('a refusal with HTTP %i keeps the backend kind and message', async (status, kind) => {
    fakeFetch({ 'GET /api/agent/status/r1': { status, body: { error: { kind, message: `Refused as ${kind}.` } } } })
    const error = await runs.getRun('r1').catch((e) => e)
    expect(error).toBeInstanceOf(DataError)
    expect(error).toMatchObject({ area: 'runs', kind, message: `Refused as ${kind}.` })
  })

  test('conflict: the operation rejects with the backend message', async () => {
    const message = 'The run is running; confirming or rejecting is possible only when it is awaiting_confirmation.'
    fakeFetch({ 'POST /api/agent/confirm-resolution/r1': { status: 409, body: { error: { kind: 'conflict', message } } } })
    await expect(runs.confirmResolution('r1', { confirmed: true })).rejects.toMatchObject({ kind: 'conflict', message })
  })

  test.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'invalid'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('HTTP %i without an error body maps to %s', async (status, kind) => {
    fakeFetch({ 'GET /api/agent/runs': { status, body: '<html>proxy error</html>' } })
    await expect(runs.listActiveRuns()).rejects.toMatchObject({ kind, message: `The backend answered HTTP ${status}.` })
  })

  test('a network failure is unavailable', async () => {
    fakeFetch({ 'GET /api/incidents': { reject: new TypeError('Failed to fetch') } })
    await expect(incidents.listIncidents({})).rejects.toMatchObject({
      area: 'incidents',
      kind: 'unavailable',
      message: 'The backend cannot be reached.',
    })
  })

  test('a backend that does not answer times out as unavailable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    const pending = system.getHealth().catch((e) => e)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(await pending).toMatchObject({ kind: 'unavailable', message: 'The backend did not answer within 15 s.' })
  })
})

describe('operations served by the backend', () => {
  const RUN = {
    run_id: 'r1', incident_id: 4, machine_id: 'urn:ngsi-ld:Machine:press-01', issue: 'Noise', status: 'awaiting_input',
    started_at: '2026-11-05T10:00:00+00:00', updated_at: '2026-11-05T10:01:00+00:00', escalation_ref: null,
  }

  test.each([
    ['listActiveRuns', [], 'GET /api/agent/runs', undefined, [RUN], [{ runId: 'r1', incidentId: 4, escalationRef: null }]],
    ['startRun', [{ machineId: 'press-01', issue: 'Noise' }], 'POST /api/agent/run', { machine_id: 'press-01', issue: 'Noise' }, { run_id: 'r1' }, { runId: 'r1' }],
    ['getRun', ['r/1'], 'GET /api/agent/status/r%2F1', undefined, { ...RUN, data: { question: 'When?' }, steps: [] }, { data: { question: 'When?' } }],
    ['clarify', ['r1', { text: 'Since Monday', files: [{ name: 'a.txt', type: 'text/plain', size: 1, dataUrl: 'data:,a' }] }], 'POST /api/agent/clarify/r1',
      { text: 'Since Monday', files: [{ name: 'a.txt', type: 'text/plain', size: 1, data_url: 'data:,a' }] }, { status: 'running' }, { status: 'running' }],
    ['confirmResolution', ['r1', { confirmed: false, text: 'Bearing was replaced last week' }], 'POST /api/agent/confirm-resolution/r1',
      { confirmed: false, text: 'Bearing was replaced last week', files: [] }, { status: 'running' }, { status: 'running' }],
    ['escalationPreflight', ['r1'], 'GET /api/agent/escalate-preflight/r1', undefined,
      { possible: false, reason: 'Not available.', recipient: null, data: [], sharing_tier: 'minimal' }, { possible: false, sharingTier: 'minimal' }],
    ['stopRun', ['r1'], 'POST /api/agent/stop/r1', { reason: null }, { status: 'stopped' }, { status: 'stopped' }],
  ])('runs.%s', async (op, args, key, body, answer, expected) => {
    const fetch = fakeFetch({ [key]: { body: answer } })
    const result = await runs[op](...args)
    expect(fetch.calls).toEqual([{ key, search: '', body }])
    expect(result).toMatchObject(expected)
  })

  test('runs.archiveRun resolves with nothing on 204', async () => {
    const fetch = fakeFetch({ 'POST /api/agent/archive/r1': { status: 204 } })
    await expect(runs.archiveRun('r1')).resolves.toBeUndefined()
    expect(fetch.calls[0].key).toBe('POST /api/agent/archive/r1')
  })

  test('runs.reopenRun reports the backend conflict', async () => {
    fakeFetch({ 'POST /api/agent/reopen/r1': { status: 409, body: { error: { kind: 'conflict', message: 'Not reopenable.' } } } })
    await expect(runs.reopenRun('r1')).rejects.toMatchObject({ kind: 'conflict', message: 'Not reopenable.' })
  })

  test('incidents.listIncidents sends the filters', async () => {
    const fetch = fakeFetch({ 'GET /api/incidents': { body: [{ id: '3', machine_id: 'm', reopened_run_id: null }] } })
    const list = await incidents.listIncidents({ machineId: 'urn:m', status: ['completed', 'stopped'], from: '2026-11-01', to: '2026-11-03' })
    expect(Object.fromEntries(new URLSearchParams(fetch.calls[0].search))).toEqual({
      machine_id: 'urn:m', status: 'completed,stopped', from: '2026-11-01', to: '2026-11-03',
    })
    expect(list).toEqual([{ id: '3', machineId: 'm', reopenedRunId: null }])
    await incidents.listIncidents({ status: 'failed' })
    await incidents.listIncidents()
    expect(fetch.calls.slice(1).map((c) => c.search)).toEqual(['?status=failed', ''])
  })

  test('incidents.getIncident and reopenIncident', async () => {
    fakeFetch({
      'GET /api/incidents/3': { body: { id: '3', trace: [{ node: 'act', output: { incident_logged: true } }] } },
      'POST /api/incidents/3/reopen': { status: 202, body: { run_id: 'r9' } },
    })
    expect(await incidents.getIncident('3')).toEqual({ id: '3', trace: [{ node: 'act', output: { incidentLogged: true } }] })
    expect(await incidents.reopenIncident('3')).toEqual({ runId: 'r9' })
  })

  test('session: an unreachable backend at load leaves the app open, and a later failure stays a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))
    expect(await backend.session.getAuthConfig()).toEqual({ enabled: false, provider: 'Keycloak', backendUnreachable: true })
    expect((await backend.session.getSession()).valid).toBe(false)

    fakeFetch({ 'GET /api/auth/config': { body: { enabled: true, provider: 'Keycloak' } } })
    expect((await backend.session.getAuthConfig()).enabled).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))
    await expect(backend.session.getSession()).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(backend.session.getAuthConfig()).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(backend.session.getSession()).rejects.toMatchObject({ kind: 'unavailable' })
  })

  test('session: wrong credentials stay unauthorized', async () => {
    fakeFetch({ 'POST /api/auth/connect': { status: 401, body: { error: { kind: 'unauthorized', message: 'No.' } } } })
    await expect(backend.session.signIn({ username: 'a', password: 'b' })).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  test('system.getHealth, fresh or cached', async () => {
    const fetch = fakeFetch({
      'GET /api/diagnostics': { body: { overall: 'ok', checked_at: '2026-11-05T10:00:00+00:00', checks: [{ id: 'memory', latency_ms: 3 }] } },
    })
    expect(await system.getHealth()).toEqual({ overall: 'ok', checkedAt: '2026-11-05T10:00:00+00:00', checks: [{ id: 'memory', latencyMs: 3 }] })
    await system.getHealth({ fresh: true })
    expect(fetch.calls.map((c) => c.search)).toEqual(['', '?fresh=true'])
  })
})

describe('delegation to the mock', () => {
  test('the backend serves runs, incidents, entities and health; the mock serves everything else', () => {
    expect(backend.SERVED).toEqual({
      session: ['getAuthConfig', 'getSession', 'signIn', 'signOut'],
      runs: ['listActiveRuns', 'startRun', 'getRun', 'subscribeRun', 'clarify', 'confirmResolution', 'escalationPreflight', 'reopenRun', 'stopRun', 'archiveRun'],
      incidents: ['listIncidents', 'getIncident', 'reopenIncident'],
      entities: [
        'getStats', 'listTypes', 'listAttributes', 'queryEntities', 'getEntity', 'updateAttributes', 'appendAttributes',
        'deleteAttribute', 'deleteEntity', 'importEntities', 'fetchImportDocument', 'deleteByTypes',
        'getAttributeHistory', 'getAttributeStatus', 'listTypesAt', 'queryEntitiesAt',
      ],
      system: ['getHealth'],
    })
    for (const name of ['alerts', 'dataspace']) expect(backend[name]).toEqual(mock[name])
    expect(backend.entities.getValueHints).toBe(mock.entities.getValueHints)
    expect(backend.session.getFactory).toBe(mock.session.getFactory)
    expect(backend.session.signIn).not.toBe(mock.session.signIn)
    expect(backend.info.signInHint).toBeUndefined()
    expect(backend.runs.escalate).toBe(mock.runs.escalate)
    expect(backend.runs.sendConversationAct).toBe(mock.runs.sendConversationAct)
    expect(backend.system.getServiceSettings).toBe(mock.system.getServiceSettings)
    expect(backend.runs.startRun).not.toBe(mock.runs.startRun)
  })

  test('delegated operations work without a backend', async () => {
    mock.store.reset()
    fakeFetch({})
    const stats = await bindArea('alerts', backend.alerts).countAlerts({})
    expect(stats).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('entities', () => {
  const entities = bindArea('entities', backend.entities)

  test('attribute names reach the screen exactly as the broker gave them', async () => {
    const entity = { id: 'urn:m', type: 'T', max_temp: { type: 'Property', value: 1, sub_attr: { type: 'Property', value: 2 } }, 'https://x.example/a_b': { type: 'Property', value: 3 } }
    fakeFetch({ 'GET /api/ngsi/entities/urn%3Am': { body: entity }, 'GET /api/ngsi/entities': { body: [entity] } })
    expect(await entities.getEntity('urn:m')).toEqual(entity)
    expect(await entities.queryEntities({ type: 'T' })).toEqual([entity])
  })

  test('edits send attribute names unchanged, to the entity encoded as one path segment', async () => {
    const fn = fakeFetch({ 'PATCH /api/ngsi/entities/urn%3Am%2Fx/attrs': { status: 204 } })
    await entities.updateAttributes('urn:m/x', { maxTemp_a: { value: 1 } })
    expect(fn.calls[0].body).toEqual({ maxTemp_a: { value: 1 } })
  })

  test('query parameters', async () => {
    const fn = fakeFetch({ 'GET /api/ngsi/entities': { body: [] }, 'GET /api/ngsi/timeshift/entities': { body: [] } })
    await entities.queryEntities({ type: 'T', idPattern: 'urn:.*', q: 'a==1', limit: 5 })
    expect(new URLSearchParams(fn.calls[0].search).get('id_pattern')).toBe('urn:.*')
    await entities.queryEntitiesAt('2026-01-01T00:00:00Z', { type: 'T' })
    expect(new URLSearchParams(fn.calls[1].search).get('at')).toBe('2026-01-01T00:00:00Z')
  })

  test('deleting names the attribute as a parameter, as it may be an IRI', async () => {
    const fn = fakeFetch({ 'DELETE /api/ngsi/entities/urn%3Am/attrs': { status: 204 } })
    await entities.deleteAttribute('urn:m', 'https://x.example/a', { subAttribute: 'https://x.example/b' })
    const params = new URLSearchParams(fn.calls[0].search)
    expect(params.get('name')).toBe('https://x.example/a')
    expect(params.get('sub_attribute')).toBe('https://x.example/b')
  })

  test('a partial import (207) is a result, not an error', async () => {
    const rows = [{ id: 'urn:a', result: 'failed', reason: 'no' }, { id: 'urn:b', result: 'created', reason: null }]
    fakeFetch({ 'POST /api/ngsi/import': { status: 207, body: rows } })
    expect(await entities.importEntities([{}, {}])).toEqual(rows)
  })

  test('a stopped service keeps the backend kind and message', async () => {
    fakeFetch({ 'GET /api/ngsi/history': { status: 502, body: { error: { kind: 'unavailable', message: 'The history service (PostgREST) cannot be reached (ConnectError).' } } } })
    await expect(entities.getAttributeHistory('urn:a', 'b')).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('PostgREST') })
  })
})

// ── Run stream ────────────────────────────────────────────────────────────

class FakeSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.closed = false
    FakeSocket.instances.push(this)
  }
  close() {
    this.closed = true
  }
  receive(event) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

describe('run stream', () => {
  let events
  const SNAPSHOT = { type: 'snapshot', run: { run_id: 'r1', status: 'running', steps: [] } }

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    events = []
  })

  const socket = () => FakeSocket.instances.at(-1)
  const subscribe = () => backend.runs.subscribeRun('r1', (e) => events.push(e))

  test('opens the run stream on the page host and forwards snapshot, steps and status in order', () => {
    subscribe()
    expect(socket().url).toBe(`ws://${location.host}/ws/run/r1`)
    socket().receive(SNAPSHOT)
    socket().receive({ type: 'step', node: 'observe', input: {}, output: { machine_found: true }, at: '2026-11-05T10:00:00Z', round: 1 })
    socket().receive({ type: 'keepalive', at: '2026-11-05T10:00:20Z' })
    socket().receive({ type: 'status', status: 'awaiting_input', data: { question: 'When?' }, summary: { incident_id: 5 } })
    expect(events).toEqual([
      { type: 'snapshot', run: { runId: 'r1', status: 'running', steps: [] } },
      { type: 'step', node: 'observe', input: {}, output: { machineFound: true }, at: '2026-11-05T10:00:00Z', round: 1 },
      { type: 'status', status: 'awaiting_input', data: { question: 'When?' }, summary: { incidentId: 5 } },
    ])
  })

  test('a dropped connection reports reconnecting and recovers with a fresh snapshot', () => {
    subscribe()
    socket().receive(SNAPSHOT)
    socket().drop()
    expect(events.at(-1)).toEqual({ type: 'connection', state: 'reconnecting' })
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
    expect(FakeSocket.instances).toHaveLength(2)
    socket().receive({ type: 'snapshot', run: { run_id: 'r1', status: 'awaiting_input', steps: [{ node: 'observe' }] } })
    expect(events.at(-1)).toEqual({ type: 'snapshot', run: { runId: 'r1', status: 'awaiting_input', steps: [{ node: 'observe' }] } })
  })

  test('reconnects with increasing delays while the backend is away, then resets them', () => {
    subscribe()
    socket().receive(SNAPSHOT)
    const waits = []
    for (let i = 0; i < 7; i++) {
      const before = FakeSocket.instances.length
      socket().drop()
      let waited = 0
      while (FakeSocket.instances.length === before) {
        vi.advanceTimersByTime(100)
        waited += 100
      }
      waits.push(waited)
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000])
    socket().receive(SNAPSHOT)
    socket().drop()
    vi.advanceTimersByTime(500)
    expect(FakeSocket.instances).toHaveLength(9)
  })

  test('an archived run ends the stream with not_found and no reconnect', () => {
    subscribe()
    socket().receive(SNAPSHOT)
    socket().receive({ type: 'error', error: { kind: 'not_found', message: 'Run r1 was archived.' } })
    socket().drop(4404)
    expect(events.at(-1)).toEqual({ type: 'error', error: expect.objectContaining({ kind: 'not_found', message: 'Run r1 was archived.' }) })
    expect(events.at(-1).error).toBeInstanceOf(DataError)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  test('close code 4404 alone also ends the stream as not_found', () => {
    subscribe()
    socket().drop(4404)
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'not_found' }) }])
  })

  test('a stream that never opens reports unavailable instead of waiting forever', () => {
    subscribe()
    socket().drop(1006)
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'unavailable' }) }])
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  test('unsubscribe closes the socket and cancels a pending reconnect', () => {
    const unsubscribe = subscribe()
    socket().receive(SNAPSHOT)
    socket().drop()
    unsubscribe()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
    const again = subscribe()
    again()
    expect(socket().closed).toBe(true)
  })
})
