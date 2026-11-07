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
import { bindArea, DataError, OPERATIONS } from '../../src/data'
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
    return new Response(route.status === 204 ? null : text, { status: route.status ?? 200, headers: route.headers })
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

describe('without the mock', () => {
  test('what the backend serves', () => {
    expect(backend.SERVED).toEqual({
      session: ['getAuthConfig', 'getSession', 'signIn', 'signOut', 'getFactory'],
      runs: ['listActiveRuns', 'startRun', 'getRun', 'subscribeRun', 'clarify', 'confirmResolution', 'escalationPreflight', 'escalate', 'getOutboxStatus', 'sendConversationAct', 'askAgent', 'approveDataRequest', 'replyToRecommendation', 'refreshConversationStatus', 'recordMachineBuilderClose', 'reopenRun', 'stopRun', 'archiveRun'],
      incidents: ['listIncidents', 'getIncident', 'reopenIncident'],
      entities: [
        'getStats', 'listTypes', 'listAttributes', 'queryEntities', 'getEntity', 'updateAttributes', 'appendAttributes',
        'deleteAttribute', 'deleteEntity', 'importEntities', 'fetchImportDocument', 'deleteByTypes',
        'getAttributeHistory', 'getAttributeStatus', 'listTypesAt', 'queryEntitiesAt', 'subscribeEntities', 'getLiveUpdateHealth', 'getValueHints',
      ],
      alerts: ['listAlerts', 'countAlerts', 'getAlert', 'applyAlertAction', 'listEnvironments', 'listServices', 'getAlertSettings'],
      dataspace: ['getConnection', 'connect', 'disconnect', 'listPeers', 'getPeerCapabilities', 'listCapabilityRequests', 'decideCapabilityRequest', 'setCapabilityPolicy', 'resolveNames', 'resolveBuilders'],
      system: ['getHealth', 'getServiceSettings', 'saveServiceSettings'],
    })
    expect(backend.info.signInHint).toBeUndefined()
    expect(backend.session.signIn).not.toBe(mock.session.signIn)
    expect(backend.runs.startRun).not.toBe(mock.runs.startRun)
  })

  test('every operation of the interface is served, none by the mock', () => {
    const expected = Object.fromEntries(Object.entries(OPERATIONS).filter(([area]) => area !== 'knowledgeBase').map(([area, ops]) => [area, [...ops].sort()]))
    const served = Object.fromEntries(Object.entries(backend.SERVED).map(([area, ops]) => [area, [...ops].sort()]))
    expect(served).toEqual(expected)
    for (const [area, ops] of Object.entries(backend.SERVED)) {
      for (const op of ops) expect(backend[area][op], `${area}.${op}`).not.toBe(mock[area][op])
    }
  })

  test('nothing in the backend source imports the mock source', () => {
    const files = Object.entries(import.meta.glob('../../src/data/sources/backend/*.js', { query: '?raw', import: 'default', eager: true }))
    expect(files.length).toBeGreaterThan(5)
    for (const [file, text] of files) expect(text, file).not.toMatch(/from\s+['"][^'"]*mock/)
  })

  test('no knowledge base and no development controls', async () => {
    expect(backend.knowledgeBase).toBeUndefined()
    expect(backend.DevControls).toBeUndefined()
    await expect(bindArea('system', { ...backend.system, getHealth: undefined }).getHealth()).rejects.toMatchObject({ kind: 'unavailable' })
  })

  test('service settings come from the backend, read-only', async () => {
    fakeFetch({ 'GET /api/config': { status: 200, body: [{ key: 'context_broker', label: 'Context broker', value: 'http://b', deployment_value: 'http://b', changed: false, editable: false }] } })
    const system = bindArea('system', backend.system)
    const [setting] = await system.getServiceSettings()
    expect(setting).toMatchObject({ key: 'context_broker', deploymentValue: 'http://b', editable: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(system.saveServiceSettings({ context_broker: 'http://other' })).rejects.toMatchObject({ kind: 'conflict' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('a decision names what the operator looked at', () => {
  const body = () => JSON.parse(fetch.mock.calls.at(-1)[1].body)

  test('a data request', async () => {
    fakeFetch({ 'POST /api/agent/approve-data-request/r': { status: 200, body: { status: 'awaiting_machine_builder' } } })
    await bindArea('runs', backend.runs).approveDataRequest('r', { approved: true, note: 'n', requestId: 'm-1' })
    expect(body()).toEqual({ approved: true, note: 'n', request_id: 'm-1' })
  })

  test('a recommendation', async () => {
    fakeFetch({ 'POST /api/agent/recommendation-reply/r': { status: 200, body: { status: 'completed' } } })
    await bindArea('runs', backend.runs).replyToRecommendation('r', { action: 'resolved', recommendationId: 'm-2' })
    expect(body()).toEqual({ action: 'resolved', message: '', recommendation_id: 'm-2' })
  })
})

describe('dataspace', () => {
  const dataspace = bindArea('dataspace', backend.dataspace)
  const lastCall = () => {
    const [url, options] = fetch.mock.calls.at(-1)
    return { url, method: options.method, body: options.body && JSON.parse(options.body) }
  }

  test('a policy is sent in the gateway\'s words', async () => {
    for (const [action, sent] of [['grant', 'approve'], ['deny', 'deny'], ['reset', 'reset']]) {
      fakeFetch({ 'POST /api/gateway/capabilities/policy': { status: 200, body: { status: 'default' } } })
      await dataspace.setCapabilityPolicy({ peerId: 'urn:p', capability: 'twin:history', action })
      expect(lastCall().body).toEqual({ consumer_id: 'urn:p', capability: 'twin:history', action: sent })
    }
  })

  test('an unknown policy action is refused without a request', async () => {
    fakeFetch({})
    await expect(dataspace.setCapabilityPolicy({ peerId: 'p', capability: 'c', action: 'maybe' })).rejects.toMatchObject({ kind: 'invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('a decision is sent as approve or deny, with a peer identifier encoded', async () => {
    fakeFetch({
      'PATCH /api/gateway/capabilities/requests/a%2Fb': { status: 200, body: { id: 'a/b', status: 'denied' } },
    })
    await dataspace.decideCapabilityRequest('a/b', { approved: false, note: 'No' })
    expect(lastCall().body).toEqual({ action: 'deny', note: 'No' })
  })

  test('answers keyed by an identifier keep the identifier', async () => {
    fakeFetch({
      'POST /api/ifric/resolve': { status: 200, body: { urn_with_under_score: 'Name' } },
      'POST /api/ifric/resolve-builders': { status: 200, body: { machine_1_a: 'Builder' } },
    })
    expect(await dataspace.resolveNames(['urn_with_under_score'])).toEqual({ urn_with_under_score: 'Name' })
    expect(lastCall().body).toEqual({ ids: ['urn_with_under_score'] })
    expect(await dataspace.resolveBuilders(['machine_1_a'])).toEqual({ machine_1_a: 'Builder' })
    expect(lastCall().body).toEqual({ machine_ids: ['machine_1_a'] })
  })

  test('connecting without a secret sends none, and a refusal keeps its kind', async () => {
    fakeFetch({
      'POST /api/gateway/connect': { status: 401, body: { error: { kind: 'unauthorized', message: 'The dataspace rejected the credential.' } } },
    })
    await expect(dataspace.connect()).rejects.toMatchObject({ kind: 'unauthorized', message: 'The dataspace rejected the credential.' })
    expect(lastCall().body).toEqual({ secret: null })
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

  test('paging, attributes and has-attribute go to the backend, and the total comes back', async () => {
    const fn = fakeFetch({ 'GET /api/ngsi/entities': { body: [{ id: 'urn:a', type: 'T' }], headers: { 'X-Total-Count': '23' } } })
    const found = await entities.queryEntities({ type: 'T', limit: 5, offset: 10, attrs: 'a,b', hasAttr: 'c' })
    const params = new URLSearchParams(fn.calls[0].search)
    expect([params.get('offset'), params.get('attrs'), params.get('has_attr'), params.get('limit')]).toEqual(['10', 'a,b', 'c', '5'])
    expect(found.total).toBe(23)
  })

  test('without a total header there is no total', async () => {
    fakeFetch({ 'GET /api/ngsi/entities': { body: [] } })
    expect((await entities.queryEntities({ type: 'T' })).total).toBeUndefined()
  })

  test('the past keeps its limit: no paging or attributes are sent', async () => {
    const fn = fakeFetch({ 'GET /api/ngsi/timeshift/entities': { body: [] } })
    await entities.queryEntitiesAt('2026-01-01T00:00:00Z', { type: 'T', offset: 10, attrs: 'a', hasAttr: 'c' })
    const params = new URLSearchParams(fn.calls[0].search)
    expect([params.get('offset'), params.get('attrs'), params.get('has_attr')]).toEqual([null, null, null])
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

describe('alerts', () => {
  const alerts = bindArea('alerts', backend.alerts)

  test('filters go as parameters, and keys under attributes stay', async () => {
    const answer = { alerts: [{ id: 'a', attributes: { ip_address: 'x' } }], total: 1, bySeverity: { major: 1 }, page: 1, pageSize: 50 }
    const fn = fakeFetch({ 'GET /api/alerta/alerts': { body: answer } })
    expect(await alerts.listAlerts({ status: ['open', 'ack'], severity: 'major', text: 'urn:x', pageSize: 50 })).toEqual(answer)
    const params = new URLSearchParams(fn.calls[0].search)
    expect(params.get('status')).toBe('open,ack')
    expect(params.get('text')).toBe('urn:x')
    expect(params.get('page_size')).toBe('50')
  })

  test('an action goes to the alert, and a conflict keeps its message', async () => {
    const fn = fakeFetch({ 'PUT /api/alerta/alert/a%2Fb/action': { status: 409, body: { error: { kind: 'conflict', message: 'alert is already in ack status' } } } })
    await expect(alerts.applyAlertAction('a/b', { action: 'ack', text: 'n' })).rejects.toMatchObject({ kind: 'conflict', message: 'alert is already in ack status' })
    expect(fn.calls[0].body).toEqual({ action: 'ack', text: 'n' })
  })

  test('the refresh interval comes from the backend', async () => {
    fakeFetch({ 'GET /api/alerta/config': { body: { refresh_interval_s: 45 } } })
    expect(await alerts.getAlertSettings()).toEqual({ refreshIntervalS: 45 })
  })
})

describe('live updates', () => {
  class Socket {
    static last = null
    constructor(url) { this.url = url; this.closed = false; Socket.last = this }
    close() { this.closed = true; this.onclose?.({ code: 1000 }) }
    receive(message) { this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) }) }
  }
  const entities = bindArea('entities', backend.entities)
  beforeEach(() => vi.stubGlobal('WebSocket', Socket))

  test('a change becomes an update event, with attribute names unchanged', () => {
    const events = []
    entities.subscribeEntities({ ids: ['urn:a', 'urn:b'] }, (e) => events.push(e))
    expect(decodeURIComponent(Socket.last.url)).toContain('/api/ngsi/ws?ids=urn:a,urn:b')
    Socket.last.receive({ type: 'keepalive' })
    Socket.last.receive('not json')
    Socket.last.receive({ type: 'update', entity_id: 'urn:a', attributes: { max_temp: { value: 1 } } })
    expect(events).toEqual([{ type: 'update', entityId: 'urn:a', attributes: { max_temp: { value: 1 } } }])
  })

  test('a lost stream gives one error event, and then nothing', () => {
    const events = []
    entities.subscribeEntities({}, (e) => events.push(e))
    Socket.last.onerror({})
    Socket.last.onclose({ code: 1006 })
    Socket.last.receive({ type: 'update', entity_id: 'urn:a', attributes: {} })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'unavailable' } })
  })

  test('unsubscribing closes the stream, with no events after it', () => {
    const events = []
    const stop = entities.subscribeEntities({ type: 'T' }, (e) => events.push(e))
    expect(Socket.last.url).toContain('type=T')
    stop()
    expect(Socket.last.closed).toBe(true)
    expect(events).toEqual([])
  })

  test('hints come from the backend, in interface terms', async () => {
    const fn = fakeFetch({ 'GET /api/shacl/hints': { body: { hint_type: 'range', values: [], minimum: 1, maximum: 2, minimum_exclusive: false, maximum_exclusive: true, datatype: null, detail: null } } })
    expect(await entities.getValueHints({ entityType: 'https://x/T', attribute: 'a' })).toMatchObject({ hintType: 'range', maximumExclusive: true })
    expect(new URLSearchParams(fn.calls[0].search).get('entity_type')).toBe('https://x/T')
  })

  test('health keeps the status and detail', async () => {
    fakeFetch({ 'GET /api/ngsi/subscription-health': { body: { status: 'unavailable', state: 'refused', detail: 'No role', expires_at: null } } })
    expect(await entities.getLiveUpdateHealth()).toMatchObject({ status: 'unavailable', detail: 'No role' })
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
