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

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useData } from '../../data/useData'
import { EntityRef } from '../../app/EntityRef'
import { Link, paths, useRoute } from '../../app/router'
import { useRevealOnChange } from '../../app/reveal'
import { Button, Card, DataView, EmptyState, StatusBadge, useToast } from '../../ui/components'
import { ContextMenu, isMenuKey, menuPointFor } from '../../ui/ContextMenu'
import { copyText } from '../../ui/clipboard'
import { formatAge } from '../../ui/format'
import { SEVERITY_ORDER } from '../../ui/status'
import AlertActionDialog from './AlertActionDialog'
import AlertDetail from './AlertDetail'
import { ACTIONS, actionInfo, actionsFor, alertPath, alertsPath, readFilters, SORTS, STATUS_FILTERS, toRequest } from './model'
import './alerts.css'

export const REFRESH_KEY = 'xana.alerts.refreshMs'
export const REFRESH_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 10_000, label: '10 s' },
  { value: 30_000, label: '30 s' },
  { value: 60_000, label: '1 min' },
]
const DEFAULT_REFRESH = 30_000

/** What the operator chose, or null. */
function readChosenRefresh() {
  const raw = localStorage.getItem(REFRESH_KEY)
  const stored = Number(raw)
  return raw !== null && REFRESH_OPTIONS.some((o) => o.value === stored) ? stored : null
}

/** The refresh options, with the configured default among them. */
function refreshOptions(configured) {
  if (configured == null || REFRESH_OPTIONS.some((o) => o.value === configured)) return REFRESH_OPTIONS
  return [...REFRESH_OPTIONS, { value: configured, label: `${configured / 1000} s` }].sort((a, b) => a.value - b.value)
}

/** Number of alerts per severity for the current filter; selecting one filters by it. */
function SeveritySummary({ counts, selected, onSelect }) {
  const severities = SEVERITY_ORDER.filter((s) => counts[s] || s === selected)
  return (
    <div className="severity-summary" role="group" aria-label="Alerts by severity">
      {severities.length === 0 && <span className="muted">No alerts for this filter.</span>}
      {severities.map((s) => (
        <button
          key={s} type="button" className="severity-summary__item" aria-pressed={selected === s}
          onClick={() => onSelect(selected === s ? '' : s)}
        >
          <StatusBadge kind="severity" value={s} />
          <strong>{counts[s] ?? 0}</strong>
        </button>
      ))}
    </div>
  )
}

function Filters({ filters, onChange, refreshMs, options, onRefreshMs, onRefresh }) {
  const environments = useData('alerts', 'listEnvironments')
  const services = useData('alerts', 'listServices')
  const ids = { status: useId(), env: useId(), service: useId(), text: useId(), sort: useId(), refresh: useId() }
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value }, key === 'text')
  return (
    <div className="alert-filters">
      <div className="field">
        <label className="field__label" htmlFor={ids.status}>Status</label>
        <select id={ids.status} value={filters.status} onChange={set('status')}>
          {!STATUS_FILTERS.some((s) => s.value === filters.status) && <option value={filters.status}>{filters.status}</option>}
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.env}>Environment</label>
        <select id={ids.env} value={filters.environment} onChange={set('environment')}>
          <option value="">All environments</option>
          {(environments.data ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.service}>Service</label>
        <select id={ids.service} value={filters.service} onChange={set('service')}>
          <option value="">All services</option>
          {(services.data ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="field alert-filters__text">
        <label className="field__label" htmlFor={ids.text}>Search</label>
        <input id={ids.text} type="search" value={filters.text} onChange={set('text')} placeholder="Resource, event, text…" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.sort}>Order</label>
        <select id={ids.sort} value={filters.sort} onChange={set('sort')}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.refresh}>Automatic refresh</label>
        <select id={ids.refresh} value={refreshMs} onChange={(e) => onRefreshMs(Number(e.target.value))}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <Button onClick={onRefresh}>Refresh now</Button>
    </div>
  )
}

