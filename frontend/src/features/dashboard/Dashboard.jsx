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

import { useState } from 'react'
import { CONNECTION_CHANGED } from '../../data'
import { useData } from '../../data/useData'
import { EntityRef } from '../../app/EntityRef'
import { Link, paths } from '../../app/router'
import { Button, Card, DataView, EmptyState, StatusBadge } from '../../ui/components'
import { triggeredBy } from '../../ui/format'
import { SEVERITY_ORDER, toneOf } from '../../ui/status'
import './dashboard.css'

export const REFRESH_KEY = 'xana.dashboard.refreshMs'
export const REFRESH_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 10_000, label: '10 s' },
  { value: 30_000, label: '30 s' },
  { value: 60_000, label: '1 min' },
]
const DEFAULT_REFRESH = 30_000

function readRefresh() {
  const stored = Number(localStorage.getItem(REFRESH_KEY))
  return REFRESH_OPTIONS.some((o) => o.value === stored) && localStorage.getItem(REFRESH_KEY) !== null ? stored : DEFAULT_REFRESH
}

export default function Dashboard() {
  const [refreshMs, setRefreshMs] = useState(readRefresh)
  const [refreshKey, setRefreshKey] = useState(0)
  const opts = { refreshMs, refreshKey }

  function changeRefresh(value) {
    setRefreshMs(value)
    localStorage.setItem(REFRESH_KEY, String(value))
  }

  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Dashboard</h1>
        <div className="row">
          <label className="row" htmlFor="dashboard-refresh">
            <span className="muted">Automatic refresh</span>
            <select id="dashboard-refresh" value={refreshMs} onChange={(e) => changeRefresh(Number(e.target.value))}>
              {REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Button onClick={() => setRefreshKey((k) => k + 1)}>Refresh now</Button>
        </div>
      </div>
      <div className="columns dashboard-grid">
        <IncidentsTile opts={opts} />
        <AlertsTile opts={opts} />
        <DataTile opts={opts} />
        <DataspaceTile opts={opts} />
        <HealthTile opts={opts} />
      </div>
    </section>
  )
}

function TileTitle({ to, children }) {
  return <Link to={to}>{children}</Link>
}

const MAX_LISTED = 5

