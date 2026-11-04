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
import { runs } from '../../data'
import { useData } from '../../data/useData'
import { EntityRef, entityLabel } from '../../app/EntityRef'
import { Link, paths, useRoute } from '../../app/router'
import { Button, Card, DataView, EmptyState, StatusBadge } from '../../ui/components'
import { formatAge } from '../../ui/format'
import { useRevealOnChange } from '../../app/reveal'
import { toneOf } from '../../ui/status'
import RunView from './RunView'
import './incidents.css'

export const LIST_REFRESH_MS = 5000

const runPath = (runId, machine) => (machine ? `${paths.run(runId)}?machine=${encodeURIComponent(machine)}` : paths.run(runId))

/** Open runs, newest first, optionally for one machine. */
export function RunList({ selected, machine, refreshKey }) {
  const result = useData('runs', 'listActiveRuns', [], { refreshMs: LIST_REFRESH_MS, refreshKey })
  const filter = (list) => (machine ? list.filter((r) => r.machineId === machine) : list)
  return (
    <Card title="Open runs" className="run-list">
      {machine && (
        <p className="filter-note">
          <span>Machine: <EntityRef id={machine} /></span>
          <Link to={paths.incidents()}>Clear filter</Link>
        </p>
      )}
      <DataView
        result={result}
        errorTitle="Could not load open runs"
        isEmpty={(list) => filter(list).length === 0}
        empty={(
          <EmptyState title={machine ? 'No open runs for this machine.' : 'No open runs.'}>
            <Link to={paths.newIncident(machine)} className="btn btn--primary btn--md">Start a new analysis</Link>
          </EmptyState>
        )}
      >
        {(list) => (
          <ul className="run-list__items">
            {filter(list).map((r) => (
              <li key={r.runId} className={`run-list__item toned toned--${toneOf('run', r.status)}`} data-status={r.status}>
                <Link to={runPath(r.runId, machine)} className="run-list__link" aria-current={selected === r.runId ? 'true' : undefined}>
                  <span className="run-list__issue">{r.issue}</span>
                  <span className="run-list__meta">
                    <span>{entityLabel(r.machineId)}</span>
                    <span>{r.incidentId != null ? `#${r.incidentId}` : 'No incident number yet'}</span>
                    <span>{formatAge(r.startedAt)}</span>
                  </span>
                </Link>
                <StatusBadge kind="run" value={r.status} />
              </li>
            ))}
          </ul>
        )}
      </DataView>
    </Card>
  )
}

/** Machine ID and issue (both may be proposed); starts a run and opens its run view. */
export function NewIncidentForm({ machineId = '', issue: proposedIssue = '', onStarted }) {
  const [machine, setMachine] = useState(machineId)
  const [issue, setIssue] = useState(proposedIssue)
  const [missing, setMissing] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const machineRef = useRef(null)
  const issueRef = useRef(null)
  const ids = { machine: useId(), issue: useId() }

  useEffect(() => { (machineId ? issueRef : machineRef).current?.focus() }, [machineId])

  async function submit(e) {
    e.preventDefault()
    const next = { machine: !machine.trim(), issue: !issue.trim() }
    setMissing(next)
    if (next.machine) { machineRef.current?.focus(); return }
    if (next.issue) { issueRef.current?.focus(); return }
    setBusy(true)
    setError(null)
    try {
      const { runId } = await runs.startRun({ machineId: machine.trim(), issue: issue.trim() })
      onStarted(runId)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Card title="New incident" className="new-incident">
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <fieldset className="plain-fieldset stack" disabled={busy}>
          <div className="field">
            <label className="field__label" htmlFor={ids.machine}>Machine ID</label>
            <input
              id={ids.machine} ref={machineRef} value={machine} onChange={(e) => setMachine(e.target.value)}
              aria-invalid={missing.machine || undefined} aria-describedby={`${ids.machine}-hint${missing.machine ? ` ${ids.machine}-error` : ''}`}
            />
            <p id={`${ids.machine}-hint`} className="muted field__hint">Entity ID, for example urn:ngsi-ld:Machine:press-brake-01, or the short name press-brake-01.</p>
            {missing.machine && <p id={`${ids.machine}-error`} className="field__error">Enter the machine ID.</p>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.issue}>Issue</label>
            <textarea
              id={ids.issue} ref={issueRef} value={issue} onChange={(e) => setIssue(e.target.value)}
              aria-invalid={missing.issue || undefined} aria-describedby={missing.issue ? `${ids.issue}-error` : undefined}
            />
            {missing.issue && <p id={`${ids.issue}-error`} className="field__error">Describe the issue.</p>}
          </div>
          {error && <p className="form-error" role="alert">Could not start the analysis: {error.message}</p>}
          <div className="row">
            <Button type="submit" variant="primary">{busy ? 'Starting…' : 'Start analysis'}</Button>
            <Link to={paths.incidents()} className="btn btn--secondary btn--md">Cancel</Link>
          </div>
        </fieldset>
      </form>
    </Card>
  )
}

/** Active incidents area: open runs next to the selected run or the new-incident form. */
export default function ActiveIncidents() {
  const { params, query, navigate } = useRoute()
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshList = useCallback(() => setRefreshKey((k) => k + 1), [])
  const creating = query.new === '1'
  const machine = !creating && query.machine ? query.machine : null
  const mainRef = useRef(null)
  useRevealOnChange(mainRef, creating ? 'new' : params.runId ?? '')

  function started(runId) {
    refreshList()
    navigate(paths.run(runId))
  }

  let main
  if (creating) main = <NewIncidentForm key={`${query.machine ?? ''}|${query.issue ?? ''}`} machineId={query.machine ?? ''} issue={query.issue ?? ''} onStarted={started} />
  else if (params.runId) main = <RunView key={params.runId} runId={params.runId} onStatusChange={refreshList} onArchived={refreshList} />
  else {
    main = (
      <div className="card"><div className="card__body">
        <EmptyState title="No run selected.">
          <p>Select a run in the list, or start a new analysis.</p>
        </EmptyState>
      </div></div>
    )
  }

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Active incidents</h1>
        {!creating && <Link to={paths.newIncident(machine)} className="btn btn--primary btn--md">New incident</Link>}
      </div>
      <div className="split">
        <div className="split__side"><RunList selected={params.runId} machine={machine} refreshKey={refreshKey} /></div>
        <div className="split__main" ref={mainRef}>{main}</div>
      </div>
    </section>
  )
}