/** Outcome of the last action, per alert. */
function ActionResults({ outcome, onDismiss }) {
  const info = actionInfo(outcome.action)
  const failed = outcome.results.filter((r) => !r.ok)
  return (
    <section className="card action-results" aria-labelledby="action-results-title">
      <header className="card__header">
        <h2 id="action-results-title" className="card__title">{info.label}: {outcome.results.length - failed.length} succeeded, {failed.length} failed</h2>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </header>
      <div className="card__body">
        <ul className="plain-list" role="status">
          {outcome.results.map((r) => (
            <li key={r.id}>
              <span className="mono">{r.id}</span>:{' '}
              {r.ok ? <>{info.done}, now <StatusBadge kind="alert" value={r.status} /></> : <span className="field__error">failed: {r.reason}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * Alerts area: severity summary, filters (kept in the URL), the alert list
 * with selection and bulk actions, and the selected alert's detail.
 */
export default function Alerts() {
  const { params, query, navigate } = useRoute()
  const filters = readFilters(query)
  const selectedAlert = params.alertId ?? null
  const [chosenRefresh, setChosenRefresh] = useState(readChosenRefresh)
  const settings = useData('alerts', 'getAlertSettings')
  const configuredRefresh = settings.data ? settings.data.refreshIntervalS * 1000 : null
  const refreshMs = chosenRefresh ?? configuredRefresh ?? DEFAULT_REFRESH
  const [refreshKey, setRefreshKey] = useState(0)
  const [selection, setSelection] = useState([])
  const [failures, setFailures] = useState({})
  const [pending, setPending] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [menu, setMenu] = useState(null)
  const detailRef = useRef(null)
  useRevealOnChange(detailRef, selectedAlert ?? '')

  // Side by side, opening the detail narrows the table; keep the selected row in view.
  useEffect(() => {
    if (!selectedAlert || !window.matchMedia?.('(min-width: 900px)').matches) return
    document.querySelector(`tr[data-alert="${CSS.escape(selectedAlert)}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedAlert])
  const closeMenu = useCallback(() => setMenu(null), [])
  const notify = useToast()
  const result = useData('alerts', 'listAlerts', [toRequest(filters)], { refreshMs, refreshKey })
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const changeFilters = (next, typing) => navigate(selectedAlert ? alertPath(selectedAlert, next) : alertsPath(next), { replace: typing })

  function changeRefresh(value) {
    setChosenRefresh(value)
    localStorage.setItem(REFRESH_KEY, String(value))
  }

  function done({ action, results }) {
    setOutcome({ action, results })
    setSelection(results.filter((r) => !r.ok).map((r) => r.id))
    setFailures(Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, r.reason])))
    refresh()
  }

  const toggle = (id) => setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const counts = result.data?.bySeverity ?? {}
  const single = selection.length === 1 ? result.data?.alerts.find((a) => a.id === selection[0]) : null

  /** Everything the operator can do from one alert, most direct first. */
  function menuItems(alert) {
    return [
      { label: 'Start new incident', primary: true, onSelect: () => navigate(paths.newIncident(alert.resource, alert.text)) },
      { label: 'Open details', onSelect: () => navigate(alertPath(alert.id, filters)) },
      { label: 'Open resource in the data explorer', onSelect: () => navigate(paths.entity(alert.resource)) },
      { label: 'Show active incidents', onSelect: () => navigate(paths.activeIncidentsFor(alert.resource)) },
      { label: 'Show incident history', onSelect: () => navigate(paths.historyFor(alert.resource)) },
      { separator: true },
      ...actionsFor(alert.status).map((a) => ({ label: `${a.label}…`, onSelect: () => setPending({ action: a.action, ids: [alert.id] }) })),
      { separator: true },
      {
        label: 'Copy alert ID',
        onSelect: async () => {
          const ok = await copyText(alert.id)
          notify(ok ? `Copied ${alert.id}` : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
        },
      },
    ]
  }

  return (
    <section className="page alerts" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Alerts</h1>
        {result.data && <p className="muted">{result.data.total} {result.data.total === 1 ? 'alert matches' : 'alerts match'} the filter</p>}
      </div>

      <SeveritySummary counts={counts} selected={filters.severity} onSelect={(severity) => changeFilters({ ...filters, severity })} />
      <Filters filters={filters} onChange={changeFilters} refreshMs={refreshMs} options={refreshOptions(configuredRefresh)} onRefreshMs={changeRefresh} onRefresh={refresh} />

      {outcome && <ActionResults outcome={outcome} onDismiss={() => setOutcome(null)} />}

      {selection.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected alerts">
          <strong>{selection.length} selected</strong>
          {single && <Link to={paths.newIncident(single.resource, single.text)} className="btn btn--primary btn--sm">Start new incident</Link>}
          {ACTIONS.map((a) => <Button key={a.action} size="sm" onClick={() => setPending({ action: a.action, ids: selection })}>{a.label}…</Button>)}
          <Button size="sm" variant="ghost" onClick={() => { setSelection([]); setFailures({}) }}>Clear selection</Button>
        </div>
      )}

      <div className={`alerts__layout${selectedAlert ? ' alerts__layout--detail' : ''}`}>
        <Card title="Alert list" className="alert-list">
          <DataView
            result={result}
            errorTitle="Could not load alerts"
            isEmpty={(data) => data.alerts.length === 0}
            empty={<EmptyState title="No alerts match the current filter.">Change the status, severity, environment, service or search.</EmptyState>}
          >
            {(data) => (
              <AlertTable
                alerts={data.alerts} filters={filters} selected={selectedAlert}
                selection={selection} failures={failures} onToggle={toggle}
                onToggleAll={(all) => setSelection(all ? data.alerts.map((a) => a.id) : [])}
                onOpen={(alert) => navigate(alertPath(alert.id, filters))}
                onMenu={(alert, at) => setMenu({ alert, at })}
              />
            )}
          </DataView>
          {result.data && result.data.total > result.data.alerts.length && (
            <p className="muted">Showing {result.data.alerts.length} of {result.data.total} alerts; narrow the filter to see the others.</p>
          )}
        </Card>
        <div className="alerts__detail" ref={detailRef} hidden={!selectedAlert}>
          {selectedAlert && (
            <AlertDetail
              key={selectedAlert} id={selectedAlert} refreshKey={refreshKey}
              onAction={(action, ids) => setPending({ action, ids })}
              onClose={() => navigate(alertsPath(filters))}
            />
          )}
        </div>
      </div>

      {menu && <ContextMenu at={menu.at} label={`Actions for alert ${menu.alert.id}`} items={menuItems(menu.alert)} onClose={closeMenu} />}
      <AlertActionDialog open={!!pending} action={pending?.action} ids={pending?.ids ?? []} onClose={() => setPending(null)} onDone={done} />
    </section>
  )
}

const INTERACTIVE = 'a, button, input, select, textarea, label'

/**
 * The alert list. Selecting a row opens its detail; a right click, the
 * menu key, Shift+F10 or the row's actions button open its context menu.
 */
function AlertTable({ alerts, filters, selected, selection, failures, onToggle, onToggleAll, onOpen, onMenu }) {
  const allSelected = alerts.length > 0 && alerts.every((a) => selection.includes(a.id))
  return (
    <div className="table-wrap">
      <table className="table alert-table">
        <caption className="visually-hidden">Alerts, most severe and newest first</caption>
        <thead>
          <tr>
            <th scope="col"><input type="checkbox" aria-label="Select all listed alerts" checked={allSelected} onChange={(e) => onToggleAll(e.target.checked)} /></th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Resource</th>
            <th scope="col">Event</th>
            <th scope="col">Text</th>
            <th scope="col">Service</th>
            <th scope="col">Age</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr
              key={a.id} aria-current={selected === a.id ? 'true' : undefined} data-alert={a.id}
              className="alert-table__row"
              onClick={(e) => { if (!e.target.closest(INTERACTIVE)) onOpen(a) }}
              onContextMenu={(e) => { e.preventDefault(); onMenu(a, { x: e.clientX, y: e.clientY }) }}
              onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); onMenu(a, menuPointFor(e.target)) } }}
            >
              <td><input type="checkbox" aria-label={`Select ${a.id}`} checked={selection.includes(a.id)} onChange={() => onToggle(a.id)} /></td>
              <td><StatusBadge kind="severity" value={a.severity} /></td>
              <td><StatusBadge kind="alert" value={a.status} /></td>
              <td><EntityRef id={a.resource} /></td>
              <td><Link to={alertPath(a.id, filters)} aria-label={`${a.event} (${a.id})`}>{a.event}</Link></td>
              <td>
                {a.text}
                {failures[a.id] && <span className="field__error alert-table__failure">Action failed: {failures[a.id]}</span>}
              </td>
              <td>{a.service.join(', ')}</td>
              <td><time dateTime={a.createTime}>{formatAge(a.createTime)}</time></td>
              <td>
                <button
                  type="button" className="alert-table__menu" aria-haspopup="menu"
                  aria-label={`Actions for ${a.event} (${a.id})`}
                  onClick={(e) => onMenu(a, menuPointFor(e.currentTarget))}
                >
                  ⋯
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
