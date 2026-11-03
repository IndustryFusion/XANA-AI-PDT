import { useCallback, useEffect, useRef, useState } from 'react'
import { areas } from './index'

/**
 * Loads one data-interface operation and tracks its state.
 *
 *   const result = useData('alerts', 'countAlerts', [{ status: ['open'] }], { refreshMs: 30000 })
 *   result.status  'loading' | 'success' | 'error'
 *   result.data    last successful result (kept while reloading)
 *   result.error   DataError when status is 'error'
 *   result.retry() / result.refresh()  load again
 *
 * Each call is isolated: an error in one area never affects another.
 */
export function useData(area, op, args = [], { refreshMs = 0, enabled = true, refreshKey = 0 } = {}) {
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

  return { ...state, retry: refresh, refresh }
}
