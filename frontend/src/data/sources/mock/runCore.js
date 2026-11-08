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

/**
 * Pure core of the mock run engine. A run record holds its public state
 * (summary, status data, steps, escalation, outbox) and the engine's private
 * position: a queue of timed scenario events and the stage it waits in.
 *
 * Functions here mutate a run record (inside a store update) and return the
 * interface events they produced; timers and subscribers live in runEngine.js.
 * The same functions fast-forward runs synchronously for the seed and tests.
 */
import { DataError } from '../../errors'
import {
  allowedActs, CLOSE_OUTCOMES, closeOutcomes, CONVERSATION_STATUSES, conversationState,
  FINAL_OUTCOMES, messagesOf, pendingRequest,
} from '../../conversationActs'
import { builderFor, SHARING_TIER } from './catalog'
import { contentFor } from './scenarios/content'
import { getScenario, reactionsFor } from './scenarios'

export const OPEN_STATES = [
  'running', 'awaiting_input', 'awaiting_confirmation', 'awaiting_machine_builder',
  'awaiting_operator_approval', 'awaiting_recommendation_review',
]
export const FINISHED_STATES = ['completed', 'failed', 'stopped', 'mb_closed']

/** Base delay until an operator message is delivered to the machine builder. */
export const DELIVERY_MS = 800
/** Base time the incident agent takes to answer a question. */
export const AGENT_ANSWER_MS = 1200

const conflict = (message) => new DataError('runs', 'conflict', message)
const invalid = (message) => new DataError('runs', 'invalid', message)

/** Counters for identifiers; part of the mock state. */
export function initialCounters() {
  return { run: 1001, incident: 42, message: 1, escalation: 2041, request: 1 }
}

export function createRunRecord({ runId, machineId, issue, scenario, at, incidentId = null }) {
  return {
    runId, incidentId, machineId, issue,
    status: 'running', startedAt: at, updatedAt: at, escalationRef: null, source: 'operator',
    scenario: getScenario(scenario).id,
    data: {}, steps: [], escalation: null, outbox: [],
    round: 1, rejected: [], wait: null, remoteClose: null, reopenedFrom: null,
    queue: [{ enter: 'start' }],
  }
}

export function summarize(run) {
  const { runId, incidentId, machineId, issue, status, startedAt, updatedAt, escalationRef, source } = run
  const recipient = run.escalation?.recipient
  const machineBuilder = recipient?.id ? { id: recipient.id, name: recipient.name || null } : null
  return { runId, incidentId, machineId, issue, status, startedAt, updatedAt, escalationRef, source, machineBuilder }
}

export function isReopenable(run) {
  return ['stopped', 'mb_closed', 'failed'].includes(run.status) && !!run.escalation && run.data?.reopenable !== false
}

/** The public run, as `getRun` and the first `subscribeRun` event return it. */
export function toRun(run) {
  return structuredClone({
    ...summarize(run),
    scenario: run.scenario,
    data: run.data,
    steps: run.steps,
    escalation: run.escalation,
    outbox: run.outbox,
    reopenable: isReopenable(run),
  })
}

function context(run) {
  const clarification = [...run.steps].reverse().find((s) => s.node === 'clarification')
  return { run, content: contentFor(run.machineId), lastClarification: clarification?.output.text ?? null }
}

/** Builds the event emitter for one change of a run at time `at`. */
function emitter(run, at, env, out) {
  const touch = () => { run.updatedAt = at }
  const x = {
    step(node, output, input = null) {
      touch()
      const step = { node, input, output, at }
      run.steps.push(step)
      out.push({ type: 'step', ...step })
    },
    status(status, data = {}) {
      touch()
      run.status = status
      run.data = data
      if (run.incidentId == null && status !== 'running') run.incidentId = env.state.counters.incident++
      out.push({ type: 'status', status, data, summary: summarize(run) })
    },
    message(fields) {
      const messageId = `msg-${env.state.counters.message++}`
      const convState = fields.convState ?? conversationState(run.steps) ?? 'open'
      x.step('message', { messageId, ...fields, convState })
      return messageId
    },
    /** A message from the operator to the machine builder; delivered after a delay. */
    send(act, text, extra = {}) {
      const messageId = x.message({ sender: 'operator', act, text, ...extra })
      run.outbox.push({ messageId, status: 'pending' })
      run.queue.push({ delay: DELIVERY_MS, deliver: messageId })
      return messageId
    },
    react(trigger) {
      run.queue.push(...reactionsFor(getScenario(run.scenario), trigger, context(run)))
    },
  }
  return x
}

