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
import { MOCK_DATASPACE_SECRET } from '../../src/data/sources/mock/dataspaceArea'
import { writeControls } from '../../src/data/sources/mock/controls'
import { renderApp, renderAppWith } from '../helpers'
import { dataspace } from '../../src/data'

const open = (path = '/dataspace', controls = {}) => renderApp({ path, controls: { authEnabled: false, ...controls } })
const region = (name) => screen.findByRole('region', { name })
const banner = () => document.querySelector('.app-header')
const request = (id) => store.get().dataspace.capabilityRequests.find((r) => r.id === id)
const capabilityRow = (caption, capability) => within(screen.getByRole('table', { name: caption })).getAllByRole('row').find((r) => r.dataset.capability === capability)
const HERE = 'What Formwerk Press Technology may access here'

describe('connection', () => {
  test('connected: state, session expiry, participant and factory, with a disconnect action', async () => {
    open()
    const connection = await region('Connection')
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
    expect(within(connection).getByText('Session valid until')).toBeVisible()
    expect(connection.querySelector('time')).toHaveAttribute('dateTime', store.get().connection.expiresAt)
    expect(within(connection).getByText('participant-plant-north')).toBeVisible()
    expect(await within(connection).findByText('Plant North')).toBeVisible()
    expect(within(connection).getByRole('button', { name: 'Disconnect…' })).toBeVisible()
    expect(within(connection).queryByLabelText('Dataspace credential')).not.toBeInTheDocument()
  })

  test('disconnect after confirmation: state, header indicator and peers update', async () => {
    const user = userEvent.setup()
    open()
    await region('Compatible peers')
    expect(await within(banner()).findByText('Dataspace connected')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Disconnect…' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect from the dataspace?' })
    expect(store.get().connection.state).toBe('connected')
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(await within(await region('Connection')).findByText('Dataspace disconnected')).toBeVisible()
    expect(within(banner()).getByText('Dataspace disconnected')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Compatible peers' })).not.toBeInTheDocument()
    expect(screen.getByText(/Not available while the dataspace is not connected/)).toBeVisible()
  })

  test('connect with a credential when the configuration provides none', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected' })
    const connection = await region('Connection')
    await user.type(await within(connection).findByLabelText('Dataspace credential'), MOCK_DATASPACE_SECRET)
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
    expect(within(banner()).getByText('Dataspace connected')).toBeVisible()
    expect(await region('Compatible peers')).toBeVisible()
  })

  test('without a credential field when the configuration provides it', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected', credentialConfigured: true })
    const connection = await region('Connection')
    expect(await within(connection).findByText('The credential is provided by the configuration.')).toBeVisible()
    expect(within(connection).queryByLabelText('Dataspace credential')).not.toBeInTheDocument()
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
  })

  test('a rejected credential and an unreachable gateway give different messages and keep the form', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected' })
    const connection = await region('Connection')
    const secret = await within(connection).findByLabelText('Dataspace credential')
    await user.type(secret, 'wrong')
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByRole('alert')).toHaveTextContent('The dataspace rejected the credential.')
    expect(secret).toHaveAttribute('aria-invalid', 'true')

    act(() => { writeControls({ gatewayReachable: false }) })
    await user.clear(secret)
    await user.type(secret, MOCK_DATASPACE_SECRET)
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(connection).getByRole('alert')).toHaveTextContent('The dataspace gateway cannot be reached.'))
    expect(within(connection).getByLabelText('Dataspace credential')).toBeVisible()
    expect(within(connection).getByText('Dataspace disconnected')).toBeVisible()
  })

  test('an expired session offers to reconnect', async () => {
    open('/dataspace', { connection: 'expired' })
    const connection = await region('Connection')
    expect(await within(connection).findByText('Dataspace session expired')).toBeVisible()
    expect(within(connection).getByRole('button', { name: 'Reconnect' })).toBeVisible()
  })
})

