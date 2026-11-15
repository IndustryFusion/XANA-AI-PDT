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
import { remaining } from '../../src/features/dataspace/ConnectionSection'
import { participantTypeLabel } from '../../src/features/dataspace/model'
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
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
    const token = within(connection).getByTestId('token-box')
    expect(within(token).getByText('Token valid')).toBeVisible()
    expect(token.querySelector('time')).toHaveAttribute('dateTime', store.get().connection.expiresAt)
    expect(token).toHaveClass('token-box--success')
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
    expect(await within(await region('Dataspace gateway')).findByText('Dataspace disconnected')).toBeVisible()
    expect(within(banner()).getByText('Dataspace disconnected')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Compatible peers' })).not.toBeInTheDocument()
    expect(screen.getByText(/Not available while the dataspace is not connected/)).toBeVisible()
  })

  test('connect with a credential when the configuration provides none', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected' })
    const connection = await region('Dataspace gateway')
    await user.type(await within(connection).findByLabelText('Dataspace credential'), MOCK_DATASPACE_SECRET)
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
    expect(within(banner()).getByText('Dataspace connected')).toBeVisible()
    expect(await region('Compatible peers')).toBeVisible()
  })

  test('without a credential field when the configuration provides it', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected', credentialConfigured: true })
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText('The credential is provided by the configuration.')).toBeVisible()
    expect(within(connection).queryByLabelText('Dataspace credential')).not.toBeInTheDocument()
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByText('Dataspace connected')).toBeVisible()
  })

  test('a rejected credential and an unreachable gateway give different messages and keep the form', async () => {
    const user = userEvent.setup()
    open('/dataspace', { connection: 'disconnected' })
    const connection = await region('Dataspace gateway')
    const secret = await within(connection).findByLabelText('Dataspace credential')
    await user.type(secret, 'wrong')
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    expect(await within(connection).findByRole('alert')).toHaveTextContent('The dataspace refused the client or its secret.')
    expect(within(connection).getByRole('alert')).toHaveTextContent('Check the secret, and that the client is registered in the dataspace.')
    // The gateway hint goes only with a gateway failure.
    expect(within(connection).getByRole('alert')).not.toHaveTextContent('Check the gateway')
    expect(secret).toHaveAttribute('aria-invalid', 'true')
    // The facts of the failure are behind a disclosure: the step, the address, the client and what the provider said.
    const details = within(connection).getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('Getting a token from the dataspace’s identity provider')
    expect(details).toHaveTextContent('401')
    expect(details).toHaveTextContent('invalid_client')
    expect(details).not.toHaveTextContent('Invalid client')
    expect(details).not.toHaveTextContent('wrong')

    act(() => { writeControls({ gatewayReachable: false }) })
    await user.clear(secret)
    await user.type(secret, MOCK_DATASPACE_SECRET)
    await user.click(within(connection).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(connection).getByRole('alert')).toHaveTextContent('The dataspace gateway can’t be reached.'))
    expect(within(connection).getByText('Technical details').closest('details')).toHaveTextContent('Reaching the dataspace gateway')
    expect(within(connection).getByLabelText('Dataspace credential')).toBeVisible()
    expect(within(connection).getByText('Dataspace disconnected')).toBeVisible()
  })

  test('an expired session offers to reconnect', async () => {
    open('/dataspace', { connection: 'expired' })
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText('Dataspace session expired')).toBeVisible()
    expect(within(connection).getByRole('button', { name: 'Reconnect' })).toBeVisible()
  })
})

