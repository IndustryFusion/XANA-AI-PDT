import { DataError } from '../../errors'
import { applyControls, currentControls } from './controls'

/** Mock implementation of the `system` area: dependency health and service settings. */

/** Service settings with their deployment values and the health check that uses each. */
export const SERVICE_SETTINGS = [
  { key: 'contextBroker', label: 'Context broker', value: 'http://context-broker.example.org:9090/ngsi-ld/v1', check: 'context-broker' },
  { key: 'timeseriesStore', label: 'Time-series store', value: 'https://timeseries.example.org:8443', check: 'timeseries' },
  { key: 'messageBroker', label: 'Message broker', value: 'mqtt://message-broker.example.org:1883', check: 'message-broker' },
  { key: 'alertManager', label: 'Alert manager', value: 'http://alert-manager.example.org:8080/api', check: 'alerts' },
]

export const URL_SCHEMES = ['http:', 'https:', 'ws:', 'wss:', 'mqtt:']

/** Why `value` is not an accepted service address, or null. */
export function addressProblem(value) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    return 'Not a valid URL.'
  }
  if (!URL_SCHEMES.includes(url.protocol)) return `Use one of ${URL_SCHEMES.map((s) => s.slice(0, -1)).join(', ')}.`
  if (!url.hostname) return 'The address has no host.'
  return null
}

/** Hosts under the reserved `.invalid` domain never answer, to demonstrate a failing dependency. */
const unreachable = (address) => {
  try { return new URL(address).hostname.endsWith('.invalid') } catch { return true }
}

export function createSystemArea(store, { connectionState }) {
  const withControls = (fn) => async (...args) => {
    await applyControls('system')
    return fn(...args)
  }

  function settings() {
    const overrides = store.get().settings
    return SERVICE_SETTINGS.map(({ key, label, value }) => ({
      key,
      label,
      value: overrides[key] ?? value,
      deploymentValue: value,
      changed: overrides[key] != null && overrides[key] !== value,
    }))
  }

  function check({ id, label, latencyMs }) {
    const { failure, gatewayReachable } = currentControls()
    const failed = (area) => (failure[area] ?? 'none') !== 'none'
    const setting = SERVICE_SETTINGS.find((s) => s.check === id)
    const address = setting ? settings().find((s) => s.key === setting.key).value : null
    const down = (detail) => ({ id, label, status: 'error', latencyMs: null, detail })
    if (address && unreachable(address)) return down(`No response from ${address}.`)
    if (id === 'context-broker' && failed('entities')) return down('Not reachable (simulated failure).')
    if (id === 'alerts' && failed('alerts')) return down('Not reachable (simulated failure).')
    if (id === 'knowledge-base' && failed('knowledgeBase')) return down('Not reachable (simulated failure).')
    if (id === 'gateway') {
      if (failed('dataspace') || !gatewayReachable) return down('Not reachable (simulated failure).')
      if (connectionState() === 'not_configured') return { id, label, status: 'unknown', latencyMs: null, detail: 'No dataspace connection is configured.' }
    }
    return { id, label, status: 'ok', latencyMs, detail: address ? `Reached at ${address}` : null }
  }

  return {
    getHealth: withControls(() => {
      const checks = store.get().health.map(check)
      const errors = checks.filter((c) => c.status === 'error').length
      return {
        overall: errors === 0 ? 'ok' : errors === checks.length ? 'error' : 'degraded',
        checkedAt: new Date().toISOString(),
        checks,
      }
    }),

    getServiceSettings: withControls(settings),

    saveServiceSettings: withControls((changes = {}) => {
      const problems = []
      for (const [key, value] of Object.entries(changes)) {
        const setting = SERVICE_SETTINGS.find((s) => s.key === key)
        if (!setting) problems.push(`${key} is not a service setting.`)
        else if (value != null && addressProblem(value)) problems.push(`${setting.label}: ${addressProblem(value)}`)
      }
      if (problems.length) throw new DataError('system', 'invalid', problems.join(' '))
      store.update((s) => {
        for (const [key, value] of Object.entries(changes)) {
          const deployment = SERVICE_SETTINGS.find((x) => x.key === key).value
          if (value == null || String(value).trim() === deployment) delete s.settings[key]
          else s.settings[key] = String(value).trim()
        }
        return s
      })
      return settings()
    }),
  }
}
