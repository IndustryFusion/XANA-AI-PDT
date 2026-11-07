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

import { useId, useState } from 'react'
import { runs } from '../../data'
import { useData } from '../../data/useData'
import { CLOSE_OUTCOMES } from '../../data/conversationActs'
import { Button, Card, StatusBadge, useToast } from '../../ui/components'
import { ConfidenceMeter, ConfirmDialog, FileAttachments } from '../../ui/structured'
import { percent } from '../../ui/format'
import { paths, useRoute } from '../../app/router'
import EscalationDialog from './EscalationDialog'

/** Runs an action with busy and error state; the caller's inputs stay as they are on failure. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function run(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

function ActionError({ error }) {
  if (!error) return null
  return <p className="form-error" role="alert">{error.message}</p>
}

function TextField({ label, value, onChange, invalid, errorText, disabled, required }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <textarea
        id={id} value={value} disabled={disabled} required={required}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && <p id={`${id}-error`} className="field__error">{errorText}</p>}
    </div>
  )
}

/* ── awaiting_input ─────────────────────────────────────────────────────── */

export function ClarificationPanel({ run }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [missing, setMissing] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const action = useAction()
  const { question, confidence, threshold } = run.data

  function submit(e) {
    e.preventDefault()
    if (!text.trim() && files.length === 0) { setMissing(true); return }
    setMissing(false)
    action.run(() => runs.clarify(run.runId, { text, files }))
  }

  return (
    <Card headingLevel={3} title="The agent needs more information" className="panel panel--attention">
      <form className="stack" onSubmit={submit} noValidate>
        <p className="panel__question">{question}</p>
        <p className="row">
          <ConfidenceMeter value={confidence} />
          {threshold != null && <span className="muted">below the {percent(threshold)} threshold</span>}
        </p>
        <TextField label="Your clarification" value={text} onChange={setText} disabled={action.busy} invalid={missing} errorText="Enter a clarification or attach a file." />
        <FileAttachments files={files} onChange={setFiles} disabled={action.busy} />
        <ActionError error={action.error} />
        <div className="row">
          <Button type="submit" variant="primary" disabled={action.busy}>{action.busy ? 'Submitting…' : 'Submit clarification'}</Button>
          <Button onClick={() => setEscalating(true)} disabled={action.busy}>Escalate to machine builder…</Button>
        </div>
      </form>
      <EscalationDialog open={escalating} runId={run.runId} onClose={() => setEscalating(false)} />
    </Card>
  )
}

/* ── awaiting_confirmation ──────────────────────────────────────────────── */

export function ResolutionPanel({ run }) {
  const [rejecting, setRejecting] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [reason, setReason] = useState('')
  const [files, setFiles] = useState([])
  const [missing, setMissing] = useState(false)
  const action = useAction()
  const { rootCause, recommendedAction, confidence, rejected = [] } = run.data

  function reject(e) {
    e.preventDefault()
    if (!reason.trim()) { setMissing(true); return }
    setMissing(false)
    action.run(() => runs.confirmResolution(run.runId, { confirmed: false, text: reason, files }))
  }

  return (
    <Card headingLevel={3} title="Confirm the proposed resolution" className="panel panel--info">
      <div className="stack">
        <dl className="details">
          <dt>Root cause</dt><dd>{rootCause}</dd>
          <dt>Recommended action</dt><dd>{recommendedAction}</dd>
          <dt>Confidence</dt><dd><ConfidenceMeter value={confidence} label="" /></dd>
        </dl>
        {rejected.length > 0 && (
          <section aria-labelledby={`${run.runId}-rejected`}>
            <h4 id={`${run.runId}-rejected`} className="panel__subtitle">Previously rejected resolutions</h4>
            <ol className="plain-list rejected-list">
              {rejected.map((r, i) => (
                <li key={i}><strong>{r.rootCause}</strong> <span className="muted">Reason: {r.reason}</span></li>
              ))}
            </ol>
          </section>
        )}
        {!rejecting && (
          <div className="row">
            <Button variant="primary" disabled={action.busy} onClick={() => action.run(() => runs.confirmResolution(run.runId, { confirmed: true }))}>
              Confirm resolution
            </Button>
            <Button disabled={action.busy} onClick={() => setRejecting(true)}>Reject…</Button>
            <Button disabled={action.busy} onClick={() => setEscalating(true)}>Escalate to machine builder…</Button>
          </div>
        )}
        {rejecting && (
          <form className="stack" onSubmit={reject} noValidate aria-label="Reject the resolution">
            <TextField label="Reason for rejecting" value={reason} onChange={setReason} disabled={action.busy} invalid={missing} errorText="Give a reason for the rejection." required />
            <FileAttachments files={files} onChange={setFiles} disabled={action.busy} />
            <div className="row">
              <Button type="submit" variant="primary" disabled={action.busy}>Submit rejection</Button>
              <Button disabled={action.busy} onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          </form>
        )}
        <ActionError error={action.error} />
      </div>
      <EscalationDialog open={escalating} runId={run.runId} onClose={() => setEscalating(false)} />
    </Card>
  )
}

