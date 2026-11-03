import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataspaceIndicator, FactoryDetails } from '../../src/app/Header'
import { EntityRef } from '../../src/app/EntityRef'
import { paths } from '../../src/app/router'
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
  ])('%s shows a placeholder naming the area', async (path, label) => {
    renderApp({ path, controls: { authEnabled: false } })
    expect(await screen.findByRole('heading', { name: label, level: 1 })).toBeVisible()
    expect(screen.getByText(`${label} is not available yet.`)).toBeVisible()
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

  test('not configured shows no reconnect hint', async () => {
    writeControls({ connection: 'not_configured' })
    renderWithRouter(<DataspaceIndicator />)
    expect(await screen.findByText('Dataspace not configured')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Reconnect' })).not.toBeInTheDocument()
  })
})

describe('entity reference', () => {
  const id = 'urn:ngsi-ld:Machine:press-brake-02'

  test('offers the four cross-navigation actions', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EntityRef id={id} />)
    expect(screen.getByRole('link', { name: 'press-brake-02' })).toHaveAttribute('href', paths.entity(id))
    await user.click(screen.getByRole('button', { name: 'Actions for press-brake-02' }))
    expect(screen.getByRole('link', { name: 'Open in data explorer' })).toHaveAttribute('href', paths.entity(id))
    expect(screen.getByRole('link', { name: 'Start new incident' })).toHaveAttribute('href', paths.newIncident(id))
    expect(screen.getByRole('link', { name: 'Show active incidents' })).toHaveAttribute('href', paths.activeIncidentsFor(id))
    expect(screen.getByRole('link', { name: 'Show incident history' })).toHaveAttribute('href', paths.historyFor(id))
  })

  test('starting an incident opens Active incidents with the machine prefilled', async () => {
    const user = userEvent.setup()
    renderApp({ controls: { authEnabled: false } })
    const tile = await screen.findByRole('region', { name: 'Active incidents' })
    await user.click((await within(tile).findAllByRole('button', { name: /^Actions for/ }))[0])
    await user.click(within(tile).getByRole('link', { name: 'Start new incident' }))
    expect(window.location.pathname).toBe('/incidents')
    expect(new URLSearchParams(window.location.search).get('machine')).toMatch(/^urn:ngsi-ld:Machine:/)
    expect(await screen.findByText('New incident for machine')).toBeVisible()
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
