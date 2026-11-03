/**
 * Mock run engine: plays the queued scenario events of every run with
 * timers scaled by the playback speed, stores each change in the mock store
 * (so `getRun` and reloads see the same state) and notifies subscribers.
 *
 * "Interrupting" a run's connection stops event delivery to its subscribers
 * while the run keeps going; restoring it sends a fresh snapshot.
 */
import { DataError } from '../../errors'
import { applyNext, performAction, toRun } from './runCore'

export function createRunEngine(store, { speed = () => 1, connected = () => true, now = () => Date.now() } = {}) {
  const timers = new Map()
  const listeners = new Map()
  const interrupted = new Set()

  const findRun = (state, runId) => state.runs.find((r) => r.runId === runId)
  const env = (state) => ({ state, connected: connected() })
  const iso = () => new Date(now()).toISOString()

  function emit(runId, events) {
    if (interrupted.has(runId)) return
    for (const listener of listeners.get(runId) ?? []) events.forEach((e) => listener(e))
  }

  function clear(runId) {
    clearTimeout(timers.get(runId))
    timers.delete(runId)
  }

  /** Starts the timer for a run's next queued event, unless one is running. */
  function schedule(runId) {
    if (timers.has(runId)) return
    const run = findRun(store.get(), runId)
    if (!run?.queue?.length) return
    const factor = Math.max(Number(speed()) || 1, 0.01)
    const delay = (run.queue[0].delay ?? 0) / factor
    timers.set(runId, setTimeout(() => {
      timers.delete(runId)
      advance(runId)
    }, delay))
  }

  function advance(runId) {
    let events = []
    store.update((state) => {
      const run = findRun(state, runId)
      if (run?.queue?.length) events = applyNext(run, iso(), env(state))
      return state
    })
    emit(runId, events)
    schedule(runId)
  }

  return {
    /** Makes sure queued events of a run (or of every run) are being played. */
    ensure(runId) { schedule(runId) },
    ensureAll() { store.get().runs.forEach((r) => schedule(r.runId)) },

    /** Adds a run record and starts playing it. */
    add(run) {
      store.update((state) => { state.runs.push(run); return state })
      schedule(run.runId)
    },

    /** Performs an operator action; resolves with its result or throws a DataError. */
    perform(runId, action, args) {
      let outcome
      store.update((state) => {
        const run = findRun(state, runId)
        if (!run) throw new DataError('runs', 'not_found', `Run ${runId} is not active.`)
        outcome = performAction(run, action, args, iso(), env(state))
        return state
      })
      const run = findRun(store.get(), runId)
      if (!run.queue.length) clear(runId)
      emit(runId, outcome.events)
      schedule(runId)
      return outcome.result
    },

    /** Removes a run from playback (archive). */
    remove(runId) {
      clear(runId)
      interrupted.delete(runId)
    },

    snapshot(runId) {
      const run = findRun(store.get(), runId)
      return run ? toRun(run) : null
    },

    subscribe(runId, listener) {
      if (!listeners.has(runId)) listeners.set(runId, new Set())
      listeners.get(runId).add(listener)
      schedule(runId)
      return () => listeners.get(runId)?.delete(listener)
    },

    isInterrupted: (runId) => interrupted.has(runId),

    /** Drops the live connection of a run: subscribers learn it is reconnecting. */
    interrupt(runId) {
      if (interrupted.has(runId)) return
      for (const listener of listeners.get(runId) ?? []) listener({ type: 'connection', state: 'reconnecting' })
      interrupted.add(runId)
    },

    /** Restores the connection: subscribers get the run's current state. */
    restore(runId) {
      if (!interrupted.delete(runId)) return
      const run = findRun(store.get(), runId)
      for (const listener of listeners.get(runId) ?? []) {
        listener(run ? { type: 'snapshot', run: toRun(run) } : { type: 'error', error: new DataError('runs', 'not_found', `Run ${runId} is not active.`) })
      }
    },

    /** Stops every timer (store reset). */
    reset() {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      interrupted.clear()
    },
  }
}