describe('area works when not configured or failing', () => {
  test('not configured: says so, explains that escalation is unavailable, and offers no connect form', async () => {
    open('/dataspace', { connection: 'not_configured' })
    const connection = await region('Connection')
    expect(await within(connection).findByText('Dataspace not configured')).toBeVisible()
    expect(within(connection).getByText(/No dataspace connection is configured .* escalation to machine builders is unavailable/)).toBeVisible()
    expect(screen.queryByRole('form', { name: 'Connect to the dataspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect|Disconnect/ })).not.toBeInTheDocument()
    expect(screen.getByText('Not available: no dataspace connection is configured.')).toBeVisible()
  })

  test('failing: the connection shows an error with retry, and the tier explanation stays', async () => {
    const user = userEvent.setup()
    open('/dataspace', { failure: { dataspace: 'unavailable' } })
    const connection = await region('Connection')
    expect(await within(connection).findByText('Could not load the dataspace connection')).toBeVisible()
    expect(within(await region('Data-sharing tier')).getByText('The configured tier could not be loaded.')).toBeVisible()
    expect(screen.getByText('Not available: the dataspace connection could not be checked.')).toBeVisible()
    act(() => { writeControls({ failure: {} }) })
    await user.click(within(connection).getByRole('button', { name: 'Retry' }))
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
  })
})

describe('compatible peers', () => {
  test('selecting a peer lists both directions with granted, denied or default status', async () => {
    const user = userEvent.setup()
    open()
    const peers = await region('Compatible peers')
    expect(await within(peers).findByText('Select a peer to see what each side may access.')).toBeVisible()
    await user.click(within(peers).getByRole('link', { name: /Formwerk Press Technology/ }))
    expect(window.location.search).toBe('?peer=peer-formwerk')
    expect(within(peers).getByRole('link', { name: /Formwerk Press Technology/ })).toHaveAttribute('aria-current', 'true')
    const atPeer = await within(peers).findByRole('table', { name: 'What Plant North may access at Formwerk Press Technology' })
    expect(within(capabilityRow(atPeer.querySelector('caption').textContent, 'twin:direct')).getByText('Granted')).toBeVisible()
    expect(within(capabilityRow(atPeer.querySelector('caption').textContent, 'twin:adjacents')).getByText('Default')).toBeVisible()
    expect(within(capabilityRow(HERE, 'twin:direct')).getByText('Granted')).toBeVisible()
    expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('Default')).toBeVisible()
    expect(within(capabilityRow(HERE, 'twin:history')).getByText('Denied')).toBeVisible()
  })

  test('no compatible peers', async () => {
    renderAppWith(() => { store.update((s) => { s.peers = []; return s }) }, { path: '/dataspace', controls: { authEnabled: false } })
    expect(await within(await region('Compatible peers')).findByText('No compatible peers were found in the dataspace.')).toBeVisible()
  })
})

describe('peer policy', () => {
  test('deny a capability after a confirmation naming peer and capability', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await screen.findByRole('table', { name: HERE })
    await user.click(screen.getByRole('button', { name: 'Deny Machine entity for Formwerk Press Technology' }))
    const dialog = screen.getByRole('dialog', { name: 'Deny: Machine entity for Formwerk Press Technology' })
    expect(dialog).toHaveTextContent('Formwerk Press Technology will no longer be allowed to access Machine entity (twin:direct)')
    expect(store.get().dataspace.policies['peer-formwerk']['twin:direct']).toBe('granted')
    await user.click(within(dialog).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:direct')).getByText('Denied')).toBeVisible())
    expect(store.get().dataspace.policies['peer-formwerk']['twin:direct']).toBe('denied')
  })

  test('grant and reset to default', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await screen.findByRole('table', { name: HERE })
    await user.click(screen.getByRole('button', { name: 'Grant Linked components for Formwerk Press Technology' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Grant' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('Granted')).toBeVisible())
    await user.click(screen.getByRole('button', { name: 'Reset to default Linked components for Formwerk Press Technology' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('returns to the default')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('Default')).toBeVisible())
  })

  test('cancelling changes nothing', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await screen.findByRole('table', { name: HERE })
    await user.click(screen.getByRole('button', { name: 'Grant Signal history for Formwerk Press Technology' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.get().dataspace.policies['peer-formwerk']['twin:history']).toBe('denied')
  })
})

describe('capability requests', () => {
  test('lists requester, capability, date and status', async () => {
    open()
    const requests = await region('Capability requests')
    const row = await waitFor(() => {
      const r = requests.querySelector('tr[data-request="req-003"]')
      expect(r).not.toBeNull()
      return r
    })
    expect(await within(row).findByText('HydroService Maintenance')).toBeVisible()
    expect(within(row).getByText('Machine entity')).toBeVisible()
    expect(row.querySelector('time')).toHaveAttribute('dateTime', request('req-003').requestedAt)
    expect(within(row).getByText('Pending')).toBeVisible()
    const decided = requests.querySelector('tr[data-request="req-001"]')
    expect(within(decided).getByText('Denied')).toBeVisible()
    expect(within(decided).getByText('Only per incident, not for benchmarking.')).toBeVisible()
    expect(within(decided).queryByRole('button')).not.toBeInTheDocument()
  })

  test('approving a request shows it as approved and the peer’s capabilities reflect the grant', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:history')).getByText('Denied')).toBeVisible())
    const requests = await region('Capability requests')
    await user.click(await within(requests).findByRole('button', { name: 'Approve request req-005 of Formwerk Press Technology' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve request req-005' })
    expect(dialog).toHaveTextContent('Formwerk Press Technology requests Signal history (twin:history)')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'For the service visit.')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('Approved')).toBeVisible())
    expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('For the service visit.')).toBeVisible()
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:history')).getByText('Granted')).toBeVisible())
  })

  test('deny with a note', async () => {
    const user = userEvent.setup()
    open()
    const requests = await region('Capability requests')
    await user.click(await within(requests).findByRole('button', { name: /Deny request req-004/ }))
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Note (optional)'), 'Not needed.')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(request('req-004')).toMatchObject({ status: 'denied', note: 'Not needed.' }))
    expect(await within(requests).findByText('Not needed.')).toBeVisible()
  })

  test('a request decided meanwhile shows the current decision and changes nothing', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    const requests = await region('Capability requests')
    const approve = await within(requests).findByRole('button', { name: 'Approve request req-005 of Formwerk Press Technology' })
    store.update((s) => {
      Object.assign(s.dataspace.capabilityRequests.find((r) => r.id === 'req-005'), { status: 'denied', note: 'Decided by a colleague.', decidedAt: new Date().toISOString() })
      return s
    })
    await user.click(approve)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    expect(await within(requests).findByText(/already denied\. No change was made/)).toBeVisible()
    await waitFor(() => expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('Denied')).toBeVisible())
    expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('Decided by a colleague.')).toBeVisible()
    expect(store.get().dataspace.policies['peer-formwerk']['twin:history']).toBe('denied')
    expect(within(capabilityRow(HERE, 'twin:history')).getByText('Denied')).toBeVisible()
  })
})

describe('data-sharing tier', () => {
  test('the configured tier is marked and each tier describes the data it shares', async () => {
    open()
    const tier = await region('Data-sharing tier')
    const items = await within(tier).findAllByRole('listitem')
    expect(items.map((i) => i.dataset.tier)).toEqual(['minimal', 'adjacent', 'timeseries'])
    await waitFor(() => expect(items[0]).toHaveAttribute('aria-current', 'true'))
    expect(within(items[0]).getByText('Configured tier')).toBeVisible()
    expect(items[1]).not.toHaveAttribute('aria-current')
    expect(items[0]).toHaveTextContent('Machine entity only')
    expect(items[0]).toHaveTextContent('own attributes and current values')
    expect(items[1]).toHaveTextContent('Plus linked components')
    expect(items[1]).toHaveTextContent('components, sensors and production line linked to the machine')
    expect(items[2]).toHaveTextContent('Plus signal history')
    expect(items[2]).toHaveTextContent('history of the machine’s signals')
    expect(tier).toHaveTextContent('cannot be changed here')
  })
})

describe('what the registry did not return', () => {
  test('an empty name shows the identifier', async () => {
    const { dataspace } = await import('../../src/data')
    const id = store.get().dataspace.capabilityRequests[0].requesterId
    const spy = vi.spyOn(dataspace, 'resolveNames').mockResolvedValue({ [id]: '' })
    open()
    const requests = await region('Capability requests')
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(within(requests).getAllByText(id).length).toBeGreaterThan(1))
    spy.mockRestore()
  })

  test('a factory without an owner or location leaves them out', async () => {
    const { FactoryDetails } = await import('../../src/app/Header')
    const { render } = await import('@testing-library/react')
    render(<FactoryDetails result={{ status: 'success', data: { id: 'urn:f', name: 'Plant', owner: null, location: null } }} />)
    expect(screen.getByText('Plant')).toBeVisible()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
    expect(screen.queryByText('Location')).not.toBeInTheDocument()
  })
})