function IncidentsTile({ opts }) {
  const result = useData('runs', 'listActiveRuns', [], opts)
  return (
    <Card title={<TileTitle to={paths.incidents()}>Active incidents</TileTitle>} className="tile">
      <DataView
        result={result}
        errorTitle="Could not load active incidents"
        isEmpty={(runs) => runs.length === 0}
        empty={(
          <EmptyState title="No active incidents.">
            <p>Start an analysis to diagnose a machine or process issue.</p>
            <Link to={paths.newIncident()} className="btn btn--primary btn--md">Start a new analysis</Link>
          </EmptyState>
        )}
      >
        {(runs) => (
          <div className="stack">
            <p className="tile__figure"><strong>{runs.length}</strong> active</p>
            <ul className="tile__list">
              {runs.slice(0, MAX_LISTED).map((run) => (
                <li key={run.runId} className={`tile__item tile__item--toned toned toned--${toneOf('run', run.status)}`}>
                  <div className="tile__item-main">
                    <Link to={paths.run(run.runId)} className="tile__item-title">{run.issue}</Link>
                    <span className="row muted">
                      <EntityRef id={run.machineId} />
                      {triggeredBy(run.source) && <span data-testid="run-source">{triggeredBy(run.source)}</span>}
                    </span>
                  </div>
                  <StatusBadge kind="run" value={run.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </DataView>
    </Card>
  )
}

function AlertsTile({ opts }) {
  const result = useData('alerts', 'countAlerts', [{ status: ['open', 'ack'] }], opts)
  return (
    <Card title={<TileTitle to={paths.alerts()}>Open alerts</TileTitle>} className="tile">
      <DataView
        result={result}
        errorTitle="Could not load alerts"
        isEmpty={(c) => c.total === 0}
        empty={<EmptyState title="No open or acknowledged alerts." />}
      >
        {(counts) => (
          <div className="stack">
            <p className="tile__figure"><strong>{counts.total}</strong> open or acknowledged</p>
            <ul className="row tile__chips" aria-label="Alerts by severity">
              {SEVERITY_ORDER.filter((s) => counts.bySeverity[s]).map((s) => (
                <li key={s}><StatusBadge kind="severity" value={s} label={`${counts.bySeverity[s]} ${s}`} /></li>
              ))}
            </ul>
          </div>
        )}
      </DataView>
    </Card>
  )
}

function DataTile({ opts }) {
  const result = useData('entities', 'getStats', [], opts)
  return (
    <Card title={<TileTitle to={paths.explorer()}>Data overview</TileTitle>} className="tile">
      <DataView
        result={result}
        errorTitle="Could not load data overview"
        isEmpty={(s) => s.entityCount === 0}
        empty={<EmptyState title="No entities in the context broker yet." />}
      >
        {(stats) => (
          <div className="stack">
            <p className="tile__figure"><strong>{stats.entityCount}</strong> entities in <strong>{stats.typeCount}</strong> types</p>
            <ul className="tile__list">
              {stats.byType.slice(0, MAX_LISTED).map((t) => (
                <li key={t.type} className="tile__item">
                  <span>{t.type}</span>
                  <span className="muted">{t.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DataView>
    </Card>
  )
}

const ON_CONNECTION_CHANGE = [CONNECTION_CHANGED]

const LEVEL_LABELS = { standard: 'standard', elevated: 'elevated', restricted: 'restricted', unknown: 'unknown' }

/** Peers per access level, as the backend works it out from the gateway, and the peers with elevated access. */
function AccessLevels({ opts }) {
  const result = useData('dataspace', 'getAccessLevels', [], { ...opts, refreshOn: ON_CONNECTION_CHANGE })
  return (
    <DataView result={result} errorTitle="Could not load access levels">
      {({ peers, counts }) => {
        const elevated = peers.filter((p) => p.accessLevel === 'elevated')
        const shown = Object.keys(LEVEL_LABELS).filter((level) => level !== 'unknown' || counts.unknown > 0)
        return (
          <section className="stack" aria-label="Access levels">
            <p className="row tile__levels">
              {shown.map((level) => (
                <span key={level} className={`level level--${level}`} data-level={level}><strong>{counts[level]}</strong> {LEVEL_LABELS[level]}</span>
              ))}
            </p>
            {elevated.length > 0 && (
              <ul className="tile__list" aria-label="Peers with elevated access">
                {elevated.map((p) => <li key={p.peerId} className="tile__item">{p.name}: {p.approved.join(', ')}</li>)}
              </ul>
            )}
          </section>
        )
      }}
    </DataView>
  )
}

function DataspaceTile({ opts }) {
  const connection = useData('dataspace', 'getConnection', [], { ...opts, refreshOn: ON_CONNECTION_CHANGE })
  const connected = connection.data?.state === 'connected'
  const peers = useData('dataspace', 'listPeers', [], { ...opts, enabled: connected, refreshOn: ON_CONNECTION_CHANGE })
  return (
    <Card title={<TileTitle to={paths.dataspace()}>Dataspace</TileTitle>} className="tile">
      <DataView result={connection} errorTitle="Could not load dataspace status">
        {(c) => (
          <div className="stack">
            <StatusBadge kind="connection" value={c.state} />
            {connected ? (
              <>
                {c.participantId && <p className="muted">Participant <span className="mono">{c.participantId}</span></p>}
                <DataView
                  result={peers}
                  errorTitle="Could not load peers"
                  isEmpty={(list) => list.length === 0}
                  empty={<EmptyState title="No compatible peers yet." />}
                >
                  {(list) => (
                    <>
                      <p className="tile__figure"><strong>{list.length}</strong> compatible peers</p>
                      <ul className="tile__list">
                        {list.slice(0, MAX_LISTED).map((p) => <li key={p.id} className="tile__item">{p.name}</li>)}
                      </ul>
                    </>
                  )}
                </DataView>
                <AccessLevels opts={opts} />
              </>
            ) : (
              <EmptyState title="Not connected to the dataspace.">
                <Link to={paths.dataspace()}>Open Dataspace to connect</Link>
              </EmptyState>
            )}
          </div>
        )}
      </DataView>
    </Card>
  )
}

function HealthTile({ opts }) {
  const result = useData('system', 'getHealth', [], opts)
  return (
    <Card title={<TileTitle to={paths.system()}>System health</TileTitle>} className="tile">
      <DataView result={result} errorTitle="Could not load system health">
        {(health) => (
          <div className="stack">
            <StatusBadge kind="health" value={health.overall} label={`Overall: ${health.overall}`} />
            <ul className="tile__list">
              {health.checks.map((c) => (
                <li key={c.id} className="tile__item">
                  <span>{c.label}</span>
                  <span className="row">
                    {c.latencyMs != null && <span className="muted">{c.latencyMs} ms</span>}
                    <StatusBadge kind="health" value={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DataView>
    </Card>
  )
}