/* ── awaiting_recommendation_review ─────────────────────────────────────── */

export function RecommendationPanel({ run }) {
  const [message, setMessage] = useState('')
  const action = useAction()
  const { builder, summary, actions = [] } = run.data
  const reply = (choice) => action.run(() => runs.replyToRecommendation(run.runId, { action: choice, message, recommendationId: run.data.recommendationId }))

  return (
    <Card headingLevel={3} title={`Recommendation from ${builder}`} className="panel panel--success">
      <div className="stack">
        <p>{summary}</p>
        <div>
          <h4 className="panel__subtitle">Action items</h4>
          <ol className="action-items">{actions.map((a) => <li key={a}>{a}</li>)}</ol>
        </div>
        <TextField label="Message to the machine builder (optional)" value={message} onChange={setMessage} disabled={action.busy} />
        <ActionError error={action.error} />
        <div className="row">
          <Button variant="primary" disabled={action.busy} onClick={() => reply('resolved')}>Resolved</Button>
          <Button disabled={action.busy} onClick={() => reply('still_failing')}>Still failing</Button>
          <Button disabled={action.busy} onClick={() => reply('escalate')}>Escalate to direct contact</Button>
        </div>
      </div>
    </Card>
  )
}

/* ── awaiting_operator_approval ─────────────────────────────────────────── */

