import { useCallback, useEffect, useRef, useState } from 'react'
import { entities } from '../../data'

/** How often the health of live updates is checked while they are on. */
export const HEALTH_POLL_MS = 10_000

/**
 * Live updates of the expanded entities. Returns the health (`off`,
 * `connecting`, `ok`, `unavailable`) and `listen(entityId, onAttributes)`,
 * with which each shown entity receives its changed attributes; it returns
 * the function that stops listening. After a failure it resubscribes once
 * the health check reports `ok` again.
 */
export function useLiveUpdates({ enabled, ids = [] }) {
  const [status, setStatus] = useState('connecting')
  const [attempt, setAttempt] = useState(0)
  const statusRef = useRef(status)
  const listeners = useRef(new Map())
  const idsKey = [...ids].sort().join('\n')

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
    if (!enabled || !idsKey) return undefined
    return entities.subscribeEntities({ ids: idsKey.split('\n') }, (event) => {
      if (event.type === 'error') report('unavailable')
      else if (event.type === 'update') {
        listeners.current.get(event.entityId)?.forEach((fn) => fn(event.attributes))
        if (statusRef.current !== 'ok') report('ok')
      }
    })
  }, [enabled, idsKey, attempt, report])

  const listen = useCallback((entityId, fn) => {
    const map = listeners.current
    if (!map.has(entityId)) map.set(entityId, new Set())
    map.get(entityId).add(fn)
    return () => {
      map.get(entityId)?.delete(fn)
      if (map.get(entityId)?.size === 0) map.delete(entityId)
    }
  }, [])

  return { status: enabled ? status : 'off', listen }
}
