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
import { MACHINES } from './catalog'
import { ALERT_EVENTS, ALERT_ENVIRONMENTS, createAlert } from './seed'

/** Mock implementation of the `alerts` area: an in-browser alert manager. */

export const ACTIVE_ALERT_STATUSES = ['open', 'ack']
/** Severities from most to least severe (sort order of `listAlerts`). */
export const SEVERITY_RANK = ['critical', 'major', 'minor', 'warning', 'indeterminate', 'informational', 'normal', 'ok', 'cleared', 'debug', 'trace', 'unknown']
/** Base interval between occasionally raised alerts, divided by the playback speed. */
export const NEW_ALERT_MS = 60_000
const PAGE_SIZE = 50

/** Allowed actions: the statuses each applies to and the resulting status. */
export const ACTION_RULES = {
  ack: { from: ['open'], to: 'ack', label: 'acknowledged' },
  unack: { from: ['ack'], to: 'open', label: 'unacknowledged' },
  shelve: { from: ['open', 'ack'], to: 'shelved', label: 'shelved' },
  unshelve: { from: ['shelved'], to: 'open', label: 'unshelved' },
  close: { from: ['open', 'ack', 'shelved'], to: 'closed', label: 'closed' },
  open: { from: ['closed'], to: 'open', label: 'reopened' },
}

const STATUS_TEXT = { open: 'open', ack: 'acknowledged', shelved: 'shelved', closed: 'closed' }
const list = (v) => (v == null || v === '' ? null : [].concat(v).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))
const rank = (s) => { const i = SEVERITY_RANK.indexOf(s); return i < 0 ? SEVERITY_RANK.length : i }
const summary = ({ history: _history, ...alert }) => alert

export function createAlertsArea(store) {
  const withControls = (fn) => async (...args) => {
    await applyControls('alerts')
    return fn(...args)
  }
  const speed = () => Number(currentControls().speed) || 1

  /** Raises one new alert on a machine, as the alert manager would. */
  function raiseAlert() {
    let alert
    store.update((state) => {
      const n = state.counters.alert++
      const machine = MACHINES[(n * 5) % MACHINES.length]
      const [event] = ALERT_EVENTS[(n * 3) % ALERT_EVENTS.length]
      alert = createAlert({
        id: `alert-${String(n).padStart(3, '0')}`,
        machine,
        event,
        severity: ['major', 'minor', 'warning', 'critical'][n % 4],
        at: new Date().toISOString(),
      })
      state.alerts.push(alert)
      return state
    })
    return structuredClone(alert)
  }

  // In development, new alerts arrive occasionally while the Alerts area lists them.
  let lastListed = 0
  let timer = null
  function keepRaising() {
    if (!import.meta.env.DEV || import.meta.env.MODE === 'test' || currentControls().newAlerts === false) return
    lastListed = Date.now()
    if (timer) return
    const next = () => {
      timer = setTimeout(() => {
        timer = null
        if (Date.now() - lastListed > 2 * 60_000 || currentControls().newAlerts === false) return
        raiseAlert()
        next()
      }, NEW_ALERT_MS / Math.max(speed(), 0.01))
    }
    next()
  }
  store.onReset?.(() => { clearTimeout(timer); timer = null })

  const find = (id) => store.get().alerts.find((a) => a.id === id)
  const requireAlert = (id) => find(id) ?? (() => { throw new DataError('alerts', 'not_found', `There is no alert ${id}.`) })()

  return {
    raiseAlert,

    listAlerts: withControls(({ status, severity, environment, service, text, sort = 'severity', page = 1, pageSize = PAGE_SIZE } = {}) => {
      keepRaising()
      const statuses = list(status) ?? ACTIVE_ALERT_STATUSES
      const severities = list(severity)
      const q = String(text ?? '').trim().toLowerCase()
      const base = store.get().alerts
        .filter((a) => statuses.includes(a.status))
        .filter((a) => !environment || a.environment === environment)
        .filter((a) => !service || a.service.includes(service))
        .filter((a) => !q || [a.id, a.resource, a.event, a.text, a.value, ...a.service].some((v) => v && String(v).toLowerCase().includes(q)))
      const bySeverity = {}
      for (const a of base) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1
      const filtered = base
        .filter((a) => !severities || severities.includes(a.severity))
        .sort((a, b) => (sort === 'time' ? 0 : rank(a.severity) - rank(b.severity)) || b.createTime.localeCompare(a.createTime))
      const size = Math.max(1, Number(pageSize) || PAGE_SIZE)
      const start = (Math.max(1, Number(page) || 1) - 1) * size
      return { alerts: structuredClone(filtered.slice(start, start + size).map(summary)), total: filtered.length, bySeverity, page: Number(page) || 1, pageSize: size }
    }),

    countAlerts: withControls(({ status = ACTIVE_ALERT_STATUSES } = {}) => {
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

    getAlert: withControls((id) => structuredClone(requireAlert(id))),

    applyAlertAction: withControls((id, { action, text } = {}) => {
      const alert = requireAlert(id)
      const rule = ACTION_RULES[action]
      if (!rule) throw new DataError('alerts', 'invalid', `${action} is not an alert action.`)
      if (!rule.from.includes(alert.status)) {
        throw new DataError('alerts', 'conflict', `The alert is ${STATUS_TEXT[alert.status] ?? alert.status} and cannot be ${rule.label}.`)
      }
      let updated
      store.update((state) => {
        const a = state.alerts.find((x) => x.id === id)
        a.status = rule.to
        a.history.push({
          at: new Date().toISOString(),
          type: 'status',
          status: rule.to,
          severity: a.severity,
          text: String(text ?? '').trim() || `Alert ${rule.label}.`,
          user: state.user.name,
        })
        updated = structuredClone(a)
        return state
      })
      return updated
    }),

    listEnvironments: withControls(() => [...new Set([...ALERT_ENVIRONMENTS, ...store.get().alerts.map((a) => a.environment)])].sort()),
    listServices: withControls(() => [...new Set(store.get().alerts.flatMap((a) => a.service))].sort()),
  }
}
