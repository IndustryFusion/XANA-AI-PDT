import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { REFRESH_KEY } from '../../src/features/dashboard/Dashboard'
import { renderApp } from '../helpers'

const open = { controls: { authEnabled: false } }
const tile = (name) => screen.findByRole('region', { name })

test('shows the five tiles with their data', async () => {
  renderApp(open)
  const incidents = await tile('Active incidents')
  expect(await within(incidents).findByText('4')).toBeVisible()
  expect(within(incidents).getByText('Needs input')).toBeVisible()

  const alerts = await tile('Open alerts')
  expect(await within(alerts).findByRole('list', { name: 'Alerts by severity' })).toBeVisible()

  const data = await tile('Data overview')
  expect(await within(data).findByText('Machine')).toBeVisible()

  const dataspace = await tile('Dataspace')
  expect(await within(dataspace).findByText('compatible peers', { exact: false })).toBeVisible()

  const health = await tile('System health')
  expect(await within(health).findByText('Overall: ok')).toBeVisible()
})

test('tile headers and listed incidents link to their areas and items', async () => {
  const user = userEvent.setup()
  renderApp(open)
  const incidents = await tile('Active incidents')
  expect(within(incidents).getByRole('link', { name: 'Active incidents' })).toHaveAttribute('href', '/incidents')
  const first = (await within(incidents).findAllByRole('link', { name: /burr formation/ }))[0]
  await user.click(first)
  expect(window.location.pathname).toMatch(/^\/incidents\/run-/)
})

test('header links of the other tiles', async () => {
  renderApp(open)
  for (const [name, href] of [['Open alerts', '/alerts'], ['Data overview', '/explorer'], ['Dataspace', '/dataspace'], ['System health', '/system']]) {
    const t = await tile(name)
    expect(within(t).getByRole('link', { name })).toHaveAttribute('href', href)
  }
})

test('one failing area shows an error with retry while the other tiles show data', async () => {
  const user = userEvent.setup()
  renderApp({ controls: { authEnabled: false, failure: { alerts: 'unavailable' } } })
  const alerts = await tile('Open alerts')
  expect(await within(alerts).findByRole('alert')).toHaveTextContent('Could not load alerts')
  expect(await within(await tile('Data overview')).findByText('Machine')).toBeVisible()

  writeControls({ failure: {} })
  await user.click(within(alerts).getByRole('button', { name: 'Retry' }))
  expect(await within(alerts).findByRole('list', { name: 'Alerts by severity' })).toBeVisible()
})

test('no active incidents invites starting an analysis', async () => {
  const user = userEvent.setup()
  renderApp(open)
  const incidents = await tile('Active incidents')
  await within(incidents).findByText('4')
  store.update((s) => { s.runs = []; return s })
  await user.click(screen.getByRole('button', { name: 'Refresh now' }))
  expect(await within(incidents).findByText('No active incidents.')).toBeVisible()
  await user.click(within(incidents).getByRole('link', { name: 'Start a new analysis' }))
  expect(window.location.pathname).toBe('/incidents')
  expect(window.location.search).toBe('?new=1')
})

test('dataspace not connected offers to open the Dataspace area', async () => {
  renderApp({ controls: { authEnabled: false, connection: 'disconnected' } })
  const dataspace = await tile('Dataspace')
  expect(await within(dataspace).findByText('Not connected to the dataspace.')).toBeVisible()
  expect(within(dataspace).getByRole('link', { name: 'Open Dataspace to connect' })).toHaveAttribute('href', '/dataspace')
})

describe('refresh', () => {
  afterEach(() => vi.useRealTimers())

  test('tiles refresh at the chosen interval and the choice persists', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp(open)
    const incidents = await tile('Active incidents')
    await within(incidents).findByText('4')

    await user.selectOptions(screen.getByLabelText('Automatic refresh'), '10000')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('10000')

    store.update((s) => { s.runs = s.runs.slice(0, 2); return s })
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    expect(await within(incidents).findByText('2')).toBeVisible()
  })

  test('with refresh off, tiles change only after a manual refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(REFRESH_KEY, '0')
    renderApp(open)
    const incidents = await tile('Active incidents')
    await within(incidents).findByText('4')
    expect(screen.getByLabelText('Automatic refresh')).toHaveValue('0')

    store.update((s) => { s.runs = s.runs.slice(0, 1); return s })
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(within(incidents).getByText('4')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Refresh now' }))
    expect(await within(incidents).findByText('1')).toBeVisible()
  })
})
