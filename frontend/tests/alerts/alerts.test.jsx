import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { raiseAlert, store } from '../../src/data/sources/mock'
import { SEVERITY_RANK } from '../../src/data/sources/mock/alertsArea'
import { REFRESH_KEY } from '../../src/features/alerts/Alerts'
import { renderApp } from '../helpers'

const open = (path = paths.alerts()) => renderApp({ path, controls: { authEnabled: false } })
const listRegion = () => screen.findByRole('region', { name: 'Alert list' })
const rows = async () => within(await listRegion()).queryAllByRole('row').slice(1).filter((r) => r.dataset.alert)
const rowIds = async () => (await rows()).map((r) => r.dataset.alert)
const row = (id) => document.querySelector(`tr[data-alert="${id}"]`)
const stored = (id) => store.get().alerts.find((a) => a.id === id)
const withStatus = (status) => store.get().alerts.filter((a) => a.status === status)
const search = () => Object.fromEntries(new URLSearchParams(window.location.search))

async function waitForRows(count) {
  await waitFor(async () => expect(await rows()).toHaveLength(count))
}

describe('list and filters', () => {
  test('default: open and acknowledged alerts, most severe and newest first, with all columns', async () => {
    open()
    const expected = store.get().alerts
      .filter((a) => ['open', 'ack'].includes(a.status))
      .sort((a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity) || b.createTime.localeCompare(a.createTime))
    await waitForRows(expected.length)
    expect(await rowIds()).toEqual(expected.map((a) => a.id))
    const first = row(expected[0].id)
    expect(within(first).getByText(expected[0].text)).toBeVisible()
    expect(within(first).getByRole('link', { name: expected[0].resource.split(':').at(-1) })).toBeVisible()
    expect(within(first).getByText(expected[0].service[0])).toBeVisible()
    expect(within(first).getAllByText(/Critical|Major|Minor|Warning|Informational/)[0]).toBeVisible()
    expect(within(first).getAllByText(/^(Open|Acknowledged)$/)[0]).toBeVisible()
    expect(first.querySelector('time')).toHaveTextContent(/min|h|d|just now/)
    expect(screen.getByLabelText('Status')).toHaveValue('open,ack')
  })

  test('selecting a severity in the summary filters the list and marks it as selected', async () => {
    const user = userEvent.setup()
    open()
    const summary = await screen.findByRole('group', { name: 'Alerts by severity' })
    const critical = await within(summary).findByRole('button', { name: /Critical/ })
    const count = Number(critical.textContent.match(/\d+/)[0])
    await user.click(critical)
    expect(critical).toHaveAttribute('aria-pressed', 'true')
    expect(search()).toEqual({ severity: 'critical' })
    await waitForRows(count)
    for (const r of await rows()) expect(within(r).getByText('Critical')).toBeVisible()
    // The summary still counts the other severities of the filter.
    expect(within(summary).getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'false')
    await user.click(critical)
    expect(search()).toEqual({})
  })

  test('environment and text combine, and the URL reflects the filter', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: 'Commissioning' })
    await user.selectOptions(screen.getByLabelText('Status'), 'All')
    await user.selectOptions(screen.getByLabelText('Environment'), 'Commissioning')
    await user.type(screen.getByLabelText('Search'), 'press brake')
    const expected = store.get().alerts.filter((a) => a.environment === 'Commissioning' && /press brake/i.test(a.text))
    expect(expected.length).toBeGreaterThan(0)
    await waitFor(async () => expect((await rowIds()).sort()).toEqual(expected.map((a) => a.id).sort()))
    expect(search()).toEqual({ status: 'open,ack,shelved,closed', environment: 'Commissioning', text: 'press brake' })
  })

  test('filters from the URL, and no matches', async () => {
    open(`${paths.alerts()}?text=${encodeURIComponent('no such alert')}`)
    expect(await within(await listRegion()).findByText('No alerts match the current filter.')).toBeVisible()
    expect(screen.getByLabelText('Search')).toHaveValue('no such alert')
  })

  test('newest first on request', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.selectOptions(screen.getByLabelText('Order'), 'time')
    const expected = store.get().alerts.filter((a) => ['open', 'ack'].includes(a.status)).sort((a, b) => b.createTime.localeCompare(a.createTime))
    await waitFor(async () => expect(await rowIds()).toEqual(expected.map((a) => a.id)))
  })
})

