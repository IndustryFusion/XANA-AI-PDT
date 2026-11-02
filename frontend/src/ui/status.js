/**
 * Text labels and colour tones for every status the UI shows.
 * A status is always rendered with its label; the tone only adds colour.
 */

export const RUN_STATUS = {
  running: { label: 'Running', tone: 'progress' },
  awaiting_input: { label: 'Needs input', tone: 'attention' },
  awaiting_confirmation: { label: 'Confirm resolution', tone: 'info' },
  awaiting_machine_builder: { label: 'Awaiting machine builder', tone: 'special' },
  awaiting_operator_approval: { label: 'Approval required', tone: 'warning' },
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

export const STATUS_KINDS = {
  run: RUN_STATUS, severity: SEVERITY, health: HEALTH, connection: CONNECTION,
  delivery: DELIVERY, conversation: CONVERSATION, outcome: INCIDENT_OUTCOME,
}

export function describeStatus(kind, value) {
  const entry = STATUS_KINDS[kind]?.[value]
  if (entry) return entry
  const label = String(value ?? 'unknown').replace(/_/g, ' ')
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: 'neutral' }
}