function builderName(run) {
  return run.escalation?.recipient?.name ?? builderFor(run.machineId)?.name ?? 'Machine builder'
}

function waitingData(run) {
  return { escalationRef: run.escalationRef, builder: builderName(run) }
}

/* ── Scenario playback ───────────────────────────────────────────────────── */

/** Applies the next queued event of a run; returns the interface events. */
export function applyNext(run, at, env) {
  const event = run.queue.shift()
  const out = []
  if (!event) return out
  const x = emitter(run, at, env, out)
  const scenario = getScenario(run.scenario)

  if (event.enter) {
    const stage = scenario.stages[event.enter]
    run.queue.unshift(...(stage?.events?.(context(run)) ?? []), { settle: event.enter })
  } else if (event.settle) {
    const stage = scenario.stages[event.settle]
    if (stage?.wait) run.wait = event.settle
    else if (stage?.next) run.queue.unshift({ enter: stage.next })
  } else if (event.step) {
    x.step(event.step.node, event.step.output, event.step.input ?? null)
  } else if (event.status) {
    x.status(event.status, event.data ?? {})
  } else if (event.message) {
    x.message({ sender: 'machine_builder', ...event.message })
  } else if (event.dataRequest) {
    applyDataRequest(run, event.dataRequest, x, env)
  } else if (event.recommendation) {
    const { summary, actions } = event.recommendation
    x.message({ sender: 'machine_builder', act: 'inform', text: summary, recommendation: { summary, actions } })
    x.status('awaiting_recommendation_review', { ...waitingData(run), summary, actions })
  } else if (event.suggest) {
    x.step('suggest', { suggestions: event.suggest })
  } else if (event.remoteClose) {
    run.remoteClose = event.remoteClose
  } else if (event.deliver) {
    const entry = run.outbox.find((o) => o.messageId === event.deliver)
    if (entry) entry.status = env.connected ? 'delivered' : 'failed'
  }
  return out
}

function applyDataRequest(run, request, x, env) {
  const requestId = `req-${env.state.counters.request++}`
  const withinTier = request.items.filter((i) => SHARING_TIER.included.includes(i.category))
  const needsApproval = request.items.filter((i) => !SHARING_TIER.included.includes(i.category))
  x.message({ sender: 'machine_builder', act: 'request', text: request.text, dataRequest: { requestId, items: request.items } })
  x.step('policy_check', {
    requestId,
    recipient: builderName(run),
    tier: SHARING_TIER.label,
    sent: withinTier.map((i) => i.label),
    withheld: needsApproval.map((i) => i.label),
    decision: needsApproval.length
      ? 'Items beyond the sharing tier wait for the operator’s approval.'
      : 'All requested items are within the sharing tier and were sent automatically.',
  }, { requested: request.items.map((i) => i.label) })
  if (needsApproval.length) {
    x.status('awaiting_operator_approval', {
      ...waitingData(run), requestId, text: request.text, tier: SHARING_TIER.label,
      requested: request.items, withinTier, needsApproval,
    })
  }
}

/* ── Escalation pre-flight ───────────────────────────────────────────────── */

export const ESCALATION_DATA = [
  { label: 'Incident description and machine identifier', category: 'incident' },
  { label: 'Machine attributes', category: 'machine' },
  { label: 'Current sensor values', category: 'sensor' },
  { label: 'Hypotheses and confidence of the incident agent', category: 'incident' },
]

/** Run states from which the operator can escalate to the machine builder. */
export const ESCALATABLE = ['awaiting_input', 'awaiting_confirmation']

export function preflight(run, env) {
  const builder = builderFor(run.machineId)
  const base = { recipient: builder ? { id: builder.id, name: builder.name } : null, data: ESCALATION_DATA, sharingTier: SHARING_TIER.label }
  const no = (reason) => ({ possible: false, reason, ...base })
  if (!builder) return { ...no('No machine builder is registered for this machine in the dataspace.'), data: [] }
  if (run.escalation) return no('This run has already been escalated.')
  if (!ESCALATABLE.includes(run.status)) return no('Escalation is possible while the run waits for input or for the confirmation of a resolution.')
  if (!env.connected) return no('The dataspace is not connected. Connect in the Dataspace area and try again.')
  return { possible: true, reason: null, ...base }
}

/* ── Operator actions ────────────────────────────────────────────────────── */