describe('automatic refresh', () => {
  afterEach(() => vi.useRealTimers())

  test('a new alert appears at the next refresh without losing filter or selection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(`${paths.alerts()}?environment=Production`)
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const [firstId] = await rowIds()
    await user.click(within(row(firstId)).getByRole('checkbox'))
    await user.selectOptions(screen.getByLabelText('Automatic refresh'), '10000')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('10000')

    const alert = raiseAlert()
    expect(row(alert.id)).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    await waitFor(() => expect(row(alert.id)).not.toBeNull())
    expect(within(row(firstId)).getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeVisible()
    expect(search()).toEqual({ environment: 'Production' })
  })

  test('with refresh off the list changes only on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(REFRESH_KEY, '0')
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const alert = raiseAlert()
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(row(alert.id)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => expect(row(alert.id)).not.toBeNull())
  })
})

describe('actions', () => {
  test('bulk acknowledge with a note: each becomes acknowledged and the result is reported per alert', async () => {
    const user = userEvent.setup()
    open()
    const [a, b] = withStatus('open')
    await waitFor(() => expect(row(a.id)).not.toBeNull())
    await user.click(within(row(a.id)).getByRole('checkbox'))
    await user.click(within(row(b.id)).getByRole('checkbox'))
    const bar = screen.getByRole('region', { name: 'Selected alerts' })
    expect(bar).toHaveTextContent('2 selected')
    await user.click(within(bar).getByRole('button', { name: 'Acknowledge…' }))
    const dialog = screen.getByRole('dialog', { name: 'Acknowledge 2 alerts' })
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Technician informed.')
    await user.click(within(dialog).getByRole('button', { name: 'Acknowledge' }))

    const results = await screen.findByRole('region', { name: 'Acknowledge: 2 succeeded, 0 failed' })
    expect(within(results).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `${a.id}: Acknowledged, now Acknowledged`, `${b.id}: Acknowledged, now Acknowledged`,
    ])
    await waitFor(() => expect(within(row(a.id)).getByText('Acknowledged')).toBeVisible())
    expect(within(row(b.id)).getByText('Acknowledged')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Selected alerts' })).not.toBeInTheDocument()
    expect(stored(a.id).history.at(-1)).toMatchObject({ status: 'ack', text: 'Technician informed.' })
  })

  test('partial failure: failed alerts stay selected with the reason, the others show their new status', async () => {
    const user = userEvent.setup()
    open()
    const [opened] = withStatus('open')
    const [acked] = withStatus('ack')
    await waitFor(() => expect(row(acked.id)).not.toBeNull())
    await user.click(within(row(opened.id)).getByRole('checkbox'))
    await user.click(within(row(acked.id)).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Acknowledge…' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Acknowledge' }))

    const results = await screen.findByRole('region', { name: 'Acknowledge: 1 succeeded, 1 failed' })
    expect(results).toHaveTextContent(`${acked.id}: failed: The alert is acknowledged and cannot be acknowledged.`)
    expect(screen.getByRole('region', { name: 'Selected alerts' })).toHaveTextContent('1 selected')
    expect(within(row(acked.id)).getByRole('checkbox')).toBeChecked()
    expect(row(acked.id)).toHaveTextContent('Action failed: The alert is acknowledged and cannot be acknowledged.')
    await waitFor(() => expect(within(row(opened.id)).getByText('Acknowledged')).toBeVisible())
    expect(within(row(opened.id)).getByRole('checkbox')).not.toBeChecked()
  })

  test('select all and clear selection', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.click(screen.getByLabelText('Select all listed alerts'))
    expect(screen.getByText(`${(await rows()).length} selected`)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Selected alerts' })).not.toBeInTheDocument()
  })
})

