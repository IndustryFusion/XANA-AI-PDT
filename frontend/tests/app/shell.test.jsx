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

import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataspaceIndicator, FactoryDetails } from '../../src/app/Header'
import { EntityRef } from '../../src/app/EntityRef'
import { paths } from '../../src/app/router'
import { dataspace } from '../../src/data'
import { MOCK_DATASPACE_SECRET } from '../../src/data/sources/mock/dataspaceArea'
import { writeControls } from '../../src/data/sources/mock/controls'
import { renderApp, renderWithRouter } from '../helpers'

const AREA_LABELS = ['Dashboard', 'Active incidents', 'Data explorer', 'Alerts', 'Incident history', 'Dataspace', 'System']

describe('main navigation', () => {
  test('shows every area and marks the current one', async () => {
    const user = userEvent.setup()
    renderApp({ controls: { authEnabled: false } })
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(AREA_LABELS)
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

    await user.click(within(nav).getByRole('link', { name: 'Alerts' }))
    expect(within(nav).getByRole('link', { name: 'Alerts' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  test.each([
    ['/incidents', 'Active incidents'],
    ['/history', 'Incident history'],
    ['/explorer', 'Data explorer'],
    ['/alerts', 'Alerts'],
    ['/dataspace', 'Dataspace'],
    ['/system', 'System'],
  ])('%s shows its delivered area, never a placeholder', async (path, label) => {
    renderApp({ path, controls: { authEnabled: false } })
    expect(await screen.findByRole('heading', { name: label, level: 1 })).toBeVisible()
    expect(screen.queryByText(/is not available yet/)).not.toBeInTheDocument()
  })

  test('unknown URLs show not found with a link to the dashboard', async () => {
    renderApp({ path: '/does-not-exist', controls: { authEnabled: false } })
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/')
  })

  test('opening an item URL directly selects it', async () => {
    renderApp({ path: paths.run('run-1002'), controls: { authEnabled: false } })
    expect(await screen.findByText('run-1002')).toBeVisible()
  })
})

describe('user menu', () => {
  test('shows name, e-mail and factory details', async () => {
    const user = userEvent.setup()
    renderApp({ controls: { authEnabled: false } })
    await user.click(await screen.findByRole('button', { name: /account and factory details/ }))
    const factory = await screen.findByRole('region', { name: 'Factory' })
    expect(screen.getByText('operator@example.org')).toBeVisible()
    expect(within(factory).getByText('Plant North')).toBeVisible()
    expect(within(factory).getByText('Northwind Fabrication GmbH')).toBeVisible()
    expect(within(factory).getByText('Rivertown, Germany')).toBeVisible()
  })

  test('missing factory details are omitted', () => {
    renderWithRouter(<FactoryDetails result={{ status: 'success', data: { id: 'urn:x', name: 'Plant', owner: null, location: null } }} />)
    expect(screen.getByText('Plant')).toBeVisible()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
    expect(screen.queryByText('Location')).not.toBeInTheDocument()
  })
})

describe('dataspace indicator', () => {
  test('connected', async () => {
    renderWithRouter(<DataspaceIndicator />)
    expect(await screen.findByText('Dataspace connected')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Reconnect' })).not.toBeInTheDocument()
  })

  test('expired session shows a reconnect hint leading to the Dataspace area', async () => {
    writeControls({ connection: 'expired' })
    renderWithRouter(<DataspaceIndicator />)
    expect(await screen.findByText('Dataspace session expired')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', '/dataspace')
  })

  test('updates immediately when the connection is changed, without waiting for its poll', async () => {
    renderWithRouter(<DataspaceIndicator refreshMs={0} />)
    expect(await screen.findByText('Dataspace connected')).toBeVisible()
    await act(() => dataspace.disconnect())
    expect(await screen.findByText('Dataspace disconnected')).toBeVisible()
    await act(() => dataspace.connect({ secret: MOCK_DATASPACE_SECRET }))
    expect(await screen.findByText('Dataspace connected')).toBeVisible()
  })

  test('not configured shows no reconnect hint', async () => {
    writeControls({ connection: 'not_configured' })
    renderWithRouter(<DataspaceIndicator />)
    expect(await screen.findByText('Dataspace not configured')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Reconnect' })).not.toBeInTheDocument()
  })
})

describe('entity reference', () => {
  const id = 'urn:ngsi-ld:Machine:press-brake-02'

  test('offers the cross-navigation actions and copying the identifier', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EntityRef id={id} />)
    expect(screen.getByRole('link', { name: 'press-brake-02' })).toHaveAttribute('href', paths.entity(id))
    await user.click(screen.getByRole('button', { name: 'Actions for press-brake-02' }))
    expect(screen.getByRole('link', { name: 'Open in data explorer' })).toHaveAttribute('href', paths.entity(id))
    expect(screen.getByRole('link', { name: 'Start new incident' })).toHaveAttribute('href', paths.newIncident(id))
    expect(screen.getByRole('link', { name: 'Show active incidents' })).toHaveAttribute('href', paths.activeIncidentsFor(id))
    expect(screen.getByRole('link', { name: 'Show incident history' })).toHaveAttribute('href', paths.historyFor(id))
    await user.click(screen.getByRole('button', { name: 'Copy identifier' }))
    expect(await navigator.clipboard.readText()).toBe(id)
    expect(screen.queryByRole('link', { name: 'Open in data explorer' })).not.toBeInTheDocument()
  })

  test('the explorer URL can be overridden, for example to keep a query', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EntityRef id={id} to={`${paths.entity(id)}?type=Machine`} />)
    expect(screen.getByRole('link', { name: 'press-brake-02' })).toHaveAttribute('href', `${paths.entity(id)}?type=Machine`)
    await user.click(screen.getByRole('button', { name: 'Actions for press-brake-02' }))
    expect(screen.getByRole('link', { name: 'Open in data explorer' })).toHaveAttribute('href', `${paths.entity(id)}?type=Machine`)
  })

  test('starting an incident opens Active incidents with the machine prefilled', async () => {
    const user = userEvent.setup()
    renderApp({ controls: { authEnabled: false } })
    const tile = await screen.findByRole('region', { name: 'Active incidents' })
    await user.click((await within(tile).findAllByRole('button', { name: /^Actions for/ }))[0])
    await user.click(within(tile).getByRole('link', { name: 'Start new incident' }))
    expect(window.location.pathname).toBe('/incidents')
    const machine = new URLSearchParams(window.location.search).get('machine')
    expect(machine).toMatch(/^urn:ngsi-ld:Machine:/)
    expect(await screen.findByLabelText('Machine ID')).toHaveValue(machine)
    expect(screen.getByLabelText('Issue')).toHaveFocus()
  })
})

test('an unknown data source shows a configuration error', async () => {
  vi.resetModules()
  vi.stubEnv('VITE_DATA_SOURCE', 'backend')
  const { default: App } = await import('../../src/App')
  const { render } = await import('@testing-library/react')
  render(<App />)
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('VITE_DATA_SOURCE')
  expect(alert).toHaveTextContent('backend')
  expect(alert).toHaveTextContent('mock')
  vi.unstubAllEnvs()
})
