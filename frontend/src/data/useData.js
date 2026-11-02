import { useCallback, useEffect, useRef, useState } from 'react'
import { areas, onDataEvent } from './index'

const NO_EVENTS = []

/**
 * Loads one data-interface operation and tracks its state.
 *
 *   const result = useData('alerts', 'countAlerts', [{ status: ['open'] }], { refreshMs: 30000 })
 *   result.status  'loading' | 'success' | 'error'
 *   result.data    last successful result (kept while reloading)
 *   result.error   DataError when status is 'error'
 *   result.retry() / result.refresh()  load again
 *
 * `refreshOn` lists facade events (e.g. CONNECTION_CHANGED) that reload it at once.
 * Each call is isolated: an error in one area never affects another.
 */
export function useData(area, op, args = [], { refreshMs = 0, enabled = true, refreshKey = 0, refreshOn = NO_EVENTS } = {}) {
  const [state, setState] = useState({ status: 'loading', data: undefined, error: null })
  const [tick, setTick] = useState(0)
  const argsKey = JSON.stringify(args)
  const argsRef = useRef(args)
  argsRef.current = args

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading', error: null }))
    Promise.resolve()
      .then(() => areas[area][op](...argsRef.current))
      .then(
        (data) => { if (!cancelled) setState({ status: 'success', data, error: null }) },
        (error) => { if (!cancelled) setState((s) => ({ status: 'error', data: s.data, error })) },
      )
    return () => { cancelled = true }
  }, [area, op, argsKey, enabled, tick, refreshKey])

  useEffect(() => {
    if (!enabled || !refreshMs) return undefined
    const id = setInterval(refresh, refreshMs)
    return () => clearInterval(id)
  }, [enabled, refreshMs, refresh])

  const eventsKey = refreshOn.join(',')
  useEffect(() => {
    if (!enabled || !eventsKey) return undefined
    const offs = eventsKey.split(',').map((event) => onDataEvent(event, refresh))
    return () => offs.forEach((off) => off())
  }, [enabled, eventsKey, refresh])

  return { ...state, retry: refresh, refresh }
}
