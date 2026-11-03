/**
 * Mock data source: implements the UI data interface in the browser with a
 * deterministic seed and a simulated run engine, so the UI runs without any
 * backend.
 */
import { MOCK_CREDENTIALS } from './areas'
import { areas, engine, raiseAlert, store } from './instance'
import DevControlsPanel from './DevControls'

export const info = {
  name: 'mock',
  signInHint: `Mock data: sign in as ${MOCK_CREDENTIALS.username} / ${MOCK_CREDENTIALS.password}`,
}

export const { session, runs, incidents, alerts, entities, dataspace, system } = areas

/** The mock's store, run engine and alert generator, for tests that need to arrange data. */
export { store, engine, raiseAlert }

// Resolved at build time so production bundles do not contain the panel.
export const DevControls = import.meta.env.DEV ? DevControlsPanel : null
