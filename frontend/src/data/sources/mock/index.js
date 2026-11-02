/**
 * Mock data source: implements the UI data interface in the browser with a
 * deterministic seed, so the UI runs without any backend.
 */
import { createAreas, MOCK_CREDENTIALS } from './areas'
import { createStore } from './store'
import DevControlsPanel from './DevControls'

const store = createStore()
const areas = createAreas(store)

export const info = {
  name: 'mock',
  signInHint: `Mock data: sign in as ${MOCK_CREDENTIALS.username} / ${MOCK_CREDENTIALS.password}`,
}

export const { session, runs, alerts, entities, dataspace, system } = areas

/** The mock's store, for tests that need to arrange data. */
export { store }

// Resolved at build time so production bundles do not contain the panel.
export const DevControls = import.meta.env.DEV ? DevControlsPanel : null