describe('session countdown and sign-in', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  test('the time left reads in hours, minutes or seconds, and nothing once it ran out', () => {
    expect(remaining(2 * 3600_000 + 5 * 60_000)).toBe('2 h 05 min')
    expect(remaining(125_000)).toBe('2 min 05 s')
    expect(remaining(35_000)).toBe('35 s')
    expect(remaining(0)).toBeNull()
    expect(remaining(-5)).toBeNull()
  })

  test('the session\'s time left ticks, and its last minute is marked as urgent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const expiresAt = new Date(Date.now() + 65_000).toISOString()
    vi.spyOn(dataspace, 'getConnection').mockResolvedValue({ state: 'connected', participantId: 'urn:ifric:plant-north', expiresAt, credentialConfigured: true, sharingTier: 'minimal' })
    open()
    const countdown = await within(await region('Dataspace gateway')).findByTestId('session-countdown')
    expect(countdown).toHaveTextContent(/^1 min 0[45] s remaining$/)
    expect(within(await region('Dataspace gateway')).getByTestId('token-box')).toHaveClass('token-box--success')
    expect(countdown).not.toHaveClass('session-countdown--urgent')
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(countdown).toHaveTextContent(/^5[45] s remaining, renews shortly$/)
    expect(within(await region('Dataspace gateway')).getByTestId('token-box')).toHaveClass('token-box--warning')
    expect(countdown).toHaveClass('session-countdown--urgent')
  })

  test('a renewed token starts the time left again, without the mark', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const base = { state: 'connected', participantId: 'urn:ifric:plant-north', credentialConfigured: true, sharingTier: 'minimal' }
    const get = vi.spyOn(dataspace, 'getConnection').mockResolvedValue({ ...base, expiresAt: new Date(Date.now() + 30_000).toISOString() })
    open()
    const gateway = await region('Dataspace gateway')
    await waitFor(() => expect(within(gateway).getByTestId('token-box')).toHaveClass('token-box--warning'))
    get.mockResolvedValue({ ...base, expiresAt: new Date(Date.now() + 300_000).toISOString() })
    await act(() => vi.advanceTimersByTimeAsync(30_500))
    await waitFor(() => expect(within(gateway).getByTestId('token-box')).toHaveClass('token-box--success'))
    expect(within(gateway).getByTestId('session-countdown')).toHaveTextContent(/^4 min [0-9]{2} s remaining$/)
  })

  test('the time left counts from the seconds the backend gives, whatever the browser clock says', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // The absolute expiry is far off, as with a browser clock that is wrong; the seconds left decide.
    const far = new Date(Date.now() + 3_600_000).toISOString()
    const get = vi.spyOn(dataspace, 'getConnection').mockResolvedValue({ state: 'connected', participantId: 'urn:ifric:plant-north', expiresAt: far, expiresInS: 65, credentialConfigured: true, sharingTier: 'minimal' })
    open()
    const countdown = await within(await region('Dataspace gateway')).findByTestId('session-countdown')
    expect(countdown).toHaveTextContent(/^1 min 0[45] s remaining$/)
    const reads = get.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(66_000))
    // Run out: the connection is read again, which brings the renewed token.
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(reads))
  })

  test('the peers card gives the sign-in reason too, and the configuration says what is not configured', async () => {
    vi.spyOn(dataspace, 'getConnection').mockResolvedValue({ state: 'not_configured', participantId: null, expiresAt: null, credentialConfigured: false, sharingTier: null, needsSignIn: true })
    vi.spyOn(dataspace, 'getConnectionConfig').mockResolvedValue({ configured: false, gatewayUrl: 'http://gw.test', keycloakUrl: 'http://kc.test/auth', registryUrl: null, realm: 'dataspace', clientId: null })
    open()
    expect(await screen.findByText('Not available until you sign in to IFF with an account of your company.')).toBeVisible()
    expect(screen.queryByText(/no dataspace connection is configured/)).toBeNull()
    const gateway = await region('Dataspace gateway')
    expect(await within(gateway).findByText('http://gw.test')).toBeVisible()
    expect(within(gateway).getByText('Not configured')).toBeVisible()
  })

  test('a configuration that cannot be read is said so in the gateway card', async () => {
    vi.spyOn(dataspace, 'getConnectionConfig').mockRejectedValue(Object.assign(new Error('The backend cannot be reached.'), { kind: 'unavailable' }))
    open()
    const gateway = await region('Dataspace gateway')
    expect(await within(gateway).findByText('Could not load the configuration: The backend cannot be reached.')).toBeVisible()
  })

  test('without a company from the sign-in it asks to sign in, and offers no connect', async () => {
    vi.spyOn(dataspace, 'getConnection').mockResolvedValue({ state: 'not_configured', participantId: null, expiresAt: null, credentialConfigured: false, sharingTier: null, needsSignIn: true })
    open()
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText(/^Sign in to IFF first: the dataspace client is your company/)).toBeVisible()
    expect(within(connection).queryByRole('button', { name: /Connect/ })).toBeNull()
    expect(within(connection).queryByText(/part of the deployment configuration/)).toBeNull()
  })
})

