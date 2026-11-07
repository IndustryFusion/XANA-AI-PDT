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
 * Rules of the machine-builder conversation, defined once and used by both
 * the screens and the data sources, so they cannot disagree about which
 * structured acts are valid in which conversation state.
 *
 * A conversation is a sequence of `message` steps in the run's step list.
 * Each message carries the conversation state after it (`convState`).
 */

/** Structured acts the operator can send, in display order. */
export const ACTS = {
  inform: { label: 'Inform', hint: 'Share information with the machine builder.' },
  request: { label: 'Request', hint: 'Ask the machine builder for something.' },
  grant: { label: 'Grant request', hint: 'Grant the machine builder’s pending request.' },
  deny: { label: 'Deny request', hint: 'Deny the machine builder’s pending request.' },
  escalate: { label: 'Ask for direct contact', hint: 'Continue outside the application, person to person.' },
  deescalate: { label: 'End direct contact', hint: 'Return to the structured conversation.' },
  close: { label: 'Close with outcome', hint: 'Close the conversation; the run is stopped.' },
  cancel: { label: 'Cancel escalation', hint: 'Withdraw the escalation; the run is stopped.' },
}

/** Labels of acts that appear in a thread but are not sent by the operator as acts. */
export const MESSAGE_KINDS = {
  ...Object.fromEntries(Object.entries(ACTS).map(([id, a]) => [id, a.label])),
  question: 'Question to the agent',
  answer: 'Agent answer',
  note: 'Note',
}

/** Conversation states (labels are in ui/status.js). */
export const CONVERSATION_STATES = ['open', 'direct_contact_operator', 'direct_contact_machine_builder', 'closed']

export const CLOSE_OUTCOMES = {
  resolved: 'Resolved',
  not_resolved: 'Not resolved',
  escalated: 'Escalated to direct contact',
}

/** Every outcome a conversation can have, as the machine builder can close with the protocol's others. */
export const OUTCOME_LABELS = {
  ...CLOSE_OUTCOMES,
  failed: 'Not resolved',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
  timed_out: 'Timed out',
  superseded: 'Superseded',
}

/** Outcomes after which a closed run cannot be reopened. */
export const FINAL_OUTCOMES = ['escalated', 'superseded']

/** Run states in which the conversation accepts acts. */
export const CONVERSATION_STATUSES = ['awaiting_machine_builder', 'awaiting_operator_approval', 'awaiting_recommendation_review']

const BY_STATE = {
  open: ['inform', 'request', 'escalate', 'close', 'cancel'],
  direct_contact_operator: ['inform', 'request', 'deescalate', 'close', 'cancel'],
  direct_contact_machine_builder: ['inform', 'request'],
  closed: [],
}

/** Acts the operator may send in a conversation state. */
export function allowedActs(convState, { requestPending = false } = {}) {
  const acts = [...(BY_STATE[convState] ?? [])]
  if (requestPending && acts.length > 0) acts.splice(2, 0, 'grant', 'deny')
  return acts
}

/** Close outcomes the operator may choose in a conversation state. */
export function closeOutcomes(convState) {
  return convState === 'direct_contact_operator'
    ? Object.keys(CLOSE_OUTCOMES)
    : Object.keys(CLOSE_OUTCOMES).filter((o) => o !== 'escalated')
}

/** Message steps of a run, in time order. */
export function messagesOf(steps = []) {
  return steps.filter((s) => s.node === 'message').map((s) => ({ ...s.output, at: s.at }))
}

/** Current conversation state, or null when the run was never escalated. */
export function conversationState(steps = []) {
  let state = null
  for (const s of steps) {
    if (s.node === 'escalate') state = 'open'
    if (s.node === 'message' && s.output?.convState) state = s.output.convState
  }
  return state
}

/** The machine builder's request still waiting for grant or deny, or null. */
export function pendingRequest(steps = []) {
  const messages = messagesOf(steps)
  const answered = new Set(messages.filter((m) => m.act === 'grant' || m.act === 'deny').map((m) => m.inReplyTo))
  // A request in free text names no capability, so the protocol has no grant or deny for it.
  const open = messages.filter((m) => m.sender === 'machine_builder' && m.act === 'request' && !m.dataRequest && !m.freeText && !answered.has(m.messageId))
  return open[open.length - 1] ?? null
}
