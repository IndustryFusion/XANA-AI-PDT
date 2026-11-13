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

import { useCallback, useEffect, useRef, useState } from 'react'
import { entities } from '../../data'

/** How often the health of live updates is checked while they are on. */
export const HEALTH_POLL_MS = 10_000
/** Back-off of the checks after the stream ended, before the regular poll takes over again. */
export const RECONNECT_MS = [1000, 2000, 5000, 10_000]

/**
 * The indicator's state for the backend's health answer: working while it is
 * `active`, connecting while it is being set up (also while it still waits
 * for the sign-in this UI already has), and unavailable otherwise. Without a
 * `state`, the `status` decides.
 */
export function healthState(health) {
  const state = health?.state
  if (state === 'active') return 'ok'
  if (state === 'connecting' || state === 'waiting_for_sign_in') return 'connecting'
  if (state) return 'unavailable'
  return health?.status === 'ok' ? 'ok' : 'unavailable'
}

/** How long a reopened stream must stay open without failing to count as working again. */
export const STABLE_MS = 30_000
/** What the indicator says once the stream kept failing while the backend reported it working. */
export const GAVE_UP = 'The live update stream keeps closing. Switch live updates off and on to try again.'

/**
 * Live updates of the expanded entities. Returns the health (`off`,
 * `connecting`, `ok`, `unavailable`), the backend's reason (`detail`), and
 * `listen(entityId, onAttributes)`, with which each shown entity receives
 * its changed attributes; it returns the function that stops listening.
 *
 * Changes may be missed when the stream ends, or when the backend reports
 * live updates unavailable while it stays open. Once they work again,
 * however they recovered, the stream is opened again and `onResync` is
 * called, as changes from the gap don't come again.
 *
 * A stream that fails at once although the backend says it works is tried
 * again after 1, 2, 5 and 10 s, and then no more: the indicator then says
 * so, until the backend reports an outage of its own or sets live updates
 * up again (whose recovery is tried again), they are switched off and on,
 * or the page is reloaded. A stream proves itself, and the count starts
 * afresh, when an update arrives or it stays open for `STABLE_MS`.
 */
export function useLiveUpdates({ enabled, ids = [], onResync }) {
  const [status, setStatus] = useState('connecting')
  const [detail, setDetail] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const statusRef = useRef(status)
  const onResyncRef = useRef(onResync)
  onResyncRef.current = onResync
  const listeners = useRef(new Map())
  const checkRef = useRef(null)
  const timers = useRef({ retry: null, stable: null })
  const gap = useRef(false)
  // Stream failures since it last proved itself; past the back-off, it is given up.
  const failures = useRef(0)
  const idsKey = [...ids].sort().join('\n')

  const show = useCallback((next, reason) => {
    statusRef.current = next
    setStatus(next)
    setDetail(next === 'ok' ? null : reason)
  }, [])

  /** What the health check reports. */
  const reportHealth = useCallback((next, reason = null) => {
    if (next !== 'ok') {
      // The backend's own outage, or it is setting live updates up again: its recovery is tried
      // again, however often the stream failed before.
      gap.current = true
      failures.current = 0
    }
    if (next === 'ok' && gap.current) {
      if (failures.current > RECONNECT_MS.length) { show('unavailable', GAVE_UP); return }
      gap.current = false
      setAttempt((a) => a + 1)
    }
    show(next, reason)
  }, [show])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    // Switched on (again): start afresh, also after the stream was given up.
    gap.current = false
    failures.current = 0
    statusRef.current = 'connecting'
    setStatus('connecting')
    setDetail(null)
    const check = () => entities.getLiveUpdateHealth().then(
      (health) => { if (!cancelled) reportHealth(healthState(health), health?.detail ?? null) },
      (error) => { if (!cancelled) reportHealth('unavailable', error?.message ?? null) },
    )
    checkRef.current = check
    const pending = timers.current
    check()
    const timer = setInterval(check, HEALTH_POLL_MS)
    return () => {
      cancelled = true
      checkRef.current = null
      clearInterval(timer)
      clearTimeout(pending.retry)
      clearTimeout(pending.stable)
    }
  }, [enabled, reportHealth])

  useEffect(() => {
    if (!enabled || !idsKey) return undefined
    if (attempt > 0) onResyncRef.current?.()
    const t = timers.current
    const proven = () => { failures.current = 0 }
    clearTimeout(t.stable)
    t.stable = setTimeout(proven, STABLE_MS)
    const stop = entities.subscribeEntities({ ids: idsKey.split('\n') }, (event) => {
      if (event.type === 'error') {
        clearTimeout(t.stable)
        gap.current = true
        failures.current += 1
        show('unavailable', event.error?.message ?? null)
        // Check again after the next step of the back-off; past its end the regular poll alone goes on.
        const wait = RECONNECT_MS[failures.current - 1]
        clearTimeout(t.retry)
        if (wait !== undefined) t.retry = setTimeout(() => checkRef.current?.(), wait)
      } else if (event.type === 'update') {
        proven()
        listeners.current.get(event.entityId)?.forEach((fn) => fn(event.attributes))
        if (statusRef.current !== 'ok') show('ok')
      }
    })
    return () => {
      clearTimeout(t.stable)
      stop()
    }
  }, [enabled, idsKey, attempt, show])

  const listen = useCallback((entityId, fn) => {
    const map = listeners.current
    if (!map.has(entityId)) map.set(entityId, new Set())
    map.get(entityId).add(fn)
    return () => {
      map.get(entityId)?.delete(fn)
      if (map.get(entityId)?.size === 0) map.delete(entityId)
    }
  }, [])

  return { status: enabled ? status : 'off', detail: enabled ? detail : null, listen }
}