describe('area works when not configured or failing', () => {
  test('not configured: says so, explains that escalation is unavailable, and offers no connect form', async () => {
    open('/dataspace', { connection: 'not_configured' })
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText('Dataspace not configured')).toBeVisible()
    expect(within(connection).getByText(/No dataspace connection is configured .* escalation to machine builders is unavailable/)).toBeVisible()
    expect(screen.queryByRole('form', { name: 'Connect to the dataspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect|Disconnect/ })).not.toBeInTheDocument()
    expect(screen.getByText('Not available: no dataspace connection is configured.')).toBeVisible()
  })

  test('failing: the gateway card shows an error with retry', async () => {
    const user = userEvent.setup()
    open('/dataspace', { failure: { dataspace: 'unavailable' } })
    const connection = await region('Dataspace gateway')
    expect(await within(connection).findByText('Could not load the dataspace connection')).toBeVisible()
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
    // As the gateway applies them: an approval reads approved, the rest on request by default.
    expect(within(capabilityRow(atPeer.querySelector('caption').textContent, 'twin:direct')).getByText('Approved')).toBeVisible()
    expect(within(capabilityRow(atPeer.querySelector('caption').textContent, 'twin:adjacents')).getByText('On request')).toBeVisible()
    expect(within(capabilityRow(HERE, 'twin:direct')).getByText('Approved')).toBeVisible()
    expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('On request')).toBeVisible()
    // What each status allows: Approved can be denied or reset, On request approved or denied.
    expect(within(capabilityRow(HERE, 'twin:direct')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Deny…', 'Reset to default…'])
    expect(within(capabilityRow(HERE, 'twin:adjacents')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve…', 'Deny…'])
    expect(within(capabilityRow(HERE, 'twin:history')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve…', 'Reset to default…'])
    expect(within(capabilityRow(HERE, 'twin:history')).getByText('Denied')).toBeVisible()
  })

  test('a participant type reads as words, also when the gateway gives it as an IRI', () => {
    expect(participantTypeLabel('machine_builder')).toBe('Machine builder')
    expect(participantTypeLabel('https://industryfusion.github.io/contexts/ontology/v0/dataspace#machine_builder')).toBe('Machine builder')
    expect(participantTypeLabel('urn:x/factory-owner')).toBe('Factory owner')
    expect(participantTypeLabel(null)).toBeNull()
    expect(participantTypeLabel('')).toBeNull()
  })

  test('a peer shows its kind, and an elevated one what it was granted, by sensitivity', async () => {
    renderAppWith(() => { store.update((s) => { s.dataspace.policies['peer-formwerk'] = { 'twin:history': 'granted', 'twin:adjacents': 'granted' }; return s }) }, { path: '/dataspace', controls: { authEnabled: false } })
    const peers = await region('Compatible peers')
    const link = await within(peers).findByRole('link', { name: /Formwerk Press Technology/ })
    expect(within(link).getByText('Machine builder')).toBeVisible()
    expect(within(link).getByTestId('access-level')).toHaveTextContent('Elevated access')
    const granted = within(link).getByLabelText(/^Granted beyond the defaults: (Neighbouring machines, Machine history|Machine history, Neighbouring machines)$/)
    expect(within(granted).getByText('Machine history')).toHaveClass('cap-pill--high')
    expect(within(granted).getByText('Neighbouring machines')).toHaveClass('cap-pill--medium')
    expect(granted).toHaveTextContent('(high sensitivity)')
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
    await user.click(screen.getByRole('button', { name: 'Deny Machine twin for Formwerk Press Technology' }))
    const dialog = screen.getByRole('dialog', { name: 'Deny: Machine twin for Formwerk Press Technology' })
    expect(dialog).toHaveTextContent('Formwerk Press Technology will no longer be allowed to access Machine twin (twin:direct)')
    expect(store.get().dataspace.policies['peer-formwerk']['twin:direct']).toBe('granted')
    await user.click(within(dialog).getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:direct')).getByText('Denied')).toBeVisible())
    expect(store.get().dataspace.policies['peer-formwerk']['twin:direct']).toBe('denied')
  })

  test('approve a capability on request, and reset it to the default', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await screen.findByRole('table', { name: HERE })
    expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('On request')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Approve Neighbouring machines for Formwerk Press Technology' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('Approved')).toBeVisible())
    expect(await screen.findByText('Neighbouring machines is now approved for Formwerk Press Technology.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reset to default Neighbouring machines for Formwerk Press Technology' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('returns to the default')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset to default' }))
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:adjacents')).getByText('On request')).toBeVisible())
  })

  test('cancelling changes nothing', async () => {
    const user = userEvent.setup()
    open('/dataspace?peer=peer-formwerk')
    await screen.findByRole('table', { name: HERE })
    await user.click(screen.getByRole('button', { name: 'Approve Machine history for Formwerk Press Technology' }))
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
    expect(within(row).getByText('Machine twin')).toBeVisible()
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
    expect(dialog).toHaveTextContent('Formwerk Press Technology requests Machine history (twin:history)')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'For the service visit.')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('Approved')).toBeVisible())
    expect(within(requests.querySelector('tr[data-request="req-005"]')).getByText('For the service visit.')).toBeVisible()
    await waitFor(() => expect(within(capabilityRow(HERE, 'twin:history')).getByText('Approved')).toBeVisible())
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
  test('the configured tier is one line in the gateway card, and each tier is explained behind a disclosure', async () => {
    const user = userEvent.setup()
    open()
    const tier = await region('Data-sharing tier')
    await waitFor(() => expect(tier.querySelector('p')).toHaveTextContent('Data-sharing tier: minimal · Machine twin only'))
    expect(tier.querySelector('details')).not.toHaveAttribute('open')
    await user.click(within(tier).getByText('What each tier sends'))
    const items = within(tier).getAllByRole('listitem')
    expect(items.map((i) => i.dataset.tier)).toEqual(['minimal', 'adjacent', 'timeseries'])
    expect(items[0]).toHaveAttribute('aria-current', 'true')
    expect(within(items[0]).getByText('Configured tier')).toBeVisible()
    expect(items[1]).not.toHaveAttribute('aria-current')
    expect(items[0]).toHaveTextContent('own attributes and current values')
    expect(items[1]).toHaveTextContent('components, sensors and production line linked to the machine')
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

  test('the gateway card shows addresses, realm, participant and state once, and no secret', async () => {
    open()
    const panel = await region('Dataspace gateway')
    expect(await within(panel).findByText('http://gateway.dataspace:8080')).toBeVisible()
    expect(within(panel).getByText('realm dataspace')).toBeVisible()
    expect(within(panel).getByText('http://ifric.dataspace:4007')).toBeVisible()
    expect(within(panel).getAllByText('Dataspace connected')).toHaveLength(1)
    expect(panel.textContent).not.toContain(MOCK_DATASPACE_SECRET)
  })

  test('the gateway card shows what the backend gives, and nothing that looks like a secret', async () => {
    const spy = vi.spyOn(dataspace, 'getConnectionConfig').mockResolvedValue({
      configured: true, gatewayUrl: 'http://gw.test', keycloakUrl: 'http://kc.test/auth', registryUrl: 'http://reader:***@ifric.test',
      realm: 'dataspace', clientId: 'urn:factory',
    })
    open()
    const panel = await region('Dataspace gateway')
    expect(await within(panel).findByText('http://reader:***@ifric.test')).toBeVisible()
    expect(within(panel).getByText('http://kc.test/auth')).toBeVisible()
    expect(panel.textContent).not.toMatch(/secret|password/i)
    spy.mockRestore()
  })
})
