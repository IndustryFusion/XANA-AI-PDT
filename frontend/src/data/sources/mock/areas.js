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
import { urn } from './catalog'
import { AGENT_ANSWER_MS, createRunRecord, FINISHED_STATES, incidentFromRun, preflight, summarize } from './runCore'
import { createRunEngine } from './runEngine'
import { createAlertsArea } from './alertsArea'
import { createEntitiesArea } from './entitiesArea'
import { createDataspaceArea } from './dataspaceArea'
import { createKnowledgeBaseArea } from './knowledgeBaseArea'
import { createSystemArea } from './systemArea'

/** Mock credentials, shown as a hint on the sign-in screen. */
export const MOCK_CREDENTIALS = { username: 'operator', password: 'operator' }

/** Builds the mock implementations of the interface areas on top of a store. */
export function createAreas(store) {
  const withControls = (area, fn) => async (...args) => {
    await applyControls(area)
    return fn(...args)
  }

  function sessionResult() {
    const state = store.get()
    const { authEnabled, sessionRevision } = currentControls()
    const valid = !authEnabled || (state.session.signedIn && state.session.revision === sessionRevision)
    return {
      valid,
      user: valid ? { ...state.user } : null,
      factoryId: valid ? state.factory.id : null,
      companyId: valid ? state.companyId : null,
    }
  }

  const session = {
    getAuthConfig: withControls('session', () => ({
      enabled: currentControls().authEnabled,
      provider: 'Mock identity provider',
    })),
    getSession: withControls('session', sessionResult),
    signIn: withControls('session', ({ username, password } = {}) => {
      if (username !== MOCK_CREDENTIALS.username || password !== MOCK_CREDENTIALS.password) {
        throw new DataError('session', 'unauthorized', 'Username or password is not correct.')
      }
      store.update((s) => { s.session = { signedIn: true, revision: currentControls().sessionRevision }; return s })
      return sessionResult()
    }),
    signOut: withControls('session', () => {
      store.update((s) => { s.session.signedIn = false; return s })
    }),
    getFactory: withControls('session', () => structuredClone(store.get().factory)),
  }

  const { area: dataspace, connectionState } = createDataspaceArea(store)
  const speed = () => Number(currentControls().speed) || 1
  const engine = createRunEngine(store, { speed, connected: () => connectionState() === 'connected' })
  store.onReset?.(() => engine.reset())

  const notFound = (area, what) => new DataError(area, 'not_found', what)
  const findRun = (runId) => store.get().runs.find((r) => r.runId === runId)
  const requireRun = (runId) => findRun(runId) ?? (() => { throw notFound('runs', `Run ${runId} is not active.`) })()
  const action = (name) => withControls('runs', (runId, args) => engine.perform(runId, name, args))

  /** Accepts a full entity ID or the short machine name (e.g. `press-brake-02`). */
  function machineEntity(machineId) {
    const raw = String(machineId ?? '').trim()
    if (!raw) throw new DataError('runs', 'invalid', 'Enter a machine ID.')
    const id = raw.startsWith('urn:') ? raw : urn('Machine', raw)
    if (!store.get().entities.some((e) => e.id === id && e.type === 'Machine')) {
      throw new DataError('runs', 'invalid', `No machine with the ID ${raw} is known in this factory.`)
    }
    return id
  }

  const runs = {
    listActiveRuns: withControls('runs', () => {
      engine.ensureAll()
      return store.get().runs.map(summarize).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    }),
    startRun: withControls('runs', ({ machineId, issue } = {}) => {
      const id = machineEntity(machineId)
      if (!String(issue ?? '').trim()) throw new DataError('runs', 'invalid', 'Describe the issue.')
      let runId
      store.update((s) => { runId = `run-${s.counters.run++}`; return s })
      engine.add(createRunRecord({ runId, machineId: id, issue: issue.trim(), scenario: currentControls().scenario, at: new Date().toISOString() }))
      return { runId }
    }),
    getRun: withControls('runs', (runId) => {
      requireRun(runId)
      engine.ensure(runId)
      return engine.snapshot(runId)
    }),
    subscribeRun(runId, onEvent) {
      let closed = false
      let unsubscribe = null
      applyControls('runs').then(() => {
        if (closed) return
        const run = engine.snapshot(runId)
        if (!run) {
          onEvent({ type: 'error', error: notFound('runs', `Run ${runId} is not active.`) })
          return
        }
        onEvent(engine.isInterrupted(runId) ? { type: 'connection', state: 'reconnecting' } : { type: 'snapshot', run })
        unsubscribe = engine.subscribe(runId, onEvent)
      }, (error) => { if (!closed) onEvent({ type: 'error', error }) })
      return () => {
        closed = true
        unsubscribe?.()
      }
    },
    clarify: action('clarify'),
    confirmResolution: action('confirmResolution'),
    escalationPreflight: withControls('runs', (runId) => {
      const run = requireRun(runId)
      return preflight(run, { state: store.get(), connected: connectionState() === 'connected' })
    }),
    escalate: action('escalate'),
    approveDataRequest: action('approveDataRequest'),
    replyToRecommendation: action('replyToRecommendation'),
    sendConversationAct: action('sendConversationAct'),
    askAgent: withControls('runs', async (runId, message) => {
      engine.perform(runId, 'askQuestion', { message })
      await new Promise((resolve) => setTimeout(resolve, AGENT_ANSWER_MS / speed()))
      return engine.perform(runId, 'answerQuestion')
    }),
    getOutboxStatus: withControls('runs', (runId) => structuredClone(requireRun(runId).outbox)),
    refreshConversationStatus: action('refreshConversationStatus'),
    recordMachineBuilderClose: action('recordMachineBuilderClose'),
    reopenRun: action('reopenRun'),
    stopRun: action('stopRun'),
    archiveRun: withControls('runs', (runId) => {
      const run = requireRun(runId)
      if (!FINISHED_STATES.includes(run.status)) {
        throw new DataError('runs', 'conflict', 'Only finished runs can be archived; stop the run first.')
      }
      store.update((s) => {
        const record = s.runs.find((r) => r.runId === runId)
        if (record.incidentId == null) record.incidentId = s.counters.incident++
        const incident = incidentFromRun(record, new Date().toISOString())
        s.incidents = [incident, ...s.incidents.filter((i) => i.id !== incident.id)]
        s.runs = s.runs.filter((r) => r.runId !== runId)
        return s
      })
      engine.remove(runId)
    }),
  }

  const incidentSummary = ({ id, number, machineId, issue, outcome, rootCause, escalated, escalationRef, startedAt, closedAt, reopenedRunId }) =>
    ({ id, number, machineId, issue, outcome, rootCause, escalated, escalationRef, startedAt, closedAt, reopenedRunId })

  const dayStart = (d) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).getTime() : -Infinity)
  const dayEnd = (d) => (d ? new Date(`${d.slice(0, 10)}T23:59:59.999`).getTime() : Infinity)

  const incidents = {
    listIncidents: withControls('incidents', ({ machineId, status, from, to } = {}) => {
      const outcomes = status ? [].concat(status) : null
      return store.get().incidents
        .filter((i) => !machineId || i.machineId === machineId)
        .filter((i) => !outcomes || outcomes.includes(i.outcome))
        .filter((i) => { const t = Date.parse(i.closedAt); return t >= dayStart(from) && t <= dayEnd(to) })
        .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
        .map(incidentSummary)
    }),
    getIncident: withControls('incidents', (id) => {
      const incident = store.get().incidents.find((i) => i.id === String(id))
      if (!incident) throw notFound('incidents', `Incident ${id} does not exist.`)
      return structuredClone(incident)
    }),
    reopenIncident: withControls('incidents', (id) => {
      const incident = store.get().incidents.find((i) => i.id === String(id))
      if (!incident) throw notFound('incidents', `Incident ${id} does not exist.`)
      if (incident.reopenedRunId && findRun(incident.reopenedRunId)) {
        throw new DataError('incidents', 'conflict', `Incident ${id} is already open again as ${incident.reopenedRunId}.`)
      }
      let runId
      store.update((s) => {
        runId = `run-${s.counters.run++}`
        s.incidents.find((i) => i.id === incident.id).reopenedRunId = runId
        return s
      })
      const at = new Date().toISOString()
      const run = createRunRecord({ runId, machineId: incident.machineId, issue: incident.issue, scenario: currentControls().scenario, at, incidentId: incident.number })
      run.steps = structuredClone(incident.trace)
      run.reopenedFrom = incident.id
      if (incident.escalated) {
        Object.assign(run, { escalation: structuredClone(incident.escalation), escalationRef: incident.escalationRef, status: 'stopped', data: { reopenable: true }, queue: [] })
        engine.add(run)
        engine.perform(runId, 'reopenRun')
      } else {
        engine.add(run)
      }
      return { runId }
    }),
  }

  const { raiseAlert, ...alerts } = createAlertsArea(store)
  const baseEntities = createEntitiesArea(store)

  const entities = {
    ...baseEntities,
    getStats: withControls('entities', () => {
      const counts = {}
      for (const e of store.get().entities) counts[e.type] = (counts[e.type] ?? 0) + 1
      const byType = Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      return { entityCount: store.get().entities.length, typeCount: byType.length, byType }
    }),
  }

  const knowledgeBase = createKnowledgeBaseArea(store)
  const system = createSystemArea(store, { connectionState })

  return { session, runs, incidents, alerts, entities, dataspace, knowledgeBase, system, engine, raiseAlert }
}