function ItemList({ items, empty }) {
  if (!items?.length) return <p className="muted">{empty}</p>
  return <ul className="plain-list">{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>
}

export function ApprovalPanel({ run }) {
  const [note, setNote] = useState('')
  const action = useAction()
  const { builder, text, tier, requested, withinTier, needsApproval } = run.data
  const decide = (approved) => action.run(() => runs.approveDataRequest(run.runId, { approved, note, requestId: run.data.requestId }))

  return (
    <Card headingLevel={3} title="Data request needs your approval" className="panel panel--warning">
      <div className="stack">
        <p><strong>{builder}</strong> asks: “{text}”</p>
        <div className="approval-grid">
          <section aria-label="Requested data">
            <h4 className="panel__subtitle">Requested</h4>
            <ItemList items={requested} empty="Nothing." />
          </section>
          <section aria-label="Within the sharing tier">
            <h4 className="panel__subtitle">Within {tier}, sent automatically</h4>
            <ItemList items={withinTier} empty="Nothing." />
          </section>
          <section aria-label="Needs approval">
            <h4 className="panel__subtitle">Beyond the tier, sent only if you approve</h4>
            <ItemList items={needsApproval} empty="Nothing." />
          </section>
        </div>
        <TextField label="Note to the machine builder (optional)" value={note} onChange={setNote} disabled={action.busy} />
        <ActionError error={action.error} />
        <div className="row">
          <Button variant="primary" disabled={action.busy} onClick={() => decide(true)}>Approve and send</Button>
          <Button disabled={action.busy} onClick={() => decide(false)}>Decline</Button>
        </div>
      </div>
    </Card>
  )
}

/* ── awaiting_machine_builder ───────────────────────────────────────────── */

export function WaitingPanel({ run }) {
  return (
    <Card headingLevel={3} title={`Waiting for ${run.data.builder ?? 'the machine builder'}`} className="panel panel--special">
      <p className="muted">
        Escalated as <span className="mono">{run.escalationRef}</span>. Replies, requests and recommendations appear in the conversation.
      </p>
      <EscalationDelivery run={run} />
    </Card>
  )
}

const DELIVERY_POLL_MS = 3000
const SENT_KINDS = { files: 'Machine data', request: 'Incident' }

/** Delivery of what the escalation sent. Read here, as the run's stream doesn't carry it. */
function EscalationDelivery({ run }) {
  const polled = useData('runs', 'getOutboxStatus', [run.runId], { refreshMs: DELIVERY_POLL_MS })
  const current = (polled.data ?? run.outbox ?? []).filter((o) => SENT_KINDS[o.kind])
  if (current.length === 0) return null
  return (
    <ul className="plain-list stack" aria-label="Delivery of the escalation">
      {current.map((o) => (
        <li key={o.messageId} className="row">
          <span>{SENT_KINDS[o.kind]}</span>
          <StatusBadge kind="delivery" value={o.status} />
          {o.error && <span className="muted">{o.error}</span>}
        </li>
      ))}
    </ul>
  )
}

/* ── Final states ───────────────────────────────────────────────────────── */

const OUTCOME_TITLES = {
  completed: 'Completed',
  failed: 'The run failed',
  stopped: 'Stopped',
  mb_closed: 'Closed by the machine builder',
}

export function OutcomePanel({ run, onArchived }) {
  const [dialog, setDialog] = useState(null)
  const { navigate } = useRoute()
  const notify = useToast()
  const { data, status } = run
  const title = status === 'mb_closed' && data.recordedBy === 'operator' ? 'Closed by the machine builder (recorded by you)' : OUTCOME_TITLES[status]

  async function archive() {
    await runs.archiveRun(run.runId)
    notify(run.incidentId != null ? `Run archived as incident #${run.incidentId}; see the incident history.` : 'Run archived; see the incident history.', 'success')
    onArchived?.()
    navigate(paths.incidents())
  }

  return (
    <Card headingLevel={3} title={title} className={`panel panel--${status === 'failed' ? 'danger' : status === 'completed' ? 'success' : 'neutral'}`}>
      <div className="stack">
        {status === 'completed' && (
          <>
            <dl className="details">
              <dt>Root cause</dt><dd>{data.rootCause}</dd>
              <dt>Resolution</dt><dd>{data.recommendedAction}</dd>
              {data.resolvedBy && <><dt>Recommended by</dt><dd>{data.resolvedBy}</dd></>}
              {data.confidence != null && <><dt>Confidence</dt><dd><ConfidenceMeter value={data.confidence} label="" /></dd></>}
            </dl>
            <p>The incident was logged{run.incidentId != null && <> as incident #{run.incidentId}</>}.</p>
          </>
        )}
        {status === 'failed' && <p className="form-error">{data.error}</p>}
        {status === 'stopped' && (
          <dl className="details">
            <dt>Reason</dt><dd>{data.reason}</dd>
            {data.outcome && <><dt>Outcome</dt><dd>{CLOSE_OUTCOMES[data.outcome] ?? data.outcome}</dd></>}
            {data.closePending && (
              <>
                <dt>Machine builder</dt>
                <dd role="status">Not told yet that this is closed: {data.closeProblem}. It is tried again, and the run can be archived once it has gone out.</dd>
              </>
            )}
          </dl>
        )}
        {status === 'mb_closed' && (
          <dl className="details">
            <dt>Outcome</dt><dd>{CLOSE_OUTCOMES[data.outcome] ?? data.outcome}</dd>
            <dt>Reason</dt><dd>{data.reason}</dd>
          </dl>
        )}
        {run.escalation && !run.reopenable && <p className="muted">This run cannot be reopened.</p>}
        <div className="row">
          {run.reopenable && <Button variant="primary" onClick={() => setDialog('reopen')}>Reopen…</Button>}
          <Button onClick={() => setDialog('archive')}>Archive…</Button>
        </div>
      </div>
      <ConfirmDialog
        open={dialog === 'reopen'} title="Reopen this run?" confirmLabel="Reopen"
        onConfirm={() => runs.reopenRun(run.runId)} onClose={() => setDialog(null)}
      >
        <p>The run returns to waiting for the machine builder and the conversation continues.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'archive'} title="Archive this run?" confirmLabel="Archive"
        onConfirm={archive} onClose={() => setDialog(null)}
      >
        <p>The run leaves the active list and becomes an incident in the incident history.</p>
      </ConfirmDialog>
    </Card>
  )
}

/** The panel for the run's current state, or nothing while it runs. */
export function StatePanel({ run, onArchived }) {
  switch (run.status) {
    case 'awaiting_input': return <ClarificationPanel run={run} />
    case 'awaiting_confirmation': return <ResolutionPanel run={run} />
    case 'awaiting_recommendation_review': return <RecommendationPanel run={run} />
    case 'awaiting_operator_approval': return <ApprovalPanel run={run} />
    case 'awaiting_machine_builder': return <WaitingPanel run={run} />
    case 'completed':
    case 'failed':
    case 'stopped':
    case 'mb_closed':
      return <OutcomePanel run={run} onArchived={onArchived} />
    default: return null
  }
}