describe('access levels and configuration', () => {
  test('each peer shows its access level in the list, without opening it', async () => {
    renderAppWith(() => {
      const [first, second] = store.get().peers
      store.update((s) => { s.dataspace.policies = { [first.id]: { 'twin:history': 'granted' }, [second.id]: { 'twin:direct': 'denied' } }; return s })
    }, { path: '/dataspace', controls: { authEnabled: false } })
    const list = await screen.findByRole('list', { name: 'Peers' })
    const levels = (await within(list).findAllByTestId('access-level')).map((l) => l.textContent)
    expect(levels[0]).toBe('Elevated access')
    expect(levels[1]).toBe('Restricted access')
    expect(levels.slice(2).every((l) => l === 'Standard access')).toBe(true)
  })

  test('the configuration panel shows addresses, realm, client and state, and no secret', async () => {
    open()
    const panel = await region('Configuration')
    expect(await within(panel).findByText('http://gateway.dataspace:8080')).toBeVisible()
    expect(within(panel).getByText('dataspace')).toBeVisible()
    expect(within(panel).getByText('http://ifric.dataspace:4007')).toBeVisible()
    expect(within(panel).getByText('Dataspace connected')).toBeVisible()
    expect(panel.textContent).not.toContain(MOCK_DATASPACE_SECRET)
  })

  test('the configuration panel shows what the backend gives, and nothing that looks like a secret', async () => {
    const spy = vi.spyOn(dataspace, 'getConnectionConfig').mockResolvedValue({
      configured: true, gatewayUrl: 'http://gw.test', keycloakUrl: 'http://kc.test/auth', registryUrl: 'http://reader:***@ifric.test',
      realm: 'dataspace', clientId: 'urn:factory',
    })
    open()
    const panel = await region('Configuration')
    expect(await within(panel).findByText('http://reader:***@ifric.test')).toBeVisible()
    expect(within(panel).getByText('urn:factory')).toBeVisible()
    expect(panel.textContent).not.toMatch(/secret|password|token/i)
    spy.mockRestore()
  })
})
