import { useEffect, useRef, useState } from 'react'
import { runs } from '../../data'
import { useRun } from '../../data/useRun'
import { messagesOf } from '../../data/conversationActs'
import { EntityRef } from '../../app/EntityRef'
import { Link, paths } from '../../app/router'
import { Button, ErrorState, LoadingState, StatusBadge, Tabs } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'
import { formatTime } from '../../ui/format'
import { DecisionCard, HypothesisList } from './Analysis'
import Conversation from './Conversation'
import { StatePanel } from './panels'
import { isOpen } from './runModel'
import StepFeed from './StepFeed'

export function RunHeader({ run }) {
  const [stopping, setStopping] = useState(false)
  return (
    <header className="run-header">
      <div className="run-header__title">
        <h2 id="run-title">{run.incidentId != null ? `Incident #${run.incidentId}` : 'New analysis'}</h2>
        <StatusBadge kind="run" value={run.status} />
        {isOpen(run.status) && <Button size="sm" variant="danger" className="run-header__stop" onClick={() => setStopping(true)}>Stop run…</Button>}
      </div>
      <p className="run-header__issue">{run.issue}</p>
      <dl className="details run-header__details">
        <dt>Machine</dt><dd><EntityRef id={run.machineId} /></dd>
        {run.escalationRef && <><dt>Escalation</dt><dd className="mono">{run.escalationRef}</dd></>}
        <dt>Run</dt><dd className="mono">{run.runId}</dd>
        <dt>Started</dt><dd><time dateTime={run.startedAt}>{formatTime(run.startedAt)}</time></dd>
      </dl>
      <ConfirmDialog open={stopping} title="Stop this run?" confirmLabel="Stop run" variant="danger" onConfirm={() => runs.stopRun(run.runId)} onClose={() => setStopping(false)}>
        <p>The agent stops working on this run.{run.escalation && ' The conversation with the machine builder can be continued by reopening the run.'}</p>
      </ConfirmDialog>
    </header>
  )
}

function Diagnostics({ run }) {
  return (
    <div className="stack">
      <HypothesisList steps={run.steps} />
      <DecisionCard steps={run.steps} />
      <StepFeed steps={run.steps} running={run.status === 'running'} />
    </div>
  )
}

/** Count of machine-builder messages that arrived while the conversation was not shown. */
function useUnread(run, showing) {
  const count = run ? messagesOf(run.steps).filter((m) => m.sender === 'machine_builder').length : 0
  const [seen, setSeen] = useState(null)
  useEffect(() => {
    if (run && (showing || seen === null)) setSeen(count)
  }, [run, showing, count, seen])
  return showing || seen === null ? 0 : Math.max(0, count - seen)
}

/**
 * One run: header, the panel for its current state, and its diagnostics;
 * once escalated, diagnostics and the machine-builder conversation as tabs.
 */
export default function RunView({ runId, onStatusChange, onArchived }) {
  const { phase, run, connection, error, retry } = useRun(runId)
  const [tab, setTab] = useState('diagnostics')
  const escalatedBefore = useRef(null)
  const escalated = !!run?.escalation
  const unread = useUnread(run, tab === 'conversation')

  useEffect(() => {
    if (!run) return
    if (escalatedBefore.current === null) setTab(escalated ? 'conversation' : 'diagnostics')
    else if (escalated && !escalatedBefore.current) setTab('conversation')
    escalatedBefore.current = escalated
  }, [run, escalated])

  const status = run?.status
  useEffect(() => { if (status) onStatusChange?.(status) }, [status, onStatusChange])

  if (phase === 'error' && error?.kind === 'not_found') {
    return (
      <section className="card run-missing" aria-labelledby="run-title">
        <div className="card__body stack">
          <h2 id="run-title">This run is not active</h2>
          <p className="muted">Run <span className="mono">{runId}</span> does not exist or was archived.</p>
          <p><Link to={paths.history()}>Look for it in the incident history</Link></p>
        </div>
      </section>
    )
  }
  if (phase === 'error') return <ErrorState title="Could not load the run" error={error} onRetry={retry} />
  if (!run) {
    return connection === 'reconnecting'
      ? <p className="run-view__reconnecting" role="status">Connection lost. Reconnecting…</p>
      : <LoadingState label="Loading run…" />
  }

  return (
    <article className="run-view stack" aria-labelledby="run-title">
      <RunHeader run={run} />
      {connection === 'reconnecting' && <p className="run-view__reconnecting" role="status">Connection lost. Reconnecting…</p>}
      <StatePanel run={run} onArchived={onArchived} />
      {escalated ? (
        <Tabs
          label="Run views"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'diagnostics', label: 'Diagnostics', content: <Diagnostics run={run} /> },
            {
              id: 'conversation',
              label: <>Conversation{unread > 0 && <span className="badge badge--special tab-badge">{unread} unread</span>}</>,
              content: <Conversation run={run} />,
            },
          ]}
        />
      ) : <Diagnostics run={run} />}
    </article>
  )
}
