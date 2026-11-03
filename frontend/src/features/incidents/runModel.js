/** Values the run view derives from a run's steps and status. */
import { humanize } from '../../ui/format'

export const OPEN_STATES = [
  'running', 'awaiting_input', 'awaiting_confirmation', 'awaiting_machine_builder',
  'awaiting_operator_approval', 'awaiting_recommendation_review',
]
export const FINISHED_STATES = ['completed', 'failed', 'stopped', 'mb_closed']

export const isOpen = (status) => OPEN_STATES.includes(status)

const STEP_LABELS = {
  observe: 'Observe',
  hypothesize: 'Hypothesize',
  validate: 'Validate',
  decide: 'Decide',
  act: 'Act',
  policy_check: 'Policy check',
  clarification: 'Clarification',
  resolution: 'Resolution',
  escalate: 'Escalation',
  suggest: 'Suggested actions',
  message: 'Message',
}

export const stepLabel = (node) => STEP_LABELS[node] ?? humanize(node)

/** Steps shown in the diagnostics feed (conversation messages have their own view). */
export const feedSteps = (steps = []) => steps.filter((s) => s.node !== 'message')

const latest = (steps, test) => [...steps].reverse().find(test) ?? null

/** Current hypotheses: the validated set once validation completed, otherwise the latest proposal. */
export function currentHypotheses(steps = []) {
  const step = latest(steps, (s) => s.node === 'hypothesize' || s.node === 'validate')
  if (!step) return null
  const hypotheses = [...(step.output?.hypotheses ?? [])].sort((a, b) => b.confidence - a.confidence)
  return { validated: step.node === 'validate', hypotheses }
}

/** The latest decision with a root cause, or null. */
export function currentDecision(steps = []) {
  return latest(steps, (s) => s.node === 'decide' && s.output?.rootCause)?.output ?? null
}

export function latestSuggestions(steps = []) {
  return latest(steps, (s) => s.node === 'suggest')?.output?.suggestions ?? []
}
