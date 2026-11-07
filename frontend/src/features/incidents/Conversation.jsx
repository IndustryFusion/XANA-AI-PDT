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

import { useEffect, useId, useRef, useState } from 'react'
import { filesHref, runs } from '../../data'
import { useData } from '../../data/useData'
import {
  ACTS, allowedActs, CLOSE_OUTCOMES, closeOutcomes, CONVERSATION_STATUSES, OUTCOME_LABELS,
  conversationState, MESSAGE_KINDS, pendingRequest,
} from '../../data/conversationActs'
import { Button, EmptyState, StatusBadge } from '../../ui/components'
import { ConfirmDialog, StructuredFields } from '../../ui/structured'
import { formatTime } from '../../ui/format'
import { latestSuggestions } from './runModel'

const OUTBOX_POLL_MS = 1000


/** Conversation entries after the escalation: messages and policy checks, in time order. */
export function threadEntries(steps = []) {
  const start = steps.findIndex((s) => s.node === 'escalate')
  return steps
    .slice(start < 0 ? steps.length : start + 1)
    .filter((s) => s.node === 'message' || s.node === 'policy_check')
}

function senderLabel(sender, builder) {
  if (sender === 'operator') return 'You'
  if (sender === 'agent') return 'Incident agent'
  return builder ?? 'Machine builder'
}

/** Delivery state of the operator's messages: the run's outbox, refreshed while anything is pending. */
function useOutbox(run) {
  const known = new Map(run.outbox?.map((o) => [o.messageId, o.status]))
  const sent = threadEntries(run.steps).filter((s) => s.node === 'message' && s.output.sender === 'operator' && !s.output.internal)
  const pendingLocally = sent.some((s) => (known.get(s.output.messageId) ?? 'pending') === 'pending')
  const polled = useData('runs', 'getOutboxStatus', [run.runId], {
    enabled: sent.length > 0,
    refreshMs: pendingLocally ? OUTBOX_POLL_MS : 0,
    refreshKey: run.steps.length,
  })
  for (const o of polled.data ?? []) known.set(o.messageId, o.status)
  return (messageId) => known.get(messageId) ?? 'pending'
}

/* ── Thread ─────────────────────────────────────────────────────────────── */

