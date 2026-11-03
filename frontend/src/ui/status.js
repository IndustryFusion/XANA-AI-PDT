/**
 * Text labels and colour tones for every status the UI shows.
 * A status is always rendered with its label; the tone only adds colour.
 */

export const RUN_STATUS = {
  running: { label: 'Running', tone: 'progress', pulse: true },
  awaiting_input: { label: 'Needs input', tone: 'attention', pulse: true },
  awaiting_confirmation: { label: 'Confirm resolution', tone: 'info' },
  awaiting_machine_builder: { label: 'Awaiting machine builder', tone: 'special' },
  awaiting_operator_approval: { label: 'Approval required', tone: 'warning', pulse: true },
  awaiting_recommendation_review: { label: 'Review recommendation', tone: 'success' },
  mb_closed: { label: 'Closed by machine builder', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const SEVERITY = {
  critical: { label: 'Critical', tone: 'danger' },
  major: { label: 'Major', tone: 'warning' },
  minor: { label: 'Minor', tone: 'attention' },
  warning: { label: 'Warning', tone: 'attention' },
  informational: { label: 'Informational', tone: 'info' },
  debug: { label: 'Debug', tone: 'neutral' },
  trace: { label: 'Trace', tone: 'neutral' },
  indeterminate: { label: 'Indeterminate', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'success' },
  ok: { label: 'OK', tone: 'success' },
  cleared: { label: 'Cleared', tone: 'success' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

/** Severities from most to least severe, for ordered displays. */
export const SEVERITY_ORDER = Object.keys(SEVERITY)

export const HEALTH = {
  ok: { label: 'OK', tone: 'success' },
  degraded: { label: 'Degraded', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export const CONNECTION = {
  connected: { label: 'Dataspace connected', tone: 'success' },
  expired: { label: 'Dataspace session expired', tone: 'warning' },
  disconnected: { label: 'Dataspace disconnected', tone: 'neutral' },
  not_configured: { label: 'Dataspace not configured', tone: 'neutral' },
}

/** Delivery of operator messages to the machine builder. */
export const DELIVERY = {
  pending: { label: 'Pending', tone: 'attention' },
  delivered: { label: 'Delivered', tone: 'success' },
  failed: { label: 'Delivery failed', tone: 'danger' },
}

/** State of the machine-builder conversation. */
export const CONVERSATION = {
  open: { label: 'Open', tone: 'special' },
  direct_contact_operator: { label: 'Direct contact requested by you', tone: 'attention' },
  direct_contact_machine_builder: { label: 'Direct contact requested by the machine builder', tone: 'attention' },
  closed: { label: 'Closed', tone: 'neutral' },
}

/** Outcome of a past incident (the final state of its run). */
export const INCIDENT_OUTCOME = {
  completed: { label: 'Resolved', tone: 'success' },
  mb_closed: { label: 'Closed by machine builder', tone: 'special' },
  stopped: { label: 'Closed by operator', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
}

/** Confidence bands of agent output; the level label always accompanies the percentage. */
export const CONFIDENCE = {
  high: { label: 'High', tone: 'success', min: 0.7 },
  medium: { label: 'Medium', tone: 'attention', min: 0.4 },
  low: { label: 'Low', tone: 'danger', min: 0 },
}

/** Band of a confidence between 0 and 1: 'high', 'medium' or 'low'. */
export function confidenceLevel(value) {
  return Object.keys(CONFIDENCE).find((level) => Number(value) >= CONFIDENCE[level].min) ?? 'low'
}

/** Colour tone of a confidence's band ('neutral' when there is none). */
export function confidenceTone(value) {
  return value == null ? 'neutral' : CONFIDENCE[confidenceLevel(value)].tone
}

export const STATUS_KINDS = {
  run: RUN_STATUS, severity: SEVERITY, health: HEALTH, connection: CONNECTION,
  delivery: DELIVERY, conversation: CONVERSATION, outcome: INCIDENT_OUTCOME, confidence: CONFIDENCE,
}

export function describeStatus(kind, value) {
  const entry = STATUS_KINDS[kind]?.[value]
  if (entry) return entry
  const label = String(value ?? 'unknown').replace(/_/g, ' ')
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: 'neutral' }
}

/** Colour tone of a status, e.g. for the stripe of a list entry. */
export function toneOf(kind, value) {
  return describeStatus(kind, value).tone
}
