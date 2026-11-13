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

/**
 * Live updates of the expanded entities. Returns the health (`off`,
 * `connecting`, `ok`, `unavailable`), the backend's reason (`detail`), and
 * `listen(entityId, onAttributes)`, with which each shown entity receives
 * its changed attributes; it returns the function that stops listening.
 * After a failure it checks again with a back-off and resubscribes once the
 * health check reports working again, and calls `onResync`: changes made
 * while the stream was down don't come again, so what is shown must be read again.
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
  const retry = useRef({ step: 0, timer: null })
  const idsKey = [...ids].sort().join('\n')

  const report = useCallback((next, reason = null) => {
    if (next === 'ok' && statusRef.current === 'unavailable') setAttempt((a) => a + 1)
    statusRef.current = next
    setStatus(next)
    setDetail(next === 'ok' ? null : reason)
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    statusRef.current = 'connecting'
    setStatus('connecting')
    const check = () => entities.getLiveUpdateHealth().then(
      (health) => { if (!cancelled) report(healthState(health), health?.detail ?? null) },
      (error) => { if (!cancelled) report('unavailable', error?.message ?? null) },
    )
    checkRef.current = check
    const pending = retry.current
    check()
    const timer = setInterval(check, HEALTH_POLL_MS)
    return () => {
      cancelled = true
      checkRef.current = null
      clearInterval(timer)
      clearTimeout(pending.timer)
    }
  }, [enabled, report])

  /** After the stream ended: check again after 1, 2, 5 and 10 s, until it works. */
  const scheduleRetry = useCallback(() => {
    clearTimeout(retry.current.timer)
    const step = retry.current.step
    if (step >= RECONNECT_MS.length) return
    retry.current.timer = setTimeout(() => {
      retry.current.step = step + 1
      Promise.resolve(checkRef.current?.()).then(() => { if (statusRef.current === 'unavailable') scheduleRetry() })
    }, RECONNECT_MS[step])
  }, [])

  useEffect(() => {
    if (!enabled || !idsKey) return undefined
    if (attempt > 0) onResyncRef.current?.()
    return entities.subscribeEntities({ ids: idsKey.split('\n') }, (event) => {
      if (event.type === 'error') {
        report('unavailable', event.error?.message ?? null)
        scheduleRetry()
      } else if (event.type === 'update') {
        listeners.current.get(event.entityId)?.forEach((fn) => fn(event.attributes))
        retry.current.step = 0
        if (statusRef.current !== 'ok') report('ok')
      }
    })
  }, [enabled, idsKey, attempt, report, scheduleRetry])

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
