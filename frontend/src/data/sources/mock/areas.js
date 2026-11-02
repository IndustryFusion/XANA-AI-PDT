import { DataError } from '../../errors'
import { applyControls, currentControls } from './controls'

/** Mock credentials, shown as a hint on the sign-in screen. */
export const MOCK_CREDENTIALS = { username: 'operator', password: 'operator' }

const ACTIVE_ALERT_STATUSES = ['open', 'ack']

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

  const runs = {
    listActiveRuns: withControls('runs', () =>
      [...store.get().runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))),
  }

  const alerts = {
    countAlerts: withControls('alerts', ({ status = ACTIVE_ALERT_STATUSES } = {}) => {
      const wanted = new Set(status)
      const bySeverity = {}
      let total = 0
      for (const a of store.get().alerts) {
        if (!wanted.has(a.status)) continue
        bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1
        total++
      }
      return { total, bySeverity }
    }),
  }

  const entities = {
    getStats: withControls('entities', () => {
      const counts = {}
      for (const e of store.get().entities) counts[e.type] = (counts[e.type] ?? 0) + 1
      const byType = Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      return { entityCount: store.get().entities.length, typeCount: byType.length, byType }
    }),
  }

  const dataspace = {
    getConnection: withControls('dataspace', () => {
      const { connection } = store.get()
      const state = currentControls().connection ?? connection.state
      return {
        state,
        participantId: state === 'not_configured' ? null : connection.participantId,
        expiresAt: state === 'connected' ? connection.expiresAt : null,
      }
    }),
    listPeers: withControls('dataspace', () => {
      const state = currentControls().connection ?? store.get().connection.state
      if (state !== 'connected') throw new DataError('dataspace', 'unavailable', 'Not connected to the dataspace.')
      return structuredClone(store.get().peers)
    }),
  }

  const system = {
    getHealth: withControls('system', () => {
      const { failure } = currentControls()
      const failed = (id) => {
        if (id === 'gateway') return (failure.dataspace ?? 'none') !== 'none'
        if (id === 'context-broker') return (failure.entities ?? 'none') !== 'none'
        if (id === 'alerts') return (failure.alerts ?? 'none') !== 'none'
        return false
      }
      const checks = store.get().health.map(({ id, label, latencyMs }) => failed(id)
        ? { id, label, status: 'error', latencyMs: null, detail: 'Not reachable (simulated failure).' }
        : { id, label, status: 'ok', latencyMs, detail: null })
      const errors = checks.filter((c) => c.status === 'error').length
      return {
        overall: errors === 0 ? 'ok' : errors === checks.length ? 'error' : 'degraded',
        checkedAt: new Date().toISOString(),
        checks,
      }
    }),
  }

  return { session, runs, alerts, entities, dataspace, system }
}