function Message({ message, at, builder, delivery }) {
  const outgoing = message.sender === 'operator' && !message.internal
  return (
    <li className={`message message--${message.sender}${message.internal ? ' message--internal' : ''}`}>
      <div className="message__head">
        <strong>{senderLabel(message.sender, builder)}</strong>
        <span className="message__act">{MESSAGE_KINDS[message.act] ?? message.act}</span>
        <time className="muted" dateTime={at}>{formatTime(at)}</time>
        {outgoing && delivery && <StatusBadge kind="delivery" value={delivery} />}
      </div>
      <p className="message__text">{message.text}</p>
      {message.outcome && <p className="message__meta">Outcome: {OUTCOME_LABELS[message.outcome] ?? message.outcome}</p>}
      {message.recordedByOperator && <p className="message__meta">Recorded by the operator; the machine builder communicated the close outside the application.</p>}
      {message.internal && !message.recordedByOperator && <p className="message__meta">Between you and the incident agent; not sent to the machine builder.</p>}
      {message.dataRequest && (
        <div className="message__meta">
          Requested data:
          <ul className="plain-list">{message.dataRequest.items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>
        </div>
      )}
      {message.filesUrl && <p className="message__meta"><a href={filesHref(message.filesUrl)}>Download the files</a></p>}
      {message.filesUnavailable && <p className="message__meta">The files of this message are no longer available.</p>}
      {message.recommendation && (
        <ol className="action-items">{message.recommendation.actions.map((a) => <li key={a}>{a}</li>)}</ol>
      )}
    </li>
  )
}

export function MessageThread({ entries, escalation, builder, deliveryOf = () => null }) {
  const messages = entries.filter((e) => e.node === 'message')
  return (
    <section className="thread" aria-label="Message thread">
      {messages.length === 0 && (
        <EmptyState title="No messages exchanged yet.">
          {escalation && (
            <div className="stack">
              <p>Sent with escalation <span className="mono">{escalation.ref}</span> to {escalation.recipient?.name} under {escalation.tier}:</p>
              <ul className="plain-list">{escalation.data.map((d) => <li key={d.label}>{d.label}</li>)}</ul>
            </div>
          )}
        </EmptyState>
      )}
      <ol className="thread__list">
        {entries.map((e, i) => (e.node === 'message'
          ? <Message key={e.output.messageId ?? i} message={e.output} at={e.at} builder={builder} delivery={deliveryOf(e.output.messageId)} />
          : (
            <li key={`policy-${i}`} className="message message--policy">
              <div className="message__head">
                <strong>Policy check</strong>
                <span className="message__act">{e.output.tier}</span>
                <time className="muted" dateTime={e.at}>{formatTime(e.at)}</time>
              </div>
              <p className="message__text">{e.output.decision}</p>
              <StructuredFields value={{ sent: e.output.sent, withheld: e.output.withheld }} />
            </li>
          )))}
      </ol>
    </section>
  )
}

/* ── Composer, suggestions, agent questions ─────────────────────────────── */

function ActComposer({ run, convState, pending, draft, onSent }) {
  const acts = allowedActs(convState, { requestPending: !!pending })
  const [act, setAct] = useState(acts[0])
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const textRef = useRef(null)
  const ids = { act: useId(), text: useId(), outcome: useId() }

  useEffect(() => {
    if (!draft) return
    setAct(draft.act)
    setText(draft.text)
    textRef.current?.focus()
  }, [draft])

  const current = acts.includes(act) ? act : acts[0]
  const needsText = current === 'inform' || current === 'request'

  async function send(e) {
    e.preventDefault()
    if (needsText && !text.trim()) { setError({ message: 'Enter a message.' }); return }
    if (current === 'close' && !outcome) { setError({ message: 'Choose an outcome for closing the conversation.' }); return }
    setBusy(true)
    setError(null)
    try {
      await runs.sendConversationAct(run.runId, { act: current, text, outcome: current === 'close' ? outcome : undefined, inReplyTo: pending?.messageId })
      setText('')
      setOutcome('')
      onSent?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="composer stack" onSubmit={send} noValidate aria-label="Send to the machine builder">
      <h3 className="panel__subtitle">Send to the machine builder</h3>
      <div className="composer__row">
        <div className="field">
          <label className="field__label" htmlFor={ids.act}>Act</label>
          <select id={ids.act} value={current} disabled={busy} onChange={(e) => setAct(e.target.value)}>
            {acts.map((a) => <option key={a} value={a}>{ACTS[a].label}</option>)}
          </select>
        </div>
        {current === 'close' && (
          <div className="field">
            <label className="field__label" htmlFor={ids.outcome}>Outcome</label>
            <select id={ids.outcome} value={outcome} disabled={busy} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Choose…</option>
              {closeOutcomes(convState).map((o) => <option key={o} value={o}>{CLOSE_OUTCOMES[o]}</option>)}
            </select>
          </div>
        )}
      </div>
      <p className="muted">{ACTS[current]?.hint}</p>
      {(current === 'grant' || current === 'deny') && pending && <p className="muted">In reply to: “{pending.text}”</p>}
      <div className="field">
        <label className="field__label" htmlFor={ids.text}>{needsText ? 'Message' : 'Message (optional)'}</label>
        <textarea id={ids.text} ref={textRef} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      </div>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <div className="row"><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button></div>
    </form>
  )
}

function SuggestedActions({ suggestions, acts, onUse }) {
  const usable = suggestions.filter((s) => acts.includes(s.act))
  if (usable.length === 0) return null
  return (
    <section className="suggestions" aria-labelledby="suggestions-title">
      <h3 id="suggestions-title" className="panel__subtitle">Suggested by the incident agent</h3>
      <ul className="plain-list stack">
        {usable.map((s, i) => (
          <li key={i} className="suggestion">
            <span className="message__act">{ACTS[s.act].label}</span>
            <span>{s.text}</span>
            <Button size="sm" onClick={() => onUse({ ...s, key: Date.now() })}>Use suggestion<span className="visually-hidden">: {ACTS[s.act].label}</span></Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AgentQuestion({ run }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const id = useId()

  async function ask(e) {
    e.preventDefault()
    if (!text.trim()) { setError({ message: 'Enter a question.' }); return }
    setBusy(true)
    setError(null)
    try {
      await runs.askAgent(run.runId, text)
      setText('')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="composer stack" onSubmit={ask} noValidate aria-label="Ask the incident agent">
      <div className="field">
        <label className="field__label" htmlFor={id}>Ask the incident agent</label>
        <textarea id={id} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
      </div>
      <p className="muted">Questions go to the incident agent only; nothing is sent to the machine builder.</p>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <div className="row"><Button type="submit" disabled={busy}>{busy ? 'Asking…' : 'Ask'}</Button></div>
    </form>
  )
}

/* ── Status check and manual close ──────────────────────────────────────── */

function StatusTools({ run }) {
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false)
  const [recording, setRecording] = useState(false)
  const [outcome, setOutcome] = useState('resolved')
  const [reason, setReason] = useState('')
  const ids = { outcome: useId(), reason: useId() }

  async function check() {
    setChecking(true)
    setResult(null)
    try {
      const { status } = await runs.refreshConversationStatus(run.runId)
      setResult(status === 'mb_closed' ? 'The machine builder has closed the conversation.' : 'The machine builder has not closed the conversation.')
    } catch (err) {
      setResult(`Could not check the status: ${err.message}`)
    } finally {
      setChecking(false)
    }
  }

  function record() {
    if (!reason.trim()) return Promise.reject(new Error('Enter the reason the machine builder gave.'))
    return runs.recordMachineBuilderClose(run.runId, { outcome, reason })
  }

  return (
    <div className="status-tools">
      <div className="row">
        <Button size="sm" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check status'}</Button>
        <Button size="sm" onClick={() => setRecording(true)}>Record close…</Button>
      </div>
      <p className="muted" role="status">{result}</p>
      <ConfirmDialog open={recording} title="Record a close by the machine builder" confirmLabel="Record close" onConfirm={record} onClose={() => setRecording(false)}>
        <p className="muted">Use this when the machine builder closed the conversation outside the application.</p>
        <div className="field">
          <label className="field__label" htmlFor={ids.outcome}>Outcome</label>
          <select id={ids.outcome} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {Object.entries(CLOSE_OUTCOMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.reason}>Reason given by the machine builder</label>
          <textarea id={ids.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </div>
  )
}

/* ── Conversation view ──────────────────────────────────────────────────── */

export default function Conversation({ run }) {
  const [draft, setDraft] = useState(null)
  const convState = conversationState(run.steps) ?? 'open'
  const pending = pendingRequest(run.steps)
  const active = CONVERSATION_STATUSES.includes(run.status) && convState !== 'closed'
  const acts = active ? allowedActs(convState, { requestPending: !!pending }) : []
  const deliveryOf = useOutbox(run)
  const builder = run.escalation?.recipient?.name

  return (
    <div className="conversation stack">
      <div className="conversation__bar">
        <span className="row">
          <span className="muted">Conversation with {builder ?? 'the machine builder'}</span>
          <StatusBadge kind="conversation" value={convState} />
        </span>
        {CONVERSATION_STATUSES.includes(run.status) && <StatusTools run={run} />}
      </div>
      <MessageThread entries={threadEntries(run.steps)} escalation={run.escalation} builder={builder} deliveryOf={deliveryOf} />
      {active && <SuggestedActions suggestions={latestSuggestions(run.steps)} acts={acts} onUse={setDraft} />}
      {active && acts.length > 0 && <ActComposer key={convState} run={run} convState={convState} pending={pending} draft={draft} onSent={() => setDraft(null)} />}
      {!active && <p className="muted">The conversation does not accept messages in the run’s current state.</p>}
      {run.escalation && <AgentQuestion run={run} />}
    </div>
  )
}
