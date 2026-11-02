import { render } from '@testing-library/react'
import App from '../src/App'
import { store } from '../src/data/sources/mock'
import { writeControls } from '../src/data/sources/mock/controls'
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

/** Renders a component inside the router, at `path`. */
export function renderWithRouter(ui, { path = '/' } = {}) {
  window.history.replaceState(null, '', path)
  return render(<RouterProvider>{ui}</RouterProvider>)
}

export function signInMock() {
  store.update((s) => { s.session = { signedIn: true, revision: 0 }; return s })
}