describe('alert detail and context', () => {
  test('selecting an alert shows its attributes and ordered history, and the URL names it', async () => {
    const user = userEvent.setup()
    open(`${paths.alerts()}?status=closed`)
    const [closed] = withStatus('closed')
    await waitFor(() => expect(row(closed.id)).not.toBeNull())
    await user.click(within(row(closed.id)).getByRole('link', { name: `${closed.event} (${closed.id})` }))
    expect(window.location.pathname).toBe(paths.alert(closed.id))
    expect(search()).toEqual({ status: 'closed' })
    const detail = await screen.findByRole('article', { name: `Alert ${closed.id}` })
    expect(detail).toHaveTextContent(closed.text)
    for (const label of ['Resource', 'Event', 'Environment', 'Service', 'Created', 'Last received', 'Duplicates']) {
      expect(within(detail).getByText(label)).toBeVisible()
    }
    const history = within(detail).getByRole('region', { name: 'History' })
    expect(within(history).getAllByRole('listitem').map((li) => li.querySelector('[data-status]').dataset.status)).toEqual(['open', 'ack', 'closed'])
    expect(within(history).getAllByRole('listitem')[2]).toHaveTextContent('Value back within limits.')
  })

  test('a single action from the detail appends to its history', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    await user.click(within(detail).getByRole('button', { name: 'Shelve…' }))
    const dialog = screen.getByRole('dialog', { name: `Shelve alert ${alert.id}` })
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Maintenance tomorrow.')
    await user.click(within(dialog).getByRole('button', { name: 'Shelve' }))
    await waitFor(() => expect(within(within(detail).getByRole('region', { name: 'History' })).getAllByRole('listitem').at(-1)).toHaveTextContent('Maintenance tomorrow.'))
    expect(within(detail).getByRole('button', { name: 'Unshelve…' })).toBeVisible()
  })

  test('an unknown alert is not found', async () => {
    open(paths.alert('alert-999'))
    expect(await screen.findByRole('heading', { name: 'Alert not found' })).toBeVisible()
  })

  test('jumps to the entity and its incidents', async () => {
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    expect(within(detail).getByRole('link', { name: `Open ${alert.resource} in the data explorer` })).toHaveAttribute('href', paths.entity(alert.resource))
    expect(within(detail).getByRole('link', { name: 'Show active incidents of this machine' })).toHaveAttribute('href', paths.activeIncidentsFor(alert.resource))
    expect(within(detail).getByRole('link', { name: 'Show incident history of this machine' })).toHaveAttribute('href', paths.historyFor(alert.resource))
  })

  test('starting an incident opens the form with the resource as machine and the alert text as issue', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    await user.click(within(detail).getByRole('link', { name: 'Start new incident' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Active incidents' })).toBeVisible()
    expect(await screen.findByLabelText('Machine ID')).toHaveValue(alert.resource)
    expect(screen.getByLabelText('Issue')).toHaveValue(alert.text)
  })
})

describe('context menu and quick start', () => {
  const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)

  test('a right click on a row offers start incident, the context jumps and the actions for its status', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    fireEvent.contextMenu(within(row(alert.id)).getByText(alert.text))
    const menu = screen.getByRole('menu', { name: `Actions for alert ${alert.id}` })
    expect(menuItems()).toEqual([
      'Start new incident', 'Open details', 'Open resource in the data explorer', 'Show active incidents', 'Show incident history',
      'Acknowledge…', 'Shelve…', 'Close…', 'Copy alert ID',
    ])
    expect(within(menu).getByRole('menuitem', { name: 'Start new incident' })).toHaveFocus()
    await user.click(within(menu).getByRole('menuitem', { name: 'Start new incident' }))
    expect(await screen.findByLabelText('Machine ID')).toHaveValue(alert.resource)
    expect(screen.getByLabelText('Issue')).toHaveValue(alert.text)
  })

  test('the keyboard opens the menu with Shift+F10, arrows move, Escape closes and returns focus', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    const checkbox = within(row(alert.id)).getByRole('checkbox')
    checkbox.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Start new incident' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(within(menu).getByRole('menuitem', { name: 'Copy alert ID' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(checkbox).toHaveFocus()
  })

  test("the row's actions button opens the same menu, and an action opens its dialog", async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('ack')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    await user.click(within(row(alert.id)).getByRole('button', { name: new RegExp(`^Actions for .*\\(${alert.id}\\)$`) }))
    expect(menuItems()).toContain('Unacknowledge…')
    await user.click(screen.getByRole('menuitem', { name: 'Unacknowledge…' }))
    expect(screen.getByRole('dialog', { name: `Unacknowledge alert ${alert.id}` })).toBeVisible()
  })

  test('clicking a row opens its detail', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    await user.click(within(row(alert.id)).getByText(alert.text))
    expect(await screen.findByRole('article', { name: `Alert ${alert.id}` })).toBeVisible()
    expect(window.location.pathname).toBe(paths.alert(alert.id))
  })

  test('selecting a single alert offers to start an incident right away', async () => {
    const user = userEvent.setup()
    const [first, second] = withStatus('open')
    open()
    await waitFor(() => expect(row(first.id)).toBeTruthy())
    await user.click(within(row(first.id)).getByRole('checkbox'))
    const bar = screen.getByRole('region', { name: 'Selected alerts' })
    expect(within(bar).getByRole('link', { name: 'Start new incident' })).toHaveAttribute('href', paths.newIncident(first.resource, first.text))
    await user.click(within(row(second.id)).getByRole('checkbox'))
    expect(within(bar).queryByRole('link', { name: 'Start new incident' })).not.toBeInTheDocument()
  })
})
