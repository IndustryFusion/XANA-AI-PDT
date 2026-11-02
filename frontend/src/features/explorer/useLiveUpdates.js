import { useCallback, useEffect, useRef, useState } from 'react'
import { entities } from '../../data'

/** How often the health of live updates is checked while they are on. */
export const HEALTH_POLL_MS = 10_000

/**
 * Live updates of the shown entity. Returns the health (`off`, `connecting`,
 * `ok`, `unavailable`) and the latest update `{ entityId, attributes, seq }`.
 * After a failure it resubscribes once the health check reports `ok` again.
 */
export function useLiveUpdates({ enabled, entityId }) {
  const [status, setStatus] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const statusRef = useRef(status)
  const seq = useRef(0)

  const report = useCallback((next) => {
    if (next === 'ok' && statusRef.current === 'unavailable') setAttempt((a) => a + 1)
    statusRef.current = next
    setStatus(next)
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    statusRef.current = 'connecting'
    setStatus('connecting')
    const check = () => entities.getLiveUpdateHealth().then(
      (health) => { if (!cancelled) report(health.status === 'ok' ? 'ok' : 'unavailable') },
      () => { if (!cancelled) report('unavailable') },
    )
    check()
    const timer = setInterval(check, HEALTH_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, report])

  useEffect(() => {
    if (!enabled || !entityId) return undefined
    return entities.subscribeEntities({ ids: [entityId] }, (event) => {
      if (event.type === 'error') report('unavailable')
      else if (event.type === 'update') {
        seq.current += 1
        setLastUpdate({ entityId: event.entityId, attributes: event.attributes, seq: seq.current })
        if (statusRef.current !== 'ok') report('ok')
      }
    })
  }, [enabled, entityId, attempt, report])

  return { status: enabled ? status : 'off', lastUpdate }
}
