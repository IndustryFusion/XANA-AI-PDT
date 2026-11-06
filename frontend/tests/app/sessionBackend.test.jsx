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

import { render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { SessionGate, useSession } from '../../src/app/session'

// The real session gate on the backend's session area, with only `fetch` replaced.
vi.mock('../../src/data', async (original) => {
  const { session } = await import('../../src/data/sources/backend/session')
  return { ...(await original()), session }
})

const status = (name = 'Op Erator') => ({
  valid: true,
  user: { username: 'op', name, email: '' },
  factory_id: null,
  company_id: null,
  token_expires_in_s: 200,
})

const NO_SESSION = { valid: false, user: null, factory_id: null, company_id: null, token_expires_in_s: null }

/** Answers like a backend, or as a proxy in front of a stopped one. */
function backend(answers) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = new URL(url, 'http://ui.test').pathname
    if (answers === 'stopped') return new Response('Bad gateway', { status: 502 })
    if (answers === 'refused') throw new TypeError('connection refused')
    return new Response(JSON.stringify(answers[path]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
}

function App() {
  const { session, authEnabled, backendUnreachable } = useSession()
  return <p>App open, user {session?.user?.name ?? 'none'}, sign-in {authEnabled ? 'on' : 'off'}, backend {backendUnreachable ? 'unreachable' : 'answered'}</p>
}

const signInOn = { '/api/auth/config': { enabled: true, provider: 'Keycloak' }, '/api/auth/status': NO_SESSION }
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

afterEach(() => vi.unstubAllGlobals())

// The source remembers that the backend has answered, so this one flow runs in order.
test('a stopped backend opens the app, is found again, and then later failures do not sign anyone out', async () => {
  // At load, a proxy answers for a stopped backend: the app opens, as other areas still work.
  backend('stopped')
  const { unmount } = render(<SessionGate checkIntervalMs={30}><App /></SessionGate>)
  expect(await screen.findByText(/App open, user none, sign-in off, backend unreachable/)).toBeVisible()

  // It stays that way while the backend is away, without reporting sign-in as off for good.
  await wait(90)
  expect(screen.getByText(/backend unreachable/)).toBeVisible()

  // The backend returns with sign-in on: the sign-in screen appears, with no reload.
  backend(signInOn)
  expect(await screen.findByLabelText('Username')).toBeVisible()
  unmount()

  // Now signed in. A failed read of the configuration or the session keeps the app open.
  backend({ ...signInOn, '/api/auth/status': status() })
  const again = render(<SessionGate checkIntervalMs={30}><App /></SessionGate>)
  expect(await screen.findByText(/App open, user Op Erator, sign-in on, backend answered/)).toBeVisible()
  backend('stopped')
  const { session } = await import('../../src/data/sources/backend/session')
  await expect(session.getAuthConfig()).rejects.toMatchObject({ kind: 'unavailable' })
  await wait(120)
  expect(screen.getByText(/App open, user Op Erator/)).toBeVisible()
  expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()

  backend('refused')
  await wait(120)
  expect(screen.getByText(/App open, user Op Erator/)).toBeVisible()

  // Another operator signs in on the shared session: the header's name follows.
  backend({ ...signInOn, '/api/auth/status': status('Second Operator') })
  await waitFor(() => expect(screen.getByText(/App open, user Second Operator/)).toBeVisible())

  // The session ends: the next check asks for sign-in.
  backend(signInOn)
  expect(await screen.findByLabelText('Username')).toBeVisible()
  again.unmount()
})
