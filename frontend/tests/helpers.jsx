import { render } from '@testing-library/react'
import App from '../src/App'
import { store } from '../src/data/sources/mock'
import { writeControls } from '../src/data/sources/mock/controls'
import { urn } from '../src/data/sources/mock/catalog'
import { createRunRecord, simulate } from '../src/data/sources/mock/runCore'
import { RouterProvider } from '../src/app/router'

/** Resets the mock store and puts the browser at `path`. */
export function resetMock({ path = '/', controls } = {}) {
  store.reset()
  if (controls) writeControls(controls)
  window.history.replaceState(null, '', path)
}

/** Renders the whole application at `path`. */
export function renderApp({ path = '/', controls, sessionCheckMs } = {}) {
  resetMock({ path, controls })
  return render(<App sessionCheckMs={sessionCheckMs} />)
}

/**
 * Resets the mock, arranges data with `arrange()` (which may return a run ID
 * to open), then renders the application at that run or at `path`.
 */
export function renderAppWith(arrange, { path, controls, sessionCheckMs } = {}) {
  resetMock({ controls })
  const runId = arrange()
  window.history.replaceState(null, '', path ?? `/incidents/${encodeURIComponent(runId)}`)
  return render(<App sessionCheckMs={sessionCheckMs} />)
}

/** Renders a component inside the router, at `path`. */
export function renderWithRouter(ui, { path = '/' } = {}) {
  window.history.replaceState(null, '', path)
  return render(<RouterProvider>{ui}</RouterProvider>)
}

export function signInMock() {
  store.update((s) => { s.session = { signedIn: true, revision: 0 }; return s })
}

/**
 * Adds a run to the mock store, played synchronously through its scenario
 * with the given operator actions (`[name, args]`). Returns the run ID.
 */
export function addRun({ scenario = 'happy_path', machine = 'laser-cutter-01', issue = 'Test issue', actions = [], connected = true } = {}) {
  let runId
  const start = Date.now() - 60 * 60_000
  store.update((s) => {
    runId = `run-${s.counters.run++}`
    const run = createRunRecord({ runId, machineId: urn('Machine', machine), issue, scenario, at: new Date(start).toISOString() })
    simulate(run, { state: s, connected }, actions, { t: start, scale: 1 })
    s.runs.push(run)
    return s
  })
  return runId
}

export const findRun = (runId) => store.get().runs.find((r) => r.runId === runId)
