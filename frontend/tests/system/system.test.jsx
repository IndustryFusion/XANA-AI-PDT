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

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { renderApp, renderAppWith, signInMock } from '../helpers'

const open = (controls = {}) => renderApp({ path: '/system', controls: { authEnabled: false, ...controls } })
const region = (name) => screen.findByRole('region', { name })
const checkRow = (id) => document.querySelector(`.health-table tr[data-check="${id}"]`)
const settingField = (key) => document.querySelector(`[data-setting="${key}"]`)

async function healthTable() {
  const health = await region('Dependency health')
  await within(health).findByRole('table')
  return health
}

describe('dependency health', () => {
  test('all healthy: each dependency shows OK with its latency, and overall health is OK', async () => {
    open()
    const health = await healthTable()
    expect(within(health).getByText('Overall health: OK')).toBeVisible()
    const rows = within(health).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(store.get().health.length)
    for (const { id, label, latencyMs } of store.get().health) {
      expect(within(checkRow(id)).getByText(label)).toBeVisible()
      expect(within(checkRow(id)).getByText('OK')).toBeVisible()
      expect(within(checkRow(id)).getByText(`${latencyMs} ms`)).toBeVisible()
    }
    expect(within(checkRow('context-broker')).getByText(/Reached at http:\/\/context-broker\.example\.org/)).toBeVisible()
    expect(within(health).getByText(/Checked at/).querySelector('time')).toHaveAttribute('dateTime')
  })

  test('models: the agent\'s model is shown with its provider and availability', async () => {
    open()
    const health = await healthTable()
    const models = within(health).getByTestId('health-models')
    expect(within(models).getByText('llama3.1')).toBeVisible()
    expect(within(models).getByText(/Agent · Ollama/)).toBeVisible()
    expect(within(models).getByText('Available')).toBeVisible()
  })

  test('one dependency down: error with the detail, overall degraded, the others still shown', async () => {
    open({ gatewayReachable: false })
    const health = await healthTable()
    expect(within(health).getByText('Overall health: Degraded')).toBeVisible()
    expect(within(checkRow('gateway')).getByText('Error')).toBeVisible()
    expect(within(checkRow('gateway')).getByText('Not reachable (simulated failure).')).toBeVisible()
    expect(within(checkRow('timeseries')).getByText('OK')).toBeVisible()
    expect(within(health).getAllByText('OK')).toHaveLength(store.get().health.length - 1)
  })

  describe('check again', () => {
    afterEach(() => vi.useRealTimers())

    test('checks all dependencies anew and updates the time of the check', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      open()
      const health = await healthTable()
      const time = () => within(health).getByText(/Checked at/).querySelector('time').getAttribute('dateTime')
      const first = time()
      await act(() => vi.advanceTimersByTimeAsync(5000))
      act(() => { writeControls({ gatewayReachable: false }) })
      await user.click(within(health).getByRole('button', { name: 'Check again' }))
      await waitFor(() => expect(time()).not.toBe(first))
      expect(Date.parse(time()) - Date.parse(first)).toBeGreaterThanOrEqual(5000)
      expect(within(checkRow('gateway')).getByText('Error')).toBeVisible()
    })
  })
})

describe('service settings', () => {
  test('shows the addresses in use, all from the deployment', async () => {
    open()
    const settings = await region('Service settings')
    for (const label of ['Context broker', 'Time-series store', 'Message broker', 'Alert manager']) expect(await within(settings).findByLabelText(label)).toBeVisible()
    expect(within(settings).getByLabelText('Message broker')).toHaveValue('mqtt://message-broker.example.org:1883')
    expect(within(settings).getAllByText('Deployment value')).toHaveLength(4)
  })

  test('a valid address is saved, marked as changed, and used by the next health check', async () => {
    const user = userEvent.setup()
    open()
    const settings = await region('Service settings')
    const field = await within(settings).findByLabelText('Context broker')
    await user.clear(field)
    await user.type(field, 'https://broker-2.example.org/ngsi-ld/v1')
    await user.click(within(settings).getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(within(settingField('contextBroker')).getByText('Changed')).toBeVisible())
    expect(within(settingField('contextBroker')).getByText('http://context-broker.example.org:9090/ngsi-ld/v1')).toBeVisible()
    expect(store.get().settings).toEqual({ contextBroker: 'https://broker-2.example.org/ngsi-ld/v1' })
    await waitFor(() => expect(within(checkRow('context-broker')).getByText('Reached at https://broker-2.example.org/ngsi-ld/v1')).toBeVisible())
  })

  test('an address that is not a valid URL is refused and the field shows the problem', async () => {
    const user = userEvent.setup()
    open()
    const settings = await region('Service settings')
    const field = await within(settings).findByLabelText('Alert manager')
    await user.clear(field)
    await user.type(field, 'alert manager on port 8080')
    await user.click(within(settings).getByRole('button', { name: 'Save settings' }))
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Not a valid URL/)
    expect(within(settings).getByRole('alert')).toHaveTextContent('Not saved')
    expect(store.get().settings).toEqual({})

    await user.clear(field)
    await user.type(field, 'ftp://alerts.example.org')
    await user.click(within(settings).getByRole('button', { name: 'Save settings' }))
    expect(field).toHaveAccessibleDescription('Use one of the schemes http, https, ws, wss, mqtt.')
    expect(store.get().settings).toEqual({})
  })

  test('resetting a changed setting uses the deployment value again', async () => {
    const user = userEvent.setup()
    renderAppWith(() => { store.update((s) => { s.settings.messageBroker = 'mqtt://other.example.org:1883'; return s }) }, { path: '/system', controls: { authEnabled: false } })
    const settings = await region('Service settings')
    expect(await within(settings).findByLabelText('Message broker')).toHaveValue('mqtt://other.example.org:1883')
    await user.click(within(settings).getByRole('button', { name: 'Reset to deployment value: Message broker' }))
    await waitFor(() => expect(within(settings).getByLabelText('Message broker')).toHaveValue('mqtt://message-broker.example.org:1883'))
    expect(within(settingField('messageBroker')).getByText('Deployment value')).toBeVisible()
    expect(store.get().settings).toEqual({})
    await waitFor(() => expect(within(checkRow('message-broker')).getByText('Reached at mqtt://message-broker.example.org:1883')).toBeVisible())
  })
})

describe('session', () => {
  test('shows the identity provider, the user and an active session', async () => {
    renderAppWith(signInMock, { path: '/system' })
    const session = await region('Session')
    expect(await within(session).findByText('Mock identity provider')).toBeVisible()
    expect(within(session).getByText('Alex Operator')).toBeVisible()
    expect(await within(session).findByText('Active')).toBeVisible()
  })

  test('shows when sign-in is not required', async () => {
    open()
    expect(await within(await region('Session')).findByText('Sign-in not required')).toBeVisible()
  })
})