const STATUS_TEXT = {
  running: 'running', awaiting_input: 'waiting for input', awaiting_confirmation: 'waiting for confirmation',
  awaiting_machine_builder: 'waiting for the machine builder', awaiting_operator_approval: 'waiting for approval',
  awaiting_recommendation_review: 'waiting for a recommendation review', mb_closed: 'closed by the machine builder',
  completed: 'completed', failed: 'failed', stopped: 'stopped',
}

function requireStatus(run, statuses, what) {
  if (!statuses.includes(run.status)) throw conflict(`The run is ${STATUS_TEXT[run.status] ?? run.status}; ${what} is not possible now.`)
}

function waitTarget(run, action) {
  const stage = run.wait && getScenario(run.scenario).stages[run.wait]
  const next = stage?.wait?.[action]
  if (!next) throw conflict('The run is not waiting for this action.')
  return next
}

const fileMeta = (files = []) => files.map(({ name, type, size }) => ({ name, type, size }))

function stop(run, x, data) {
  run.queue = []
  run.wait = null
  run.remoteClose = null
  x.status('stopped', { by: 'operator', ...data })
}

function agentAnswer(run) {
  const fromBuilder = messagesOf(run.steps).filter((m) => m.sender === 'machine_builder')
  const last = fromBuilder[fromBuilder.length - 1]
  const pending = pendingRequest(run.steps)
  return [
    `Escalation ${run.escalationRef} went to ${builderName(run)} under ${SHARING_TIER.label}.`,
    last ? `Their latest message: “${last.text}”` : 'They have not replied yet.',
    pending ? 'Their request is waiting for you to grant or deny it.' : 'Nothing of theirs is waiting for your answer.',
  ].join(' ')
}

