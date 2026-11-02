import { useCallback, useEffect, useState } from 'react'
import { runs } from './index'

const INITIAL = { phase: 'loading', run: null, connection: 'live', error: null }

/**
 * Reduces run-stream events into the state of one run view:
 *   phase       'loading' | 'ready' | 'error'
 *   run         the run (summary, status, data, steps, escalation, outbox)
 *   connection  'live' | 'reconnecting'
 *   error       DataError when phase is 'error'
 * A snapshot replaces everything known about the run.
 */
export function reduceRunEvent(state, event) {
  switch (event.type) {
    case 'snapshot':
      return { phase: 'ready', run: event.run, connection: 'live', error: null }
    case 'step': {
      if (!state.run) return state
      const { type: _type, ...step } = event
      const run = { ...state.run, steps: [...state.run.steps, step] }
      if (step.node === 'escalate' && !run.escalation) {
        const { escalationRef, recipient, tier, sent = [] } = step.output ?? {}
        run.escalation = { ref: escalationRef, recipient: { name: recipient }, tier, data: sent.map((label) => ({ label })), sentAt: step.at }
        run.escalationRef = escalationRef
      }
      return { ...state, run }
    }
    case 'status': {
      if (!state.run) return state
      const reopenable = ['stopped', 'mb_closed', 'failed'].includes(event.status) && !!state.run.escalation && event.data?.reopenable !== false
      return { ...state, run: { ...state.run, ...event.summary, status: event.status, data: event.data ?? {}, reopenable } }
    }
    case 'connection':
      return { ...state, connection: event.state === 'reconnecting' ? 'reconnecting' : 'live' }
    case 'error':
      return { ...state, phase: 'error', error: event.error }
    default:
      return state
  }
}

/** Subscribes to one run; `retry()` subscribes again after an error. */
export function useRun(runId) {
  const [state, setState] = useState(INITIAL)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setState(INITIAL)
    if (!runId) return undefined
    return runs.subscribeRun(runId, (event) => setState((s) => reduceRunEvent(s, event)))
  }, [runId, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { ...state, retry }
}
