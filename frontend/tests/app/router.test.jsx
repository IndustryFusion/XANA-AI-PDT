import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, matchRoute, paths, useRoute } from '../../src/app/router'
import { renderWithRouter } from '../helpers'

describe('matchRoute', () => {
  test.each([
    ['/', 'dashboard', {}],
    ['/incidents', 'incidents', {}],
    ['/incidents/run-1001', 'incidents', { runId: 'run-1001' }],
    ['/history/42', 'history', { incidentId: '42' }],
    ['/alerts/alert-001', 'alerts', { alertId: 'alert-001' }],
    ['/dataspace', 'dataspace', {}],
    ['/system/', 'system', {}],
  ])('%s → %s', (path, area, params) => {
    expect(matchRoute(path)).toEqual({ area, params })
  })

  test('entity IDs with colons round-trip through the URL', () => {
    const id = 'urn:ngsi-ld:Machine:press-brake-02'
    expect(matchRoute(paths.entity(id))).toEqual({ area: 'explorer', params: { entityId: id } })
  })

  test('unknown paths do not match', () => {
    expect(matchRoute('/nope')).toBeNull()
    expect(matchRoute('/incidents/a/b')).toBeNull()
  })
})

function Where() {
  const { area, params, query } = useRoute()
  return <output>{JSON.stringify({ area, params, query })}</output>
}

test('links navigate without a page load and update the URL', async () => {
  renderWithRouter(<><Link to={paths.run('run-7')}>Open run</Link><Where /></>)
  await userEvent.click(screen.getByRole('link', { name: 'Open run' }))
  expect(window.location.pathname).toBe('/incidents/run-7')
  expect(screen.getByRole('status')).toHaveTextContent('"runId":"run-7"')
})

test('browser back and forward move between visited views', async () => {
  renderWithRouter(<><Link to="/alerts">Alerts</Link><Where /></>, { path: '/' })
  await userEvent.click(screen.getByRole('link', { name: 'Alerts' }))
  expect(screen.getByRole('status')).toHaveTextContent('"area":"alerts"')

  await act(async () => {
    window.history.back()
    await new Promise((r) => window.addEventListener('popstate', r, { once: true }))
  })
  expect(screen.getByRole('status')).toHaveTextContent('"area":"dashboard"')
})

test('query parameters are exposed', () => {
  renderWithRouter(<Where />, { path: paths.newIncident('urn:ngsi-ld:Machine:x') })
  expect(screen.getByRole('status')).toHaveTextContent('"machine":"urn:ngsi-ld:Machine:x"')
})

describe('scroll position', () => {
  afterEach(() => vi.restoreAllMocks())

  test('within an area (selecting an item, changing a filter) the page keeps its position', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    renderWithRouter(<><Link to={paths.alert('alert-002')}>Select</Link><Link to="/alerts?severity=major">Filter</Link></>, { path: '/alerts/alert-001' })
    await userEvent.click(screen.getByRole('link', { name: 'Select' }))
    await userEvent.click(screen.getByRole('link', { name: 'Filter' }))
    expect(window.location.search).toBe('?severity=major')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test('moving to another area starts at the top', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    renderWithRouter(<Link to={paths.dataspace()}>Dataspace</Link>, { path: '/alerts' })
    await userEvent.click(screen.getByRole('link', { name: 'Dataspace' }))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