const ACTIONS = {
  clarify(run, { text = '', files = [] } = {}, x) {
    requireStatus(run, ['awaiting_input'], 'a clarification')
    const next = waitTarget(run, 'clarify')
    if (!text.trim() && files.length === 0) throw invalid('Enter a clarification or attach a file.')
    x.step('clarification', { text, files: fileMeta(files) }, { question: run.data.question ?? null })
    run.wait = null
    run.round += 1
    x.status('running')
    run.queue.push({ enter: next })
    return { status: run.status }
  },

  confirmResolution(run, { confirmed, text = '', files = [] } = {}, x) {
    requireStatus(run, ['awaiting_confirmation'], 'confirming a resolution')
    if (confirmed) {
      const next = waitTarget(run, 'confirm')
      x.step('resolution', { confirmed: true, rootCause: run.data.rootCause, recommendedAction: run.data.recommendedAction })
      run.wait = null
      x.status('running')
      run.queue.push({ enter: next })
      return { status: run.status }
    }
    const next = waitTarget(run, 'reject')
    if (!text.trim()) throw invalid('Give a reason for rejecting the resolution.')
    run.rejected.push({ rootCause: run.data.rootCause, recommendedAction: run.data.recommendedAction, reason: text, at: x.at })
    x.step('resolution', { confirmed: false, rootCause: run.data.rootCause, reason: text, files: fileMeta(files) })
    run.wait = null
    run.round += 1
    x.status('running')
    run.queue.push({ enter: next })
    return { status: run.status }
  },

  escalate(run, _args, x, env) {
    requireStatus(run, ESCALATABLE, 'escalation')
    const pre = preflight(run, env)
    if (!pre.possible) throw new DataError('runs', 'unavailable', pre.reason)
    const ref = `ESC-${env.state.counters.escalation++}`
    run.escalationRef = ref
    run.wait = null
    run.escalation = { ref, recipient: pre.recipient, tier: pre.sharingTier, data: pre.data, sentAt: x.at }
    x.step('escalate', { escalationRef: ref, recipient: pre.recipient.name, tier: pre.sharingTier, sent: pre.data.map((d) => d.label) }, { confidence: run.data.confidence ?? null })
    x.status('awaiting_machine_builder', waitingData(run))
    x.react('escalate')
    return { status: run.status, escalationRef: ref }
  },

  approveDataRequest(run, { approved, note = '' } = {}, x) {
    requireStatus(run, ['awaiting_operator_approval'], 'deciding on a data request')
    const { requestId, needsApproval = [], tier } = run.data
    const labels = needsApproval.map((i) => i.label)
    x.step('policy_check', {
      requestId, recipient: builderName(run), tier,
      sent: approved ? labels : [],
      withheld: approved ? [] : labels,
      decision: approved ? 'Approved by the operator and sent.' : 'Declined by the operator; not sent.',
      note: note || null,
    }, { approved: !!approved })
    x.status('awaiting_machine_builder', waitingData(run))
    x.react(approved ? 'approved' : 'declined')
    return { status: run.status }
  },

  replyToRecommendation(run, { action, message = '' } = {}, x) {
    requireStatus(run, ['awaiting_recommendation_review'], 'answering the recommendation')
    const { summary, actions = [] } = run.data
    if (action === 'resolved') {
      x.send('inform', message || 'The recommended actions resolved the issue. Thank you.')
      x.step('act', { action: 'Incident logged with the machine builder’s recommendation', recommendedAction: actions.join('; '), incidentLogged: true })
      x.status('completed', { rootCause: summary, recommendedAction: actions.join('; '), confidence: null, resolvedBy: builderName(run), incidentLogged: true })
    } else if (action === 'still_failing') {
      x.send('inform', message || 'The issue persists after the recommended actions.')
      x.status('awaiting_machine_builder', waitingData(run))
      x.react('still_failing')
    } else if (action === 'escalate') {
      x.send('escalate', message || 'We would like to discuss this directly with your service team.', { convState: 'direct_contact_operator' })
      x.status('awaiting_machine_builder', waitingData(run))
      x.react('escalate_act')
    } else {
      throw invalid('Answer with resolved, still failing or escalate.')
    }
    return { status: run.status }
  },

  sendConversationAct(run, { act, outcome, text = '' } = {}, x) {
    requireStatus(run, CONVERSATION_STATUSES, 'sending to the machine builder')
    const convState = conversationState(run.steps)
    const pending = pendingRequest(run.steps)
    if (!allowedActs(convState, { requestPending: !!pending }).includes(act)) {
      throw conflict(`“${act}” is not possible while the conversation is ${convState?.replace(/_/g, ' ') ?? 'not open'}.`)
    }
    if ((act === 'inform' || act === 'request') && !text.trim()) throw invalid('Enter a message.')
    if (act === 'close') {
      if (!closeOutcomes(convState).includes(outcome)) throw invalid('Choose an outcome for closing the conversation.')
      run.queue = []
      x.send('close', text || `Closed with outcome: ${CLOSE_OUTCOMES[outcome]}.`, { outcome, convState: 'closed' })
      stop(run, x, { reason: `Conversation closed with outcome: ${CLOSE_OUTCOMES[outcome]}`, outcome, reopenable: !FINAL_OUTCOMES.includes(outcome) })
      run.queue.push(...run.outbox.filter((o) => o.status === 'pending').map((o) => ({ delay: DELIVERY_MS, deliver: o.messageId })))
      return { status: run.status, convState: 'closed' }
    }
    if (act === 'cancel') {
      run.queue = []
      x.send('cancel', text || 'We withdraw the escalation.', { convState: 'closed' })
      stop(run, x, { reason: 'Escalation cancelled by the operator', reopenable: true })
      run.queue.push(...run.outbox.filter((o) => o.status === 'pending').map((o) => ({ delay: DELIVERY_MS, deliver: o.messageId })))
      return { status: run.status, convState: 'closed' }
    }
    const extra = {}
    if (act === 'grant' || act === 'deny') extra.inReplyTo = pending.messageId
    if (act === 'escalate') extra.convState = 'direct_contact_operator'
    if (act === 'deescalate') extra.convState = 'open'
    const defaults = { grant: 'Granted.', deny: 'Denied.', escalate: 'We would like to continue directly with your service team.', deescalate: 'We return to the structured conversation.' }
    x.send(act, text || defaults[act], extra)
    x.react(act === 'escalate' ? 'escalate_act' : act)
    return { status: run.status, convState: conversationState(run.steps) }
  },

  askQuestion(run, { message = '' } = {}, x) {
    if (!run.escalation) throw conflict('The incident agent answers questions about a conversation once the run is escalated.')
    if (!message.trim()) throw invalid('Enter a question.')
    x.message({ sender: 'operator', act: 'question', text: message, internal: true })
    return {}
  },

  answerQuestion(run, _args, x) {
    const reply = agentAnswer(run)
    x.message({ sender: 'agent', act: 'answer', text: reply, internal: true })
    return { reply }
  },

  refreshConversationStatus(run, _args, x) {
    if (run.remoteClose && CONVERSATION_STATUSES.includes(run.status)) {
      const { outcome, reason, reopenable } = run.remoteClose
      run.remoteClose = null
      run.queue = []
      x.message({ sender: 'machine_builder', act: 'close', text: reason, outcome, convState: 'closed' })
      x.status('mb_closed', { outcome, reason, reopenable, recordedBy: 'machine_builder' })
    }
    return { status: run.status }
  },

  recordMachineBuilderClose(run, { outcome, reason = '' } = {}, x) {
    requireStatus(run, CONVERSATION_STATUSES, 'recording a close')
    if (!CLOSE_OUTCOMES[outcome]) throw invalid('Choose the outcome the machine builder closed with.')
    if (!reason.trim()) throw invalid('Enter the reason the machine builder gave.')
    run.queue = []
    run.remoteClose = null
    x.message({ sender: 'operator', act: 'close', text: `Close recorded by the operator: ${reason}`, outcome, recordedByOperator: true, internal: true, convState: 'closed' })
    x.status('mb_closed', { outcome, reason, reopenable: !FINAL_OUTCOMES.includes(outcome), recordedBy: 'operator' })
    return { status: run.status }
  },

  stopRun(run, _args, x) {
    requireStatus(run, OPEN_STATES, 'stopping')
    stop(run, x, { reason: 'Stopped by the operator', reopenable: !!run.escalation })
    return { status: run.status }
  },

  reopenRun(run, _args, x) {
    if (!isReopenable(run)) {
      throw conflict(run.escalation ? 'This run was closed for good and cannot be reopened.' : 'Only runs with a machine-builder conversation can be reopened.')
    }
    run.queue = []
    x.message({ sender: 'agent', act: 'note', text: 'Conversation reopened by the operator.', internal: true, convState: 'open' })
    x.status('awaiting_machine_builder', waitingData(run))
    x.react('reopen')
    return { status: run.status }
  },
}

