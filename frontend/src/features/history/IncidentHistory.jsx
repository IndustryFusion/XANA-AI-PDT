import { useId, useState } from 'react'
import { incidents as incidentsApi } from '../../data'
import { useData } from '../../data/useData'
import { EntityRef, entityLabel } from '../../app/EntityRef'
import { Link, paths, useRoute } from '../../app/router'
import { Button, Card, DataView, EmptyState, ErrorState, LoadingState, StatusBadge } from '../../ui/components'
import { ConfidenceMeter, ConfirmDialog } from '../../ui/structured'
import { formatDate, formatTime } from '../../ui/format'
import { INCIDENT_OUTCOME } from '../../ui/status'
import { MessageThread, threadEntries } from '../incidents/Conversation'
import { StepItem } from '../incidents/StepFeed'
import '../incidents/incidents.css'

const incidentPath = (id, machine) => (machine ? `${paths.incident(id)}?machine=${encodeURIComponent(machine)}` : paths.incident(id))

const matchesText = (incident, text) => {
  const q = text.trim().toLowerCase()
  if (!q) return true
  return [incident.issue, incident.rootCause, incident.machineId, `#${incident.number}`, incident.escalationRef]
    .some((v) => v && String(v).toLowerCase().includes(q))
}

/** Search, filters and the list of past incidents. */
export function IncidentList({ selected, machine }) {
  const { navigate } = useRoute()
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const ids = { text: useId(), machine: useId(), outcome: useId(), from: useId(), to: useId() }
  const all = useData('incidents', 'listIncidents', [{}])
  const result = useData('incidents', 'listIncidents', [{ machineId: machine || undefined, status: outcome || undefined, from: from || undefined, to: to || undefined }])
  const machines = [...new Set((all.data ?? []).map((i) => i.machineId))].sort()
  const filtered = (list) => list.filter((i) => matchesText(i, text))
  const filtering = !!(text || outcome || from || to || machine)

  function clearFilters() {
    setText('')
    setOutcome('')
    setFrom('')
    setTo('')
    if (machine) navigate(paths.history())
  }

  return (
    <Card title="Past incidents" className="incident-list">
      <div className="stack">
        <div className="filters">
          <div className="field filters__search">
            <label className="field__label" htmlFor={ids.text}>Search</label>
            <input id={ids.text} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Issue, root cause, number…" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.machine}>Machine</label>
            <select id={ids.machine} value={machine ?? ''} onChange={(e) => navigate(e.target.value ? paths.historyFor(e.target.value) : paths.history())}>
              <option value="">All machines</option>
              {machine && !machines.includes(machine) && <option value={machine}>{entityLabel(machine)}</option>}
              {machines.map((m) => <option key={m} value={m}>{entityLabel(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.outcome}>Outcome</label>
            <select id={ids.outcome} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All outcomes</option>
              {Object.entries(INCIDENT_OUTCOME).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.from}>Closed from</label>
            <input id={ids.from} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.to}>Closed until</label>
            <input id={ids.to} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {machine && (
          <p className="filter-note">
            <span>Machine: <EntityRef id={machine} /></span>
            <Link to={paths.history()}>Clear machine filter</Link>
          </p>
        )}
        <DataView
          result={result}
          errorTitle="Could not load the incident history"
          isEmpty={(list) => filtered(list).length === 0}
          empty={(
            <EmptyState title={filtering ? 'No incidents match the search and filters.' : 'No past incidents yet.'}>
              {filtering && <Button onClick={clearFilters}>Clear filters</Button>}
            </EmptyState>
          )}
        >
          {(list) => (
            <ul className="run-list__items">
              {filtered(list).map((i) => (
                <li key={i.id} className="run-list__item">
                  <Link to={incidentPath(i.id, machine)} className="run-list__link" aria-current={selected === i.id ? 'true' : undefined}>
                    <span className="run-list__issue">{i.issue}</span>
                    <span className="run-list__meta">
                      <span>#{i.number}</span>
                      <span>{entityLabel(i.machineId)}</span>
                      <span><time dateTime={i.closedAt}>{formatDate(i.closedAt)}</time></span>
                    </span>
                  </Link>
                  <StatusBadge kind="outcome" value={i.outcome} />
                </li>
              ))}
            </ul>
          )}
        </DataView>
      </div>
    </Card>
  )
}

/** The full trace of an incident: every step with its inputs and outputs. */
export function TraceView({ steps }) {
  return (
    <section className="card" aria-labelledby="trace-title">
      <header className="card__header"><h3 id="trace-title" className="card__title">Agent trace</h3></header>
      <div className="card__body">
        <ol className="step-feed__list">
          {steps.map((step, i) => <StepItem key={`${i}-${step.node}`} step={step} showInput />)}
        </ol>
      </div>
    </section>
  )
}

/** One past incident: what happened, the decision, the conversation and the trace. */
export function IncidentDetail({ id }) {
  const result = useData('incidents', 'getIncident', [id])
  const { navigate } = useRoute()
  const [reopening, setReopening] = useState(false)

  if (result.status === 'loading' && !result.data) return <LoadingState label="Loading incident…" />
  if (result.status === 'error' && result.error?.kind === 'not_found') {
    return (
      <section className="card" aria-labelledby="incident-title">
        <div className="card__body stack">
          <h2 id="incident-title">Incident not found</h2>
          <p className="muted">There is no incident {id}.</p>
        </div>
      </section>
    )
  }
  if (result.status === 'error') return <ErrorState title="Could not load the incident" error={result.error} onRetry={result.retry} />
  const incident = result.data

  async function reopen() {
    const { runId } = await incidentsApi.reopenIncident(incident.id)
    navigate(paths.run(runId))
  }

  return (
    <article className="stack" aria-labelledby="incident-title">
      <header className="run-header">
        <div className="run-header__title">
          <h2 id="incident-title">Incident #{incident.number}</h2>
          <StatusBadge kind="outcome" value={incident.outcome} />
          {!incident.reopenedRunId && <Button size="sm" variant="primary" className="run-header__stop" onClick={() => setReopening(true)}>Reopen…</Button>}
        </div>
        <p className="run-header__issue">{incident.issue}</p>
        <dl className="details run-header__details">
          <dt>Machine</dt><dd><EntityRef id={incident.machineId} /></dd>
          <dt>Started</dt><dd><time dateTime={incident.startedAt}>{formatTime(incident.startedAt)}</time></dd>
          <dt>Closed</dt><dd><time dateTime={incident.closedAt}>{formatTime(incident.closedAt)}</time></dd>
        </dl>
        {incident.reopenedRunId && (
          <p>Reopened as <Link to={paths.run(incident.reopenedRunId)}>{incident.reopenedRunId}</Link> in Active incidents.</p>
        )}
      </header>

      <Card title="Summary" headingLevel={3}>
        <dl className="details">
          <dt>Issue</dt><dd>{incident.issue}</dd>
          <dt>Root cause</dt><dd>{incident.rootCause ?? <span className="muted">Not determined</span>}</dd>
          <dt>Decision</dt>
          <dd>
            {incident.decision
              ? <>{incident.decision.recommendedAction} <ConfidenceMeter value={incident.decision.confidence} /></>
              : <span className="muted">The agent made no decision above its threshold.</span>}
          </dd>
          <dt>Resolution</dt><dd>{incident.resolution ?? <span className="muted">None recorded</span>}</dd>
          {incident.escalated && <><dt>Machine-builder reference</dt><dd><span className="mono">{incident.escalationRef}</span> · {incident.builder}</dd></>}
        </dl>
        {!incident.escalated && <p className="muted not-escalated">Resolved without the machine builder: this incident was never escalated.</p>}
      </Card>

      {incident.escalated && (
        <section className="card" aria-labelledby="conversation-title">
          <header className="card__header"><h3 id="conversation-title" className="card__title">Conversation with {incident.builder}</h3></header>
          <div className="card__body">
            <MessageThread entries={threadEntries(incident.trace)} escalation={incident.escalation} builder={incident.builder} />
          </div>
        </section>
      )}

      <TraceView steps={incident.trace} />

      <ConfirmDialog open={reopening} title={`Reopen incident #${incident.number}?`} confirmLabel="Reopen" onConfirm={reopen} onClose={() => setReopening(false)}>
        <p>
          A new run starts in Active incidents
          {incident.escalated ? ' and the conversation with the machine builder continues.' : ' with a new analysis.'}
        </p>
      </ConfirmDialog>
    </article>
  )
}

/** Incident history area: past incidents next to the selected incident. */
export default function IncidentHistory() {
  const { params, query } = useRoute()
  return (
    <section className="page" aria-labelledby="page-title">
      <div className="page__header"><h1 id="page-title">Incident history</h1></div>
      <div className="split">
        <div className="split__side"><IncidentList selected={params.incidentId} machine={query.machine} /></div>
        <div className="split__main">
          {params.incidentId
            ? <IncidentDetail key={params.incidentId} id={params.incidentId} />
            : (
              <div className="card"><div className="card__body">
                <EmptyState title="No incident selected.">
                  <p>Select an incident to see its decision, conversation and agent trace.</p>
                </EmptyState>
              </div></div>
            )}
        </div>
      </div>
    </section>
  )
}
