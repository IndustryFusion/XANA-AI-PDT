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

import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeControls } from '../../src/data/sources/mock/controls'
import { renderApp } from '../helpers'

async function signIn(user, password = 'operator') {
  await user.type(screen.getByLabelText('Username'), 'operator')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('without a session the sign-in screen is shown and names the provider', async () => {
  renderApp({ path: '/alerts' })
  expect(await screen.findByRole('heading', { name: 'XANA AI PDT' })).toBeVisible()
  expect(screen.getByText('Sign in with Mock identity provider')).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
})

test('signing in opens the requested screen', async () => {
  const user = userEvent.setup()
  renderApp({ path: '/alerts' })
  await screen.findByLabelText('Username')
  await signIn(user)
  expect(await screen.findByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible()
  expect(window.location.pathname).toBe('/alerts')
})

test('wrong credentials keep the sign-in screen with a specific message', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findByLabelText('Username')
  await signIn(user, 'wrong')
  expect(await screen.findByRole('alert')).toHaveTextContent('Username or password is not correct.')
  expect(screen.getByLabelText('Username')).toBeVisible()
})

test('an unreachable identity provider gets a different message', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findByLabelText('Username')
  writeControls({ failure: { session: 'unavailable' } })
  await signIn(user)
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be reached')
})

test('with authentication disabled the application opens directly', async () => {
  renderApp({ controls: { authEnabled: false } })
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
})

test('an expired session returns to sign-in and then to the same screen', async () => {
  const user = userEvent.setup()
  renderApp({ path: '/dataspace', sessionCheckMs: 50 })
  await screen.findByLabelText('Username')
  await signIn(user)
  expect(await screen.findByRole('heading', { name: 'Dataspace', level: 1 })).toBeVisible()

  writeControls({ sessionRevision: 1 })
  await act(() => new Promise((r) => setTimeout(r, 120)))
  expect(await screen.findByLabelText('Username')).toBeVisible()

  await signIn(user)
  expect(await screen.findByRole('heading', { name: 'Dataspace', level: 1 })).toBeVisible()
  expect(window.location.pathname).toBe('/dataspace')
})

test('signing out ends the session and shows the sign-in screen', async () => {
  const user = userEvent.setup()
  renderApp()
  await screen.findByLabelText('Username')
  await signIn(user)
  await user.click(await screen.findByRole('button', { name: /account and factory details/ }))
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(await screen.findByLabelText('Username')).toBeVisible()
})

test('a session service that cannot be reached at start offers retry', async () => {
  const user = userEvent.setup()
  renderApp({ controls: { failure: { session: 'unavailable' } } })
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot check your session')
  writeControls({ failure: {} })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByLabelText('Username')).toBeVisible()
})