/** Performs an operator action on a run; returns `{ result, events }` or throws a DataError. */
export function performAction(run, action, args, at, env) {
  const out = []
  const x = emitter(run, at, env, out)
  x.at = at
  const result = ACTIONS[action](run, args, x, env)
  return { result, events: out }
}

/* ── Synchronous playback (seed and tests) ───────────────────────────────── */

/**
 * Plays queued events without timers. `clock.t` (ms) advances by each
 * event's delay times `clock.scale`.
 */
export function drain(run, env, clock) {
  const events = []
  while (run.queue.length) {
    clock.t += (run.queue[0].delay ?? 0) * (clock.scale ?? 1)
    events.push(...applyNext(run, new Date(clock.t).toISOString(), env))
  }
  return events
}

/**
 * Plays a run to completion of its queue, performing operator `actions`
 * (`[name, args]`) whenever the queue is empty.
 */
export function simulate(run, env, actions, clock) {
  const events = drain(run, env, clock)
  for (const [name, args] of actions) {
    clock.t += 45_000 * (clock.scale ?? 1)
    events.push(...performAction(run, name, args, new Date(clock.t).toISOString(), env).events)
    events.push(...drain(run, env, clock))
  }
  return events
}

/* ── Incidents ───────────────────────────────────────────────────────────── */

const OUTCOME_RESOLUTION = {
  completed: (run) => run.data.recommendedAction ?? null,
  mb_closed: (run) => `Closed by the machine builder: ${run.data.reason}`,
  stopped: (run) => run.data.reason ?? 'Stopped by the operator',
  failed: (run) => `The run failed: ${run.data.error}`,
}

/** Turns an archived run into an incident record of the history. */
export function incidentFromRun(run, at) {
  const decision = [...run.steps].reverse().find((s) => s.node === 'decide' && s.output.rootCause)?.output ?? null
  const rootCause = run.status === 'completed' ? run.data.rootCause : decision?.rootCause ?? null
  return structuredClone({
    id: String(run.incidentId),
    number: run.incidentId,
    runId: run.runId,
    machineId: run.machineId,
    source: run.source,
    issue: run.issue,
    outcome: run.status,
    rootCause,
    decision: decision && { rootCause: decision.rootCause, recommendedAction: decision.recommendedAction, confidence: decision.confidence },
    resolution: OUTCOME_RESOLUTION[run.status]?.(run) ?? null,
    escalated: !!run.escalation,
    escalationRef: run.escalationRef,
    builder: run.escalation?.recipient?.name ?? null,
    escalation: run.escalation,
    conversation: messagesOf(run.steps),
    trace: run.steps,
    startedAt: run.startedAt,
    closedAt: at,
    reopenedRunId: null,
  })
}
